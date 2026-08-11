import { type SecretFinding } from "./audit.js";
import { type SkillExportPlan } from "./export-policy.js";
export interface LibraryUpdateSkillInput {
    skill: string;
    path: string;
    sourcePath: string;
    integrity?: string;
}
export interface PlanLibraryUpdateInput {
    root: string;
    skills: LibraryUpdateSkillInput[];
    portableFiles: Record<string, string>;
}
export type LibraryUpdateTargetSnapshot = {
    kind: "absent";
} | {
    kind: "file";
    sha256: string;
} | {
    kind: "directory";
    integrity: string;
} | {
    kind: "symlink";
    linkTarget: string;
} | {
    kind: "unsupported";
    description: string;
};
export interface LibraryUpdateFileOperation {
    kind: "file";
    path: string;
    target: string;
    sha256: string;
    size: number;
    expectedTarget: LibraryUpdateTargetSnapshot;
    reason?: string;
}
export interface LibraryUpdateSkillOperation {
    kind: "skill";
    skill: string;
    path: string;
    target: string;
    sourcePlan: SkillExportPlan;
    expectedTarget: LibraryUpdateTargetSnapshot;
    reason?: string;
}
export type LibraryUpdateOperation = LibraryUpdateFileOperation | LibraryUpdateSkillOperation;
export type LibraryUpdateSecretFinding = SecretFinding & {
    item: string;
    relativePath: string;
};
export interface LibraryUpdatePlan {
    kind: "library-update";
    schemaVersion: 1;
    planId: string;
    root: string;
    expectedRoot: {
        kind: "absent";
    } | {
        kind: "directory";
        realPath: string;
    };
    operations: LibraryUpdateOperation[];
    secretFindings: LibraryUpdateSecretFinding[];
    hasConflicts: boolean;
}
export interface ApplyLibraryUpdateOptions {
    portableFiles: Record<string, string>;
    journalPath?: string;
    /** Human-readable origin retained in Device-local history. */
    historyOperation?: "library-update" | "resource-adopt" | "doctor-repair" | "scope-migration";
    /** Test/UI seam. Throwing rolls back every committed operation. */
    beforeOperation?: (operation: LibraryUpdateOperation, index: number) => void;
}
export interface ApplyLibraryUpdateResult {
    planId: string;
    updated: string[];
    historyId: string;
}
export declare const LIBRARY_UPDATE_JOURNAL_VERSION: 1;
type LibraryUpdateJournalEntry = {
    operation: LibraryUpdateOperation;
    stagePath: string;
    backupPath: string;
    hadPrevious: boolean;
    status: "pending" | "staged" | "backing-up" | "backed-up" | "committing" | "applied";
};
type LibraryUpdateJournal = {
    kind: "library-update";
    schemaVersion: typeof LIBRARY_UPDATE_JOURNAL_VERSION;
    planId: string;
    phase: "applying" | "completed" | "rolling-back";
    historyId: string | null;
    entries: LibraryUpdateJournalEntry[];
};
export interface LibraryUpdateRecoveryPreview {
    kind: "library-update";
    phase: LibraryUpdateJournal["phase"];
    itemCount: number;
    changedItemCount: number;
}
/**
 * Creates one deterministic no-write plan for replacing reviewed skill trees
 * and portable root files. File bodies are deliberately excluded from the
 * serializable plan; apply receives and revalidates them at the adapter seam.
 */
export declare function planLibraryUpdate(input: PlanLibraryUpdateInput): LibraryUpdatePlan;
export declare function libraryUpdateJournalPath(root: string): string;
export declare function hasLibraryUpdateRecovery(journalPath: string): boolean;
/**
 * Describe an interrupted library update without exposing machine paths or
 * file contents. Callers can show the scope of recovery before asking the
 * user to roll it back.
 */
export declare function inspectLibraryUpdateRecovery(journalPath: string): LibraryUpdateRecoveryPreview | null;
/** Recover a completed or interrupted update without deleting later user edits. */
export declare function recoverLibraryUpdate(journalPath: string): boolean;
/** Apply exactly the reviewed update as one rollback-capable transaction. */
export declare function applyLibraryUpdatePlan(plan: LibraryUpdatePlan, options: ApplyLibraryUpdateOptions): ApplyLibraryUpdateResult;
export {};
//# sourceMappingURL=library-update.d.ts.map