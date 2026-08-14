import { type SkillDiscoveryRoot } from "./discovery.js";
import { type SourceSecurityPolicyInput } from "./source-policy.js";
import type { LocalSkillSourceRecord } from "./source-registry.js";
import { SkillSourceSession } from "./source-session.js";
import type { SkillsCliLock } from "./adapters/skills-cli.js";
export type GlobalSkillUpdateState = "up-to-date" | "update-available" | "local-changes" | "review-required" | "source-unavailable" | "not-trackable";
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
    newFromSources: Array<{
        skill: string;
        repository: string;
        skillPath: string;
        description: string | null;
    }>;
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
export type ApplyReviewedManagedSkillUpdatesOptions = Omit<GlobalSkillUpdateCheckOptions, "roots" | "managedRoots" | "sources" | "onProgress"> & {
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
    updated: Array<{
        skill: string;
        integrity: string;
    }>;
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
 * Read-only global skill update discovery. It fetches only reviewed Git
 * sources into dotagents-owned cache checkouts and never mutates any skill,
 * user Git checkout, or agent installation.
 */
export declare function checkGlobalSkillUpdates(options: GlobalSkillUpdateCheckOptions): Promise<GlobalSkillUpdateCheck>;
/**
 * Applies an explicitly reviewed set of updates to dotagents-managed copies
 * under one canonical root. Each local and remote fingerprint is rechecked
 * immediately before `library-update` stages every replacement and commits
 * them using its rollback journal. Manual Git checkouts are deliberately
 * outside this operation.
 */
export declare function applyReviewedManagedSkillUpdates(options: ApplyReviewedManagedSkillUpdatesOptions): Promise<ApplyReviewedManagedSkillUpdatesResult>;
/** Read-only per-file comparison used by the explicit review screen. */
export declare function reviewGlobalSkillUpdate(options: Omit<ApplyReviewedManagedSkillUpdatesOptions, "updates"> & {
    update: ReviewedManagedSkillUpdate;
}): Promise<ReviewedGlobalSkillUpdateDetails>;
//# sourceMappingURL=global-skill-updates.d.ts.map