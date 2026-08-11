import { type SkillExportFinding } from "./export-policy.js";
export type ThreeWayAction = "take-remote" | "publish-local" | "unchanged" | "kept-local" | "conflict" | "unmanaged";
export interface ThreeWaySkill {
    id: string;
    baseSha256: string | null;
    localSha256: string | null;
    remoteSha256: string;
    action: ThreeWayAction;
}
/** Pure three-way classification. It never chooses an overwrite for unknown local state. */
export declare function classifyThreeWaySkill(id: string, baseSha256: string | null, localSha256: string | null, remoteSha256: string, keptRemoteSha256?: string | null): ThreeWaySkill;
export interface ReconciliationSourceSkill {
    id: string;
    path: string;
    integrity: string;
}
export interface ReconciliationBaseEntry {
    baseIntegrity: string | null;
    keptRemoteIntegrity?: string | null;
}
export type ReconciliationTargetSnapshot = {
    kind: "absent";
} | {
    kind: "directory";
    integrity: string;
} | {
    kind: "linked-directory";
    linkedPaths: string[];
} | {
    kind: "symlink";
    linkTarget: string;
} | {
    kind: "file";
    sha256: string;
} | {
    kind: "unsupported";
    description: string;
};
export interface LibraryReconciliationOperation {
    skill: string;
    source: string;
    target: string;
    remoteIntegrity: string;
    localIntegrity: string | null;
    baseIntegrity: string | null;
    keptRemoteIntegrity: string | null;
    expectedTarget: ReconciliationTargetSnapshot;
    action: ThreeWayAction;
    reason?: string;
}
export type LibraryReconciliationFinding = SkillExportFinding & {
    skill: string;
};
export interface LibraryReconciliationPlan {
    kind: "library-reconcile";
    schemaVersion: 1;
    planId: string;
    sourceRoot: string;
    targetRoot: string;
    operations: LibraryReconciliationOperation[];
    secretFindings: LibraryReconciliationFinding[];
    hasConflicts: boolean;
}
export interface PlanLibraryReconciliationInput {
    sourceRoot: string;
    targetRoot: string;
    skills: ReconciliationSourceSkill[];
    base?: Record<string, ReconciliationBaseEntry>;
}
export interface TakeRemoteDecision {
    skill: string;
    action: "take-remote";
}
export interface ApplyLibraryReconciliationOptions {
    journalPath?: string;
    /** Device-local history store. Targets remain rooted at plan.targetRoot. */
    historyRoot?: string;
    historyOperation?: string;
    /** Test/UI seam. Throwing rolls back every earlier operation. */
    beforeOperation?: (operation: LibraryReconciliationOperation, index: number) => void;
}
export interface ApplyLibraryReconciliationResult {
    planId: string;
    restored: string[];
    historyId?: string;
}
export declare const LIBRARY_RECONCILIATION_JOURNAL_VERSION: 1;
/**
 * Builds one deterministic, no-write three-way plan for a portable library and
 * a machine's canonical skills root. Sources are integrity checked and links
 * escaping the reviewed source root are rejected.
 */
export declare function planLibraryReconciliation(input: PlanLibraryReconciliationInput): LibraryReconciliationPlan;
export declare function hasLibraryReconciliationRecovery(journalPath: string): boolean;
/** Rolls back an interrupted apply without deleting content changed after the interruption. */
export declare function recoverLibraryReconciliation(journalPath: string): boolean;
/**
 * Applies only explicit take-remote decisions. Conflicts and unmanaged local
 * targets therefore require a decision at the CLI/UI seam before this module
 * can replace them.
 */
export declare function applyLibraryReconciliationPlan(plan: LibraryReconciliationPlan, decisions: TakeRemoteDecision[], options?: ApplyLibraryReconciliationOptions): ApplyLibraryReconciliationResult;
//# sourceMappingURL=reconcile.d.ts.map