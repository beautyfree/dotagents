import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { applyGitFastForwardPlan, planGitFastForward, type GitFastForwardPlan } from "./git-fast-forward.js";
import type { SourceSecurityPolicyInput } from "./source-policy.js";

export type LinkedSkillPackage = {
  root: string;
  skills: string[];
};

export type LinkedSkillPackageUpdate = {
  package: LinkedSkillPackage;
  state: "up-to-date" | "ready" | "local-changes";
  plan: GitFastForwardPlan | null;
  localChanges: Array<{ path: string; status: string }>;
};

const execFileAsync = promisify(execFile);

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function gitRootFor(directory: string): Promise<string | null> {
  let current = directory;
  for (;;) {
    try {
      await lstat(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

/**
 * Finds package worktrees from the links that are actually installed under a
 * shared skills directory. A package is not identified by its name: any Git
 * worktree with one or more direct skill links is handled the same way.
 */
export async function discoverLinkedSkillPackages(sharedRoot: string): Promise<LinkedSkillPackage[]> {
  const root = await realpath(sharedRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const link = path.join(root, entry.name);
    try {
      const target = await realpath(link);
      const packageRoot = await gitRootFor(target);
      if (!packageRoot || !contains(packageRoot, target)) continue;
      grouped.set(packageRoot, [...(grouped.get(packageRoot) ?? []), entry.name]);
    } catch {
      // A dangling or unreadable link cannot be updated and stays untouched.
    }
  }
  return [...grouped.entries()]
    .map(([packageRoot, skills]) => ({ root: packageRoot, skills: skills.sort((a, b) => a.localeCompare(b, "en")) }))
    .sort((a, b) => a.root.localeCompare(b.root, "en"));
}

async function requireInstalledPackage(sharedRoot: string, packageRoot: string): Promise<LinkedSkillPackage> {
  const resolved = await realpath(packageRoot);
  const packages = await discoverLinkedSkillPackages(sharedRoot);
  const found = packages.find((candidate) => candidate.root === resolved);
  if (!found) throw new Error("This package no longer owns any installed skill links.");
  return found;
}

/** Read-only review of a package worktree. No package-specific adapter needed. */
export async function planLinkedSkillPackageUpdate(options: {
  sharedRoot: string;
  packageRoot: string;
  sourcePolicy?: SourceSecurityPolicyInput;
}): Promise<LinkedSkillPackageUpdate> {
  const pkg = await requireInstalledPackage(options.sharedRoot, options.packageRoot);
  const status = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd: pkg.root, encoding: "utf8" });
  const localChanges = status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ path: line.slice(3).trim(), status: line.slice(0, 2).trim() || "?" }))
    .filter((change) => Boolean(change.path));
  if (localChanges.length > 0) return { package: pkg, state: "local-changes", plan: null, localChanges };
  const plan = await planGitFastForward(pkg.root, options.sourcePolicy);
  return { package: pkg, state: plan.baseHead === plan.remoteHead ? "up-to-date" : "ready", plan, localChanges: [] };
}

/**
 * Applies the exact reviewed Git fast-forward. Existing links target paths
 * inside the same worktree, so they remain intact; no linked skill is ever
 * replaced individually.
 */
export async function applyLinkedSkillPackageUpdate(options: {
  sharedRoot: string;
  packageRoot: string;
  plan: GitFastForwardPlan;
}): Promise<{ package: LinkedSkillPackage; head: string }> {
  const pkg = await requireInstalledPackage(options.sharedRoot, options.packageRoot);
  if (pkg.root !== options.plan.workspace)
    throw new Error("Package update plan does not match this installed package.");
  return { package: pkg, head: await applyGitFastForwardPlan(options.plan) };
}
