import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface LocalSkillSourceRecord {
  source: "git" | "local" | "skills.sh" | "clawhub";
  repository: string | null;
  skill_path: string | null;
  ref: string | null;
  content_sha256: string | null;
  /** First time dotagents recorded this skill on this computer. */
  first_seen_at: string;
  /** Set after a person has acknowledged a newly discovered skill. */
  reviewed_at: string | null;
  /** Relationship to the editable copy on this computer. */
  ownership: "external" | "owned" | "forked" | "unknown";
  /** Preserved upstream facts for an editable fork. */
  forked_from: {
    repository: string | null;
    skill_path: string | null;
    ref: string | null;
  } | null;
  updated_at: string;
}

type SourceRegistry = {
  schema_version: 1;
  /** Existing skills are acknowledged once when dotagents first observes this computer. */
  inventory_initialized_at?: string;
  skills: Record<string, LocalSkillSourceRecord>;
};

export type ObservedLocalSkill = {
  skill: string;
  source?: LocalSkillSourceRecord["source"];
  repository?: string | null;
  skill_path?: string | null;
  ref?: string | null;
  content_sha256?: string | null;
};

export function sourceRegistryPath(
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (environment.DOTAGENTS_CONFIG_HOME) return paths.join(environment.DOTAGENTS_CONFIG_HOME, "sources.json");
  if (environment.XDG_CONFIG_HOME) return paths.join(environment.XDG_CONFIG_HOME, "dotagents", "sources.json");
  if (platform === "win32")
    return paths.join(environment.APPDATA ?? paths.join(home, "AppData", "Roaming"), "dotagents", "sources.json");
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "dotagents", "sources.json");
  return paths.join(home, ".config", "dotagents", "sources.json");
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeRecord(value: unknown): LocalSkillSourceRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<LocalSkillSourceRecord>;
  if (
    (record.source !== "git" &&
      record.source !== "local" &&
      record.source !== "skills.sh" &&
      record.source !== "clawhub") ||
    !isTimestamp(record.updated_at)
  )
    return null;
  const ownership =
    record.ownership === "external" ||
    record.ownership === "owned" ||
    record.ownership === "forked" ||
    record.ownership === "unknown"
      ? record.ownership
      : "unknown";
  const forkedFrom =
    record.forked_from &&
    typeof record.forked_from === "object" &&
    (record.forked_from.repository === null || typeof record.forked_from.repository === "string") &&
    (record.forked_from.skill_path === null || typeof record.forked_from.skill_path === "string") &&
    (record.forked_from.ref === null || typeof record.forked_from.ref === "string")
      ? record.forked_from
      : null;
  // Records written before relationship tracking existed are established local
  // state, not a new queue of hundreds of unreviewed skills after upgrade.
  const firstSeenAt = isTimestamp(record.first_seen_at) ? record.first_seen_at : record.updated_at;
  const reviewedAt =
    record.reviewed_at === null || isTimestamp(record.reviewed_at) ? record.reviewed_at : record.updated_at;
  return {
    source: record.source,
    repository: typeof record.repository === "string" ? record.repository : null,
    skill_path: typeof record.skill_path === "string" ? record.skill_path : null,
    ref: typeof record.ref === "string" ? record.ref : null,
    content_sha256: typeof record.content_sha256 === "string" ? record.content_sha256 : null,
    first_seen_at: firstSeenAt,
    reviewed_at: reviewedAt,
    ownership,
    forked_from: forkedFrom,
    updated_at: record.updated_at,
  };
}

export function readLocalSkillSources(file = sourceRegistryPath()): Record<string, LocalSkillSourceRecord> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SourceRegistry>;
    if (parsed.schema_version !== 1 || !parsed.skills || typeof parsed.skills !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed.skills).flatMap(([skill, value]) => {
        const normalized = normalizeRecord(value);
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) && normalized ? [[skill, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeRegistry(skills: Record<string, LocalSkillSourceRecord>, file: string): void {
  writeRegistryState({ schema_version: 1, skills }, file);
}

function readRegistry(file: string): SourceRegistry {
  if (!existsSync(file)) return { schema_version: 1, skills: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SourceRegistry>;
    if (parsed.schema_version !== 1 || !parsed.skills || typeof parsed.skills !== "object")
      return { schema_version: 1, skills: {} };
    return {
      schema_version: 1,
      ...(isTimestamp(parsed.inventory_initialized_at)
        ? { inventory_initialized_at: parsed.inventory_initialized_at }
        : {}),
      skills: readLocalSkillSources(file),
    };
  } catch {
    return { schema_version: 1, skills: {} };
  }
}

function writeRegistryState(registry: SourceRegistry, file: string): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}

/** Device-local source metadata for update workflows; never copied into a portable library. */
export function saveLocalSkillSource(
  skill: string,
  input: Omit<LocalSkillSourceRecord, "updated_at" | "first_seen_at" | "reviewed_at" | "ownership" | "forked_from"> &
    Partial<Pick<LocalSkillSourceRecord, "reviewed_at" | "ownership" | "forked_from">>,
  file = sourceRegistryPath(),
): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error(`Invalid skill identifier: ${skill}`);
  const skills = readLocalSkillSources(file);
  const now = new Date().toISOString();
  const existing = skills[skill];
  skills[skill] = {
    ...existing,
    ...input,
    first_seen_at: existing?.first_seen_at ?? now,
    reviewed_at: input.reviewed_at ?? existing?.reviewed_at ?? null,
    ownership: input.ownership ?? existing?.ownership ?? "unknown",
    forked_from: input.forked_from ?? existing?.forked_from ?? null,
    updated_at: now,
  };
  writeRegistry(skills, file);
}

export function markLocalSkillReviewed(skill: string, file = sourceRegistryPath()): void {
  const skills = readLocalSkillSources(file);
  const record = skills[skill];
  if (!record) return;
  skills[skill] = { ...record, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  writeRegistry(skills, file);
}

/**
 * Records skills discovered outside dotagents install/import flows.
 *
 * The first inventory is a baseline: it must not turn a person's established
 * toolkit into a wall of "new" work. Every skill discovered after that point
 * starts unreviewed until the person acknowledges it.
 */
export function observeLocalSkills(
  observed: ObservedLocalSkill[],
  file = sourceRegistryPath(),
): { initialized: boolean; added: string[] } {
  const registry = readRegistry(file);
  const isFirstInventory = registry.inventory_initialized_at == null;
  const now = new Date().toISOString();
  const added: string[] = [];

  for (const candidate of observed) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.skill)) continue;
    const existing = registry.skills[candidate.skill];
    if (existing) {
      // A lock file is stronger provenance than the anonymous local-path
      // baseline, but never overrides an owned copy or an explicit fork.
      if (
        (candidate.source === "skills.sh" || candidate.source === "clawhub" || candidate.source === "git") &&
        existing.source === "local" &&
        existing.ownership === "unknown"
      ) {
        registry.skills[candidate.skill] = {
          ...existing,
          source: candidate.source,
          repository: candidate.repository ?? existing.repository,
          skill_path: candidate.skill_path ?? existing.skill_path,
          ref: candidate.ref ?? existing.ref,
          ownership: "external",
          updated_at: now,
        };
        added.push(candidate.skill);
      }
      continue;
    }
    registry.skills[candidate.skill] = {
      source: candidate.source ?? "local",
      repository: candidate.repository ?? null,
      skill_path: candidate.skill_path ?? null,
      ref: candidate.ref ?? null,
      content_sha256: candidate.content_sha256 ?? null,
      first_seen_at: now,
      reviewed_at: isFirstInventory ? now : null,
      ownership:
        candidate.source === "skills.sh" || candidate.source === "clawhub" || candidate.source === "git"
          ? "external"
          : "unknown",
      forked_from: null,
      updated_at: now,
    };
    added.push(candidate.skill);
  }

  if (isFirstInventory || added.length > 0) {
    registry.inventory_initialized_at = registry.inventory_initialized_at ?? now;
    writeRegistryState(registry, file);
  }
  return { initialized: isFirstInventory, added };
}

export function removeLocalSkillSource(skill: string, file = sourceRegistryPath()): void {
  const skills = readLocalSkillSources(file);
  if (!(skill in skills)) return;
  delete skills[skill];
  writeRegistry(skills, file);
}
