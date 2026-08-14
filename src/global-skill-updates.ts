import path from "node:path";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { discoverSkills, type DiscoveredSkill, type SkillDiscoveryRoot } from "./discovery.js";
import { exactSourceSecurityPolicy, type SourceSecurityPolicyInput } from "./source-policy.js";
import { normalizeGitIdentity } from "./git-identity.js";
import type { LocalSkillSourceRecord } from "./source-registry.js";
import { SkillSourceSession } from "./source-session.js";
import { applyLibraryUpdatePlan, planLibraryUpdate } from "./library-update.js";
import { planSkillExport, type SkillExportLimits } from "./export-policy.js";
import type { SkillsCliLock } from "./adapters/skills-cli.js";

export type GlobalSkillUpdateState =
  | "up-to-date"
  | "update-available"
  | "local-changes"
  | "review-required"
  | "source-unavailable"
  | "not-trackable";

export type GlobalSkillUpdateItem = {
  skill: string;
  description: string | null;
  /** Native location of the exact discovered copy; the host may disclose it on request. */
  localPath: string | null;
  state: GlobalSkillUpdateState;
  repository: string | null;
  skillPath: string | null;
  source: LocalSkillSourceRecord["source"] | "git" | "unknown";
  /** Whether dotagents may offer a future atomic update action for this item. */
  managed: boolean;
  localIntegrity: string;
  remoteIntegrity: string | null;
  reason?: string;
};

export type GlobalSkillUpdateCheck = {
  checkedAt: string;
  items: GlobalSkillUpdateItem[];
  /** New skills found in already-known source repositories, never installed automatically. */
  newFromSources: Array<{ skill: string; repository: string; skillPath: string; description: string | null }>;
};

export type GlobalSkillUpdateCheckOptions = {
  roots: SkillDiscoveryRoot[];
  sources: Record<string, LocalSkillSourceRecord>;
  managedRoots?: string[];
  cacheDirectory?: (repository: string) => string | undefined;
  sourcePolicy?: SourceSecurityPolicyInput;
  /** Read-only `npx skills` v3 lock evidence, parsed by dotagents. */
  skillsCliLock?: SkillsCliLock | null;
  signal?: AbortSignal;
  /** Per-source ceiling for a background Git refresh. Defaults to 15 seconds. */
  sourceCheckTimeoutMs?: number;
  /** Emits a stable partial snapshot after each source finishes checking. */
  onProgress?: (progress: GlobalSkillUpdateCheckProgress) => void;
  /** Test seam; production uses a dotagents-owned Git session. */
  openSession?: (options: {
    repository: string;
    sourcePolicy: SourceSecurityPolicyInput;
    cacheDirectory?: string;
    signal?: AbortSignal;
  }) => Promise<Pick<SkillSourceSession, "path" | "skills" | "findSkill" | "dispose">>;
};

export type GlobalSkillUpdateCheckProgress = {
  completedSources: number;
  totalSources: number;
  items: GlobalSkillUpdateItem[];
};

export type ReviewedManagedSkillUpdate = {
  skill: string;
  repository: string;
  skillPath: string | null;
  expectedLocalIntegrity: string;
  expectedRemoteIntegrity: string;
};

export type ApplyReviewedManagedSkillUpdatesOptions = Omit<
  GlobalSkillUpdateCheckOptions,
  "roots" | "managedRoots" | "sources" | "onProgress"
> & {
  root: string;
  sources: Record<string, LocalSkillSourceRecord>;
  updates: ReviewedManagedSkillUpdate[];
  /** Reports user-visible milestones without exposing source paths. */
  onProgress?: (progress: GlobalSkillUpdateProgress) => void;
};

export type GlobalSkillUpdateProgress = {
  done: number;
  total: number;
  currentSkill: string;
  phase: "preparing" | "fetching" | "applying" | "complete";
};

export type ApplyReviewedManagedSkillUpdatesResult = {
  updated: Array<{ skill: string; integrity: string }>;
  historyId: string;
};

export type ReviewedGlobalSkillFileChange = {
  path: string;
  kind: "added" | "modified" | "removed";
  localSize: number | null;
  remoteSize: number | null;
};

export type ReviewedGlobalSkillUpdateDetails = {
  skill: string;
  changes: ReviewedGlobalSkillFileChange[];
};

/**
 * Global skills can be legitimate multi-file toolkits (for example, gstack).
 * The default export ceiling protects ad-hoc exports, while this explicit,
 * user-reviewed update path has a larger but still finite safety budget.
 */
const GLOBAL_UPDATE_EXPORT_LIMITS: SkillExportLimits = {
  maxFiles: 2_000,
  maxBytes: 1_024 * 1024 * 1024,
  excludedDirectories: [".git", "node_modules", ".agents"],
};

/** Global toolkit updates may retain a larger local inverse than normal edits. */
const GLOBAL_UPDATE_HISTORY_RETENTION = { maxBytes: 4 * 1024 * 1024 * 1024 } as const;

/** Bound background source work: responsive without flooding Git hosts. */
const MAX_CONCURRENT_SOURCE_CHECKS = 3;
const DEFAULT_SOURCE_CHECK_TIMEOUT_MS = 15_000;

function timedSourceSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("Source check timed out")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function isInsideRoot(target: string, roots: string[]): boolean {
  const resolvedTarget = realpathSync.native(target);
  return roots.some((root) => {
    let resolvedRoot: string;
    try {
      resolvedRoot = realpathSync.native(root);
    } catch {
      return false;
    }
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
  });
}

/**
 * An `npx skills` package may expose individual skills as links into the
 * package checkout. Those links are intentionally not dotagents-managed
 * copies: replacing one would break the package layout and bypass the
 * package's own update mechanism. Only a real directory directly under the
 * managed root may be replaced atomically by this workflow.
 */
function isManagedCopy(
  skill: DiscoveredSkill,
  record: LocalSkillSourceRecord | undefined,
  managedRoots: string[],
): boolean {
  // A regular folder with a recorded Git source and an observed baseline is
  // safe to replace after review, even if the app did not originally create
  // it. `unknown` means its installation origin is not known, not that its
  // current, verified contents are unsafe to update. Symlinked package
  // children are rejected below because their lstat result is not a directory.
  const eligibleOwnership = record?.ownership === "external" || record?.ownership === "unknown";
  if (
    !eligibleOwnership ||
    !record?.repository ||
    !record.observed_integrity ||
    !isInsideRoot(skill.sourcePath, managedRoots)
  )
    return false;
  return managedRoots.some((root) => {
    const candidate = path.join(root, skill.name);
    try {
      return lstatSync(candidate).isDirectory() && realpathSync.native(candidate) === skill.sourcePath;
    } catch {
      return false;
    }
  });
}

function sourceFor(
  skill: DiscoveredSkill,
  sources: Record<string, LocalSkillSourceRecord>,
  skillsCliLock?: SkillsCliLock | null,
) {
  // The user-facing frontmatter name is not an installation identity. A
  // package link such as `vendor-writing` can render `name: writing`, while a
  // former standalone `writing/` folder has its own older registry record.
  // When discovery sees a local Git source, its URL + relative path are the
  // only stable, package-agnostic way to select the matching provenance.
  const gitRecord = skill.gitSource
    ? Object.values(sources).find(
        (candidate) =>
          candidate.repository &&
          normalizeGitIdentity(candidate.repository) === normalizeGitIdentity(skill.gitSource!.url) &&
          candidate.skill_path
            ?.replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/\/SKILL\.md$/i, "") ===
            skill
              .gitSource!.skillPath.replace(/\\/g, "/")
              .replace(/^\.\//, "")
              .replace(/\/SKILL\.md$/i, ""),
      )
    : undefined;
  // A package can expose a link named `gstack-autoplan` whose rendered skill
  // name is still `autoplan`. Prefer the filesystem-stable candidate key: the
  // display name can collide with an older, independently installed folder
  // named `autoplan` and must never borrow that folder's provenance.
  const record = gitRecord ?? sources[skill.candidateKey] ?? sources[skill.name];
  if (record?.repository)
    return { record, repository: record.repository, skillPath: record.skill_path, source: record.source };
  const lock = skillsCliLock?.skills.find((entry) => entry.name === skill.name || entry.name === skill.candidateKey);
  if (lock?.source_url.trim())
    return {
      record: undefined,
      repository: lock.source_url.trim(),
      skillPath: lock.skill_path,
      source: "skills.sh" as const,
    };
  if (skill.gitSource)
    return {
      record: undefined,
      repository: skill.gitSource.url,
      skillPath: skill.gitSource.skillPath,
      source: "git" as const,
    };
  return { record: undefined, repository: null, skillPath: null, source: "unknown" as const };
}

/**
 * A direct symlink into a Git worktree belongs to that package, rather than
 * being an independently replaceable skill directory. Global updates must not
 * create a per-skill review queue for it: the package update flow owns it.
 *
 * This is intentionally based on filesystem topology, not a package name or
 * a particular installer. Any package that exposes skills through direct links
 * receives the same treatment.
 */
function isDirectPackageLink(skill: DiscoveredSkill, managedRoots: string[]): boolean {
  return managedRoots.some((root) => {
    try {
      return readdirSync(root, { withFileTypes: true }).some((entry) => {
        if (!entry.isSymbolicLink()) return false;
        try {
          return realpathSync.native(path.join(root, entry.name)) === skill.sourcePath;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  });
}

/**
 * Read-only global skill update discovery. It fetches only reviewed Git
 * sources into dotagents-owned cache checkouts and never mutates any skill,
 * user Git checkout, or agent installation.
 */
export async function checkGlobalSkillUpdates(options: GlobalSkillUpdateCheckOptions): Promise<GlobalSkillUpdateCheck> {
  const discovery = await discoverSkills(options.roots);
  const managedRoots = options.managedRoots ?? [];
  const openSession = options.openSession ?? ((sessionOptions) => SkillSourceSession.open(sessionOptions));
  const grouped = new Map<string, DiscoveredSkill[]>();
  const details = new Map<string, ReturnType<typeof sourceFor>>();
  const items: GlobalSkillUpdateItem[] = [];

  for (const skill of discovery.skills) {
    // Package links are checked and updated as one Git worktree through
    // linked-skill-package-updates. Treating their resolved children as normal
    // copies creates false "local changes" and review-only rows.
    if (isDirectPackageLink(skill, managedRoots)) continue;
    const detail = sourceFor(skill, options.sources, options.skillsCliLock);
    details.set(skill.candidateKey, detail);
    if (!detail.repository) {
      items.push({
        skill: skill.name,
        description: skill.description,
        localPath: skill.sourcePath,
        state: "not-trackable",
        repository: null,
        skillPath: null,
        source: detail.source,
        managed: false,
        localIntegrity: skill.integrity,
        remoteIntegrity: null,
        reason: "No Git source is recorded for this local skill.",
      });
      continue;
    }
    grouped.set(detail.repository, [...(grouped.get(detail.repository) ?? []), skill]);
  }

  const newFromSources: GlobalSkillUpdateCheck["newFromSources"] = [];
  const checkRepository = async (repository: string, skills: DiscoveredSkill[]): Promise<void> => {
    let session: Awaited<ReturnType<typeof openSession>> | undefined;
    const timeout = timedSourceSignal(options.signal, options.sourceCheckTimeoutMs ?? DEFAULT_SOURCE_CHECK_TIMEOUT_MS);
    try {
      const cacheDirectory = options.cacheDirectory?.(repository);
      session = await openSession({
        repository,
        sourcePolicy: options.sourcePolicy ?? exactSourceSecurityPolicy([repository]),
        ...(cacheDirectory ? { cacheDirectory } : {}),
        signal: timeout.signal,
      });
      const knownRemotePaths = new Set<string>();
      for (const skill of skills) {
        const detail = details.get(skill.candidateKey)!;
        const remotePath = session.findSkill(skill.name, detail.skillPath);
        const remote = remotePath ? session.skills.find((candidate) => candidate.sourcePath === remotePath) : undefined;
        const managed = isManagedCopy(skill, detail.record, managedRoots);
        if (!remote) {
          items.push({
            skill: skill.name,
            description: skill.description,
            localPath: skill.sourcePath,
            state: "source-unavailable",
            repository,
            skillPath: detail.skillPath,
            source: detail.source,
            managed,
            localIntegrity: skill.integrity,
            remoteIntegrity: null,
            reason: "The recorded skill path was not found in its source.",
          });
          continue;
        }
        knownRemotePaths.add(remote.sourcePath);
        const baseline = detail.record?.observed_integrity ?? null;
        const changedLocally = baseline !== null && baseline !== skill.integrity;
        const state: GlobalSkillUpdateState =
          remote.integrity === skill.integrity
            ? "up-to-date"
            : changedLocally
              ? "local-changes"
              : baseline
                ? "update-available"
                : "review-required";
        items.push({
          skill: skill.name,
          description: skill.description,
          localPath: skill.sourcePath,
          state,
          repository,
          skillPath: detail.skillPath,
          source: detail.source,
          managed,
          localIntegrity: skill.integrity,
          remoteIntegrity: remote.integrity,
          ...(state === "review-required"
            ? { reason: "This skill predates update tracking, so dotagents needs your review before replacing it." }
            : {}),
        });
      }
      for (const remote of session.skills) {
        if (!knownRemotePaths.has(remote.sourcePath))
          newFromSources.push({
            skill: remote.name,
            repository,
            skillPath: path.relative(session.path, remote.sourcePath).replaceAll(path.sep, "/"),
            description: remote.description,
          });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const skill of skills) {
        const detail = details.get(skill.candidateKey)!;
        items.push({
          skill: skill.name,
          description: skill.description,
          localPath: skill.sourcePath,
          state: "source-unavailable",
          repository,
          skillPath: detail.skillPath,
          source: detail.source,
          managed: isManagedCopy(skill, detail.record, managedRoots),
          localIntegrity: skill.integrity,
          remoteIntegrity: null,
          reason,
        });
      }
    } finally {
      await session?.dispose();
      timeout.dispose();
    }
  };
  const repositories = [...grouped.entries()];
  let nextRepository = 0;
  let completedSources = 0;
  const reportProgress = () =>
    options.onProgress?.({
      completedSources,
      totalSources: repositories.length,
      items: [...items].sort((a, b) => a.skill.localeCompare(b.skill, "en")),
    });
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_SOURCE_CHECKS, repositories.length) }, async () => {
      while (nextRepository < repositories.length) {
        const entry = repositories[nextRepository++];
        if (entry) {
          await checkRepository(entry[0], entry[1]);
          completedSources += 1;
          reportProgress();
        }
      }
    }),
  );
  return {
    checkedAt: new Date().toISOString(),
    items: items.sort((a, b) => a.skill.localeCompare(b.skill, "en")),
    newFromSources,
  };
}

/**
 * Applies an explicitly reviewed set of updates to dotagents-managed copies
 * under one canonical root. Each local and remote fingerprint is rechecked
 * immediately before `library-update` stages every replacement and commits
 * them using its rollback journal. Manual Git checkouts are deliberately
 * outside this operation.
 */
export async function applyReviewedManagedSkillUpdates(
  options: ApplyReviewedManagedSkillUpdatesOptions,
): Promise<ApplyReviewedManagedSkillUpdatesResult> {
  if (options.updates.length === 0) throw new Error("Choose at least one reviewed skill update");
  const root = path.resolve(options.root);
  const report = (done: number, currentSkill: string, phase: GlobalSkillUpdateProgress["phase"]) =>
    options.onProgress?.({ done, total: options.updates.length, currentSkill, phase });
  report(0, "", "preparing");
  const local = await discoverSkills([{ path: root, kind: "shared" }]);
  const localByName = new Map(local.skills.map((skill) => [skill.name, skill]));
  const grouped = new Map<string, ReviewedManagedSkillUpdate[]>();
  let prepared = 0;
  for (const update of options.updates) {
    report(prepared, update.skill, "preparing");
    const current = localByName.get(update.skill);
    if (!current || !isInsideRoot(current.sourcePath, [root]))
      throw new Error(`Managed skill is no longer available: ${update.skill}`);
    const target = path.join(root, update.skill);
    let targetIsDirectory = false;
    try {
      targetIsDirectory = lstatSync(target).isDirectory();
    } catch {
      // Fall through to the same actionable message as a package link.
    }
    if (!targetIsDirectory) {
      throw new Error(`Skill is installed through a package link: ${update.skill}. Update its source package instead.`);
    }
    if (current.integrity !== update.expectedLocalIntegrity)
      throw new Error(`Local skill changed after review: ${update.skill}`);
    const record = options.sources[update.skill];
    const eligibleOwnership = record?.ownership === "external" || record?.ownership === "unknown";
    if (!record || !eligibleOwnership || !record.observed_integrity || record.repository !== update.repository) {
      throw new Error(`Source ownership changed after review: ${update.skill}`);
    }
    grouped.set(update.repository, [...(grouped.get(update.repository) ?? []), update]);
    prepared += 1;
  }

  const sourceSkills: Array<{
    skill: string;
    path: string;
    sourcePath: string;
    integrity: string;
    exportLimits: SkillExportLimits;
  }> = [];
  const openSession = options.openSession ?? ((sessionOptions) => SkillSourceSession.open(sessionOptions));
  const sessions: Array<Pick<SkillSourceSession, "dispose">> = [];
  try {
    let fetched = 0;
    for (const [repository, updates] of grouped) {
      // `prepared` means locally preflighted, not downloaded. Keep the
      // user-visible fetch counter honest: a skill becomes complete here only
      // after its source session has opened and its reviewed fingerprint has
      // been validated.
      report(fetched, updates[0]?.skill ?? "", "fetching");
      const cacheDirectory = options.cacheDirectory?.(repository);
      const session = await openSession({
        repository,
        sourcePolicy: options.sourcePolicy ?? exactSourceSecurityPolicy([repository]),
        ...(cacheDirectory ? { cacheDirectory } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      sessions.push(session);
      for (const update of updates) {
        const remotePath = session.findSkill(update.skill, update.skillPath);
        const remote = remotePath ? session.skills.find((candidate) => candidate.sourcePath === remotePath) : undefined;
        if (!remote || remote.integrity !== update.expectedRemoteIntegrity) {
          throw new Error(`Source changed after review: ${update.skill}`);
        }
        // `remote.exportHash` is discovery's broad inventory hash. An update
        // may deliberately exclude machine-local directories (such as
        // `.agents`), so derive the fingerprint with the *same* reviewed
        // export policy used by `planLibraryUpdate`. Otherwise a valid source
        // can fail later with an integrity mismatch after the user confirms.
        const exportPlan = planSkillExport(update.skill, remote.sourcePath, GLOBAL_UPDATE_EXPORT_LIMITS);
        sourceSkills.push({
          skill: update.skill,
          path: update.skill,
          sourcePath: remote.sourcePath,
          integrity: exportPlan.sha256,
          exportLimits: GLOBAL_UPDATE_EXPORT_LIMITS,
        });
      }
      fetched += updates.length;
    }
    report(0, "", "applying");
    const plan = planLibraryUpdate({ root, skills: sourceSkills, portableFiles: {} });
    const applied = applyLibraryUpdatePlan(plan, {
      portableFiles: {},
      historyOperation: "library-update",
      historyRetention: GLOBAL_UPDATE_HISTORY_RETENTION,
    });
    const refreshed = await discoverSkills([{ path: root, kind: "shared" }]);
    const refreshedByName = new Map(refreshed.skills.map((skill) => [skill.name, skill]));
    const result = {
      updated: options.updates.map((update) => {
        const skill = refreshedByName.get(update.skill);
        if (!skill) throw new Error(`Updated skill could not be verified: ${update.skill}`);
        return { skill: update.skill, integrity: skill.integrity };
      }),
      historyId: applied.historyId,
    };
    report(options.updates.length, "", "complete");
    return result;
  } finally {
    await Promise.all(sessions.map((session) => session.dispose()));
  }
}

/** Read-only per-file comparison used by the explicit review screen. */
export async function reviewGlobalSkillUpdate(
  options: Omit<ApplyReviewedManagedSkillUpdatesOptions, "updates"> & { update: ReviewedManagedSkillUpdate },
): Promise<ReviewedGlobalSkillUpdateDetails> {
  const root = path.resolve(options.root);
  const local = await discoverSkills([{ path: root, kind: "shared" }]);
  const current = local.skills.find((skill) => skill.name === options.update.skill);
  if (!current || current.integrity !== options.update.expectedLocalIntegrity) {
    throw new Error(`Local skill changed after review: ${options.update.skill}`);
  }
  const record = options.sources[options.update.skill];
  if (!record || record.repository !== options.update.repository)
    throw new Error(`Source ownership changed after review: ${options.update.skill}`);
  const cacheDirectory = options.cacheDirectory?.(options.update.repository);
  const openSession = options.openSession ?? ((sessionOptions) => SkillSourceSession.open(sessionOptions));
  const session = await openSession({
    repository: options.update.repository,
    sourcePolicy: options.sourcePolicy ?? exactSourceSecurityPolicy([options.update.repository]),
    ...(cacheDirectory ? { cacheDirectory } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  try {
    const remotePath = session.findSkill(options.update.skill, options.update.skillPath);
    const remote = remotePath ? session.skills.find((skill) => skill.sourcePath === remotePath) : undefined;
    if (!remote || remote.integrity !== options.update.expectedRemoteIntegrity)
      throw new Error(`Source changed after review: ${options.update.skill}`);
    const localFiles = new Map(
      planSkillExport(options.update.skill, current.sourcePath, GLOBAL_UPDATE_EXPORT_LIMITS).files.map((file) => [
        file.relativePath,
        file,
      ]),
    );
    const remoteFiles = new Map(
      planSkillExport(options.update.skill, remote.sourcePath, GLOBAL_UPDATE_EXPORT_LIMITS).files.map((file) => [
        file.relativePath,
        file,
      ]),
    );
    const paths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
    const changes: ReviewedGlobalSkillFileChange[] = [];
    for (const filePath of [...paths].sort((a, b) => a.localeCompare(b, "en"))) {
      const localFile = localFiles.get(filePath);
      const remoteFile = remoteFiles.get(filePath);
      if (!localFile && remoteFile)
        changes.push({ path: filePath, kind: "added", localSize: null, remoteSize: remoteFile.size });
      else if (localFile && !remoteFile)
        changes.push({ path: filePath, kind: "removed", localSize: localFile.size, remoteSize: null });
      else if (localFile?.sha256 !== remoteFile?.sha256)
        changes.push({
          path: filePath,
          kind: "modified",
          localSize: localFile?.size ?? null,
          remoteSize: remoteFile?.size ?? null,
        });
    }
    return { skill: options.update.skill, changes };
  } finally {
    await session.dispose();
  }
}
