import { type WorkspaceGitPort } from "./git-workspace.js";
import { type SourceSecurityPolicy, type SourceSecurityPolicyInput, type SourceTrustDecision } from "./source-policy.js";
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
/**
 * Fetches remote-tracking metadata and describes a clean fast-forward without
 * changing the checked-out files. Credentials remain delegated to Git.
 */
export declare function planGitFastForward(root: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<GitFastForwardPlan>;
/** Runs a callback against an ephemeral checkout of the exact reviewed remote commit. */
export declare function inspectGitFastForwardPlan<T>(plan: GitFastForwardPlan, inspect: (checkout: string) => T | Promise<T>, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<T>;
/** Applies only the exact fast-forward that was previously reviewed. */
export declare function applyGitFastForwardPlan(plan: GitFastForwardPlan, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<string>;
//# sourceMappingURL=git-fast-forward.d.ts.map