import { scanTextForSecrets } from "./audit.js";
import { type SourceSecurityPolicy, type SourceSecurityPolicyInput, type SourceTrustDecision } from "./source-policy.js";
export interface WorkspaceGitPort {
    run(args: string[], cwd: string, options?: {
        nonInteractive?: boolean;
        raw?: boolean;
        signal?: AbortSignal | undefined;
    }): Promise<string>;
}
export declare class NodeWorkspaceGitPort implements WorkspaceGitPort {
    private readonly environment;
    /**
     * Extra process environment for one host-controlled Git transport. It is
     * intentionally ephemeral: callers must never persist secrets in remotes or
     * repository config.
     */
    constructor(environment?: NodeJS.ProcessEnv);
    run(args: string[], cwd: string, options?: {
        nonInteractive?: boolean;
        raw?: boolean;
        signal?: AbortSignal | undefined;
    }): Promise<string>;
}
export interface GitWorkspaceStatus {
    branch: string;
    changed: boolean;
    ahead: number;
    behind: number;
    hasUpstream: boolean;
    remoteIdentity: string | null;
    head: string | null;
}
export type GitWorkspaceSecretFinding = {
    file: string;
    rule: ReturnType<typeof scanTextForSecrets>[number]["rule"];
    line: number;
    column: number;
};
export interface GitClonePlan {
    kind: "git-clone";
    schemaVersion: 4;
    planId: string;
    remote: string;
    remoteIdentity: string;
    destination: string;
    requestedRef: string;
    branch: string | null;
    resolvedCommit: string;
    committedAt: string;
    minimumAgeMinutes: number;
    releaseAgeExcluded: boolean;
    sourcePolicy: SourceSecurityPolicy;
    trust: SourceTrustDecision;
}
export interface GitInitializePlan {
    kind: "git-initialize";
    schemaVersion: 1;
    planId: string;
    library: string;
    remote: string | null;
    remoteIdentity: string | null;
    repositoryPresent: boolean;
    currentRemoteIdentity: string | null;
}
export interface GitCommitPlan {
    kind: "git-commit";
    schemaVersion: 1;
    planId: string;
    library: string;
    visibility: "private" | "team" | "public";
    message: string;
    baseHead: string | null;
    files: {
        path: string;
        hash: string | null;
    }[];
    secretFindings: GitWorkspaceSecretFinding[];
    unsafePaths: string[];
    auditErrors: {
        code: string;
        message: string;
        remediation: string;
        field?: string;
    }[];
    hasBlockers: boolean;
}
export interface GitPullPlan {
    kind: "git-pull";
    schemaVersion: 3;
    planId: string;
    library: string;
    visibility: "private" | "team" | "public";
    branch: string;
    baseHead: string;
    remoteHead: string;
    files: string[];
    secretFindings: GitWorkspaceSecretFinding[];
    unsafePaths: string[];
    auditErrors: {
        code: string;
        message: string;
        remediation: string;
        field?: string;
    }[];
    hasBlockers: boolean;
    remoteIdentity: string;
    committedAt: string;
    minimumAgeMinutes: number;
    releaseAgeExcluded: boolean;
    sourcePolicy: SourceSecurityPolicy;
    trust: SourceTrustDecision;
}
export interface GitPushPlan {
    kind: "git-push";
    schemaVersion: 2;
    planId: string;
    library: string;
    branch: string;
    head: string;
    remoteIdentity: string;
    ahead: number;
    sourcePolicy: SourceSecurityPolicy;
    trust: SourceTrustDecision;
}
/** Validates a portable Git remote without contacting it or reading credentials. */
export declare function credentialFreeGitRemote(remote: string): {
    remote: string;
    identity: string;
};
export declare function initializeLibraryGit(root: string, remote?: string, git?: WorkspaceGitPort): Promise<void>;
export declare function setLibraryRemote(root: string, remote: string, git?: WorkspaceGitPort): Promise<void>;
export declare function planLibraryGitInitialization(root: string, remote?: string, git?: WorkspaceGitPort): Promise<GitInitializePlan>;
export declare function applyLibraryGitInitialization(plan: GitInitializePlan, git?: WorkspaceGitPort): Promise<void>;
export declare function cloneLibrary(remote: string, target: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort): Promise<void>;
export declare function planLibraryClone(remote: string, target: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<GitClonePlan>;
/**
 * Resolve a branch, tag, HEAD, or immutable SHA into an exact reviewed commit.
 * The plan may contact only a source already allowed by Device policy; apply
 * fetches that exact commit and rejects any changed timestamp or policy.
 */
export declare function planGitCheckout(remote: string, target: string, requestedRef?: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<GitClonePlan>;
/** Apply the exact reviewed commit without assuming a particular library manifest. */
export declare function applyGitClonePlan(plan: GitClonePlan, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<void>;
export declare function applyLibraryClone(plan: GitClonePlan, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<void>;
export declare function getLibraryGitStatus(root: string, git?: WorkspaceGitPort): Promise<GitWorkspaceStatus>;
export declare function planLibraryCommit(root: string, message: string, visibility?: GitCommitPlan["visibility"], git?: WorkspaceGitPort): Promise<GitCommitPlan>;
export declare function applyLibraryCommit(plan: GitCommitPlan, git?: WorkspaceGitPort): Promise<string | null>;
export declare function fetchLibrary(root: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort, options?: {
    signal?: AbortSignal;
}): Promise<void>;
export declare function planLibraryPull(root: string, visibility?: GitPullPlan["visibility"], sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort): Promise<GitPullPlan>;
export declare function applyLibraryPull(plan: GitPullPlan, git?: WorkspaceGitPort): Promise<string>;
export declare function planLibraryPush(root: string, sourcePolicy?: SourceSecurityPolicyInput, git?: WorkspaceGitPort): Promise<GitPushPlan>;
export declare function applyLibraryPush(plan: GitPushPlan, git?: WorkspaceGitPort): Promise<void>;
//# sourceMappingURL=git-workspace.d.ts.map