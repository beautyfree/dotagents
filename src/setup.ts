import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getSkillsCliLockPath, readSkillsCliLock, skillsCliLockToProvenance } from "./adapters/skills-cli.js";
import { builtinAgentCatalog, builtinAgentDescriptors } from "./catalog.js";
import { discoverSkills, suggestImportCandidates, type SkillDiscoveryRoot } from "./discovery.js";
import { applyImportPlan, type ApplyImportResult } from "./import-apply.js";
import { type ImportCandidate, planImport } from "./import.js";
import { applyInitializeLibraryPlan, planInitializeLibrary, type InitializeLibraryPlan } from "./init.js";
import {
  applyLibraryGitInitialization,
  credentialFreeGitRemote,
  planLibraryGitInitialization,
} from "./git-workspace.js";
import { loadLibrary } from "./library.js";
import { scanMachineAgents } from "./machine.js";
import { computePlanId } from "./plan.js";

export interface SetupOptions {
  root?: string;
  name?: string;
  home?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  remote?: string;
}

export interface SetupSummary {
  agentsDetected: number;
  skillsFound: number;
  owned: number;
  sourceLinked: number;
  needsReview: number;
  linkedAliases: number;
  skippedProvenance: number;
}

export interface SetupPlan {
  kind: "setup";
  schemaVersion: 1;
  planId: string;
  root: string;
  libraryName: string;
  remote: string | null;
  initialization: InitializeLibraryPlan | null;
  candidates: ImportCandidate[];
  summary: SetupSummary;
}

export interface ApplySetupResult {
  root: string;
  planId: string;
  createdLibrary: boolean;
  gitInitialized: boolean;
  import: ApplyImportResult;
}

function setupPlatform(platform: NodeJS.Platform): "darwin" | "linux" | "win32" {
  if (platform === "darwin" || platform === "linux" || platform === "win32") return platform;
  throw new Error(`Unsupported platform: ${platform}`);
}

function expand(template: string, home: string): string {
  return template === "~" ? home : template.startsWith("~/") ? path.join(home, template.slice(2)) : template;
}

function exists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function isLibrarySkill(root: string, candidate: Extract<ImportCandidate, { kind: "owned" }>): boolean {
  const target = path.join(root, "skills", candidate.skill);
  try {
    return realpathSync.native(candidate.sourcePath) === realpathSync.native(target);
  } catch {
    return path.resolve(candidate.sourcePath) === path.resolve(target);
  }
}

/**
 * Creates a concise first-run review from read-only machine discovery. It does
 * not create a library, copy a skill, contact Git, or mutate an agent.
 */
export async function planSetup(options: SetupOptions = {}): Promise<SetupPlan> {
  const home = path.resolve(options.home ?? homedir());
  const root = path.resolve(options.root ?? path.join(home, ".agents"));
  const remote = options.remote ? credentialFreeGitRemote(options.remote).remote : null;
  const platform = setupPlatform(options.platform ?? process.platform);
  const catalog = builtinAgentCatalog();
  const descriptors = builtinAgentDescriptors({ platforms: [platform] });
  const machine = await scanMachineAgents(descriptors, {
    platform,
    home,
    ...(options.environment ? { environment: options.environment } : {}),
  });
  const roots = new Map<string, SkillDiscoveryRoot>();
  const addRoot = (entry: SkillDiscoveryRoot) => {
    const key = `${entry.kind}:${entry.agent ?? ""}:${entry.path}`;
    if (!roots.has(key)) roots.set(key, entry);
  };

  addRoot({ path: path.join(root, "skills"), kind: "shared" });
  for (const agent of catalog) {
    // A Skills CLI global install may create only an agent's skill directory.
    // That is deliberately not enough to call the agent installed, but it is
    // still a real global skill location that must be visible to inventory.
    // `discoverSkills` ignores missing roots, so scanning the full catalog is
    // both read-only and bounded to known global paths.
    for (const skillRoot of agent.skillRoots)
      addRoot({ path: expand(skillRoot, home), kind: "agent-local", agent: agent.slug });
    for (const readableRoot of agent.readableRoots)
      addRoot({
        path: expand(readableRoot.path, home),
        kind: readableRoot.sourceAgent === "shared" ? "shared" : "inherited",
        ...(readableRoot.sourceAgent === "shared" ? {} : { agent: readableRoot.sourceAgent }),
      });
  }

  const discovery = await discoverSkills([...roots.values()]);
  const lock = readSkillsCliLock(getSkillsCliLockPath(options.environment ?? process.env, home));
  const provenance = lock ? skillsCliLockToProvenance(lock) : { provenance: [], skipped: [] };
  const suggested: ImportCandidate[] = suggestImportCandidates(discovery, provenance.provenance).map((candidate) => {
    if (candidate.kind === "owned" && isLibrarySkill(root, candidate)) {
      return {
        kind: "adopt-owned",
        skill: candidate.skill,
        sourcePath: path.join(root, "skills", candidate.skill),
        ...(candidate.agents ? { agents: candidate.agents } : {}),
      };
    }
    return candidate;
  });

  const hasManifest = exists(path.join(root, "skills.json"));
  if (hasManifest) {
    const library = await loadLibrary(root);
    if (!library.ok) throw new Error(`Cannot set up an invalid library at ${root}; run dotagents doctor first.`);
  }
  const initialization = hasManifest ? null : planInitializeLibrary(root, options.name);
  const summary: SetupSummary = {
    agentsDetected: machine.detectedSlugs.length,
    skillsFound: discovery.skills.length,
    owned: suggested.filter((candidate) => candidate.kind === "owned" || candidate.kind === "adopt-owned").length,
    sourceLinked: suggested.filter((candidate) => candidate.kind === "dependency").length,
    needsReview: suggested.filter((candidate) => candidate.kind === "local-only" || candidate.kind === "excluded")
      .length,
    linkedAliases: discovery.linkedAliases,
    skippedProvenance: provenance.skipped.length,
  };
  const payload = {
    kind: "setup" as const,
    schemaVersion: 1 as const,
    root,
    libraryName: options.name ?? path.basename(root),
    remote,
    initialization,
    candidates: suggested,
    summary,
  };
  return { ...payload, planId: computePlanId(payload) };
}

/** Applies only the reviewed setup plan. Existing agent folders are never modified. */
export async function applySetupPlan(plan: SetupPlan): Promise<ApplySetupResult> {
  const { planId, ...payload } = plan;
  if (computePlanId(payload) !== planId) throw new Error("Setup plan is stale or modified");
  if (plan.initialization) await applyInitializeLibraryPlan(plan.initialization);
  const importPlan = await planImport(plan.root, plan.candidates);
  if (importPlan.hasConflicts || importPlan.secretFindings.length > 0)
    throw new Error(
      "Setup needs review before it can make changes. Run dotagents setup again to see the latest summary.",
    );
  const imported = await applyImportPlan(importPlan);
  if (plan.remote) {
    const gitPlan = await planLibraryGitInitialization(plan.root, plan.remote);
    await applyLibraryGitInitialization(gitPlan);
  }
  return {
    root: plan.root,
    planId,
    createdLibrary: Boolean(plan.initialization),
    gitInitialized: Boolean(plan.remote),
    import: imported,
  };
}
