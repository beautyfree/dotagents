import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeWorkspaceGitPort, type WorkspaceGitPort } from "./git-workspace.js";
import { computePlanId } from "./plan.js";
import {
  parseSourceSecurityPolicy,
  requireMinimumReleaseAge,
  requireTrustedSource,
  type SourceSecurityPolicy,
  type SourceSecurityPolicyInput,
  type SourceTrustDecision,
} from "./source-policy.js";

export interface GitFastForwardPlan {
  kind: "git-fast-forward";
  schemaVersion: 3;
  planId: string;
  workspace: string;
  branch: string;
  baseHead: string;
  remoteHead: string;
  committedAt: string;
  minimumAgeMinutes: number;
  releaseAgeExcluded: boolean;
  files: string[];
  remoteIdentity: string;
  sourcePolicy: SourceSecurityPolicy;
  trust: SourceTrustDecision;
}

function parseNullPaths(value: string): string[] {
  return value
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function assertPlanId(plan: GitFastForwardPlan): void {
  const { planId, ...payload } = plan;
  if (computePlanId(payload) !== planId) throw new Error("Git fast-forward plan is stale or modified");
}

/**
 * Fetches remote-tracking metadata and describes a clean fast-forward without
 * changing the checked-out files. Credentials remain delegated to Git.
 */
export async function planGitFastForward(
  root: string,
  sourcePolicy: SourceSecurityPolicyInput = {},
  git: WorkspaceGitPort = new NodeWorkspaceGitPort(),
  options: { signal?: AbortSignal } = {},
): Promise<GitFastForwardPlan> {
  const workspace = await realpath(path.resolve(root));
  const topLevel = await realpath(
    path.resolve(await git.run(["rev-parse", "--show-toplevel"], workspace, { signal: options.signal })),
  );
  if (topLevel !== workspace) throw new Error("Git fast-forward root must be the repository worktree root");
  const changed = await git.run(["status", "--porcelain=v1", "-z"], workspace, {
    raw: true,
    signal: options.signal,
  });
  if (changed.length > 0) throw new Error("Git workspace has uncommitted changes; resolve them before review");
  const branch = await git.run(["symbolic-ref", "--quiet", "--short", "HEAD"], workspace, {
    signal: options.signal,
  });
  if (!branch) throw new Error("Git workspace must have a checked-out branch");
  const remote = await git.run(["remote", "get-url", "origin"], workspace, { signal: options.signal });
  const policy = parseSourceSecurityPolicy(sourcePolicy);
  const trust = requireTrustedSource(remote, policy);
  const baseHead = await git.run(["rev-parse", "HEAD"], workspace, { signal: options.signal });
  await git.run(["-c", "credential.interactive=false", "fetch", "origin", "--prune", "--no-tags"], workspace, {
    nonInteractive: true,
    signal: options.signal,
  });
  const remoteHead = await git.run(["rev-parse", `refs/remotes/origin/${branch}`], workspace, {
    signal: options.signal,
  });
  const committedAt = await git.run(["show", "-s", "--format=%cI", remoteHead], workspace, {
    signal: options.signal,
  });
  const releaseAge = requireMinimumReleaseAge(trust.source, committedAt, policy);
  const fastForward = await git
    .run(["merge-base", "--is-ancestor", baseHead, remoteHead], workspace, { signal: options.signal })
    .then(
      () => true,
      () => false,
    );
  if (!fastForward) throw new Error("Remote history is not a fast-forward; reconcile it explicitly");
  const files =
    baseHead === remoteHead
      ? []
      : parseNullPaths(
          await git.run(["diff", "--name-only", "-z", `${baseHead}..${remoteHead}`], workspace, {
            raw: true,
            signal: options.signal,
          }),
        );
  const payload = {
    kind: "git-fast-forward" as const,
    schemaVersion: 3 as const,
    workspace,
    branch,
    baseHead,
    remoteHead,
    committedAt: releaseAge.committedAt,
    minimumAgeMinutes: releaseAge.minimumAgeMinutes,
    releaseAgeExcluded: releaseAge.excluded,
    files,
    remoteIdentity: trust.source,
    sourcePolicy: policy,
    trust,
  };
  return { ...payload, planId: computePlanId(payload) };
}

/** Runs a callback against an ephemeral checkout of the exact reviewed remote commit. */
export async function inspectGitFastForwardPlan<T>(
  plan: GitFastForwardPlan,
  inspect: (checkout: string) => T | Promise<T>,
  git: WorkspaceGitPort = new NodeWorkspaceGitPort(),
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  assertPlanId(plan);
  const current = await planGitFastForward(plan.workspace, plan.sourcePolicy, git, options);
  if (current.planId !== plan.planId) throw new Error("Remote or local Git state changed after review");
  const parent = await mkdtemp(path.join(tmpdir(), "dotagents-fast-forward-review-"));
  const checkout = path.join(parent, "checkout");
  try {
    await git.run(["worktree", "add", "--detach", checkout, plan.remoteHead], plan.workspace, {
      signal: options.signal,
    });
    return await inspect(checkout);
  } finally {
    try {
      await git.run(["worktree", "remove", "--force", checkout], plan.workspace);
    } catch {
      await rm(checkout, { recursive: true, force: true });
    }
    await rm(parent, { recursive: true, force: true });
  }
}

/** Applies only the exact fast-forward that was previously reviewed. */
export async function applyGitFastForwardPlan(
  plan: GitFastForwardPlan,
  git: WorkspaceGitPort = new NodeWorkspaceGitPort(),
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  assertPlanId(plan);
  const current = await planGitFastForward(plan.workspace, plan.sourcePolicy, git, options);
  if (current.planId !== plan.planId) throw new Error("Remote or local Git state changed after review");
  if (plan.baseHead !== plan.remoteHead)
    await git.run(["merge", "--ff-only", plan.remoteHead], plan.workspace, options);
  return git.run(["rev-parse", "HEAD"], plan.workspace, options);
}
