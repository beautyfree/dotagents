import { z } from "zod";
import { type SkillExportLimits } from "./export-policy.js";
export declare const OPERATION_HISTORY_VERSION: 2;
export declare const OPERATION_UNDO_JOURNAL_VERSION: 1;
declare const snapshotSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"absent">;
}, "strict", z.ZodTypeAny, {
    kind: "absent";
}, {
    kind: "absent";
}>, z.ZodObject<{
    kind: z.ZodLiteral<"file">;
    sha256: z.ZodString;
}, "strict", z.ZodTypeAny, {
    sha256: string;
    kind: "file";
}, {
    sha256: string;
    kind: "file";
}>, z.ZodObject<{
    kind: z.ZodLiteral<"directory">;
    integrity: z.ZodString;
}, "strict", z.ZodTypeAny, {
    integrity: string;
    kind: "directory";
}, {
    integrity: string;
    kind: "directory";
}>]>;
export type HistoryTargetSnapshot = z.infer<typeof snapshotSchema>;
declare const operationHistoryRecordSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<2>;
    id: z.ZodString;
    operation: z.ZodString;
    source_plan_id: z.ZodString;
    completed_at: z.ZodString;
    target_root: z.ZodString;
    changes: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        itemKind: z.ZodEnum<["file", "skill"]>;
        skill: z.ZodOptional<z.ZodString>;
        export_limits: z.ZodOptional<z.ZodObject<{
            maxFiles: z.ZodNumber;
            maxBytes: z.ZodNumber;
            excludedDirectories: z.ZodArray<z.ZodString, "many">;
            trustedFileRoots: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        }, {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        }>>;
        postcondition: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"absent">;
        }, "strict", z.ZodTypeAny, {
            kind: "absent";
        }, {
            kind: "absent";
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"file">;
            sha256: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            sha256: string;
            kind: "file";
        }, {
            sha256: string;
            kind: "file";
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"directory">;
            integrity: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            integrity: string;
            kind: "directory";
        }, {
            integrity: string;
            kind: "directory";
        }>]>;
        inverse: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
            kind: z.ZodLiteral<"absent">;
        }, "strict", z.ZodTypeAny, {
            kind: "absent";
        }, {
            kind: "absent";
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"payload">;
            payload: z.ZodString;
            snapshot: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
                kind: z.ZodLiteral<"absent">;
            }, "strict", z.ZodTypeAny, {
                kind: "absent";
            }, {
                kind: "absent";
            }>, z.ZodObject<{
                kind: z.ZodLiteral<"file">;
                sha256: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                sha256: string;
                kind: "file";
            }, {
                sha256: string;
                kind: "file";
            }>, z.ZodObject<{
                kind: z.ZodLiteral<"directory">;
                integrity: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                integrity: string;
                kind: "directory";
            }, {
                integrity: string;
                kind: "directory";
            }>]>;
        }, "strict", z.ZodTypeAny, {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        }, {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        }>, z.ZodObject<{
            kind: z.ZodLiteral<"unavailable">;
            reason: z.ZodEnum<["sensitive-previous-content", "unsupported-previous-target"]>;
        }, "strict", z.ZodTypeAny, {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        }, {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        }>]>;
    }, "strict", z.ZodTypeAny, {
        path: string;
        itemKind: "skill" | "file";
        postcondition: {
            kind: "absent";
        } | {
            sha256: string;
            kind: "file";
        } | {
            integrity: string;
            kind: "directory";
        };
        inverse: {
            kind: "absent";
        } | {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
        export_limits?: {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        } | undefined;
    }, {
        path: string;
        itemKind: "skill" | "file";
        postcondition: {
            kind: "absent";
        } | {
            sha256: string;
            kind: "file";
        } | {
            integrity: string;
            kind: "directory";
        };
        inverse: {
            kind: "absent";
        } | {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
        export_limits?: {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        } | undefined;
    }>, "many">;
    undo_available: z.ZodBoolean;
}, "strict", z.ZodTypeAny, {
    schema_version: 2;
    changes: {
        path: string;
        itemKind: "skill" | "file";
        postcondition: {
            kind: "absent";
        } | {
            sha256: string;
            kind: "file";
        } | {
            integrity: string;
            kind: "directory";
        };
        inverse: {
            kind: "absent";
        } | {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
        export_limits?: {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        } | undefined;
    }[];
    id: string;
    operation: string;
    source_plan_id: string;
    completed_at: string;
    target_root: string;
    undo_available: boolean;
}, {
    schema_version: 2;
    changes: {
        path: string;
        itemKind: "skill" | "file";
        postcondition: {
            kind: "absent";
        } | {
            sha256: string;
            kind: "file";
        } | {
            integrity: string;
            kind: "directory";
        };
        inverse: {
            kind: "absent";
        } | {
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
            kind: "payload";
            payload: string;
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
        export_limits?: {
            maxFiles: number;
            maxBytes: number;
            excludedDirectories: string[];
            trustedFileRoots?: string[] | undefined;
        } | undefined;
    }[];
    id: string;
    operation: string;
    source_plan_id: string;
    completed_at: string;
    target_root: string;
    undo_available: boolean;
}>;
type StoredOperationHistoryRecord = z.infer<typeof operationHistoryRecordSchema>;
export type OperationHistoryRecord = StoredOperationHistoryRecord & {
    undone_at: string | null;
};
export interface OperationHistoryChangeInput {
    path: string;
    itemKind: "file" | "skill";
    skill?: string;
    /** Retain a non-default reviewed export budget for a future undo check. */
    exportLimits?: SkillExportLimits;
    postcondition: HistoryTargetSnapshot;
    /** Transaction backup of the previous target. Absent means the target was newly created. */
    previousPath?: string;
    /** Record a non-restorable previous target without copying or following it. */
    previousUnavailableReason?: "unsupported-previous-target";
}
export interface WriteOperationHistoryInput {
    operation: string;
    sourcePlanId: string;
    changes: OperationHistoryChangeInput[];
    completedAt?: Date;
    recordId?: string;
    /** Device-local target root when history is stored somewhere else. */
    targetRoot?: string;
    retention?: Partial<OperationHistoryRetention>;
}
export interface OperationHistoryRetention {
    maxRecords: number;
    maxBytes: number;
}
export declare const DEFAULT_OPERATION_HISTORY_RETENTION: OperationHistoryRetention;
export declare function operationHistoryRoot(root: string): string;
export declare function operationHistoryRecordPath(root: string, id: string): string;
export declare function operationHistoryUndoMarkerPath(root: string, id: string): string;
export declare function pruneOperationHistory(root: string, input?: Partial<OperationHistoryRetention>, preserveId?: string): void;
/**
 * Persist a successful operation and its bounded inverse payload. The caller
 * retains its transaction backups; this function copies rather than moves so
 * a crash can still roll the original operation back.
 */
export declare function writeOperationHistory(root: string, input: WriteOperationHistoryInput): OperationHistoryRecord;
export declare function readOperationHistory(root: string, id: string): OperationHistoryRecord;
/** Remove only one exact local history record, used when its source transaction rolls back. */
export declare function removeOperationHistory(root: string, id: string): void;
export declare function listOperationHistory(root: string): OperationHistoryRecord[];
export interface OperationUndoChange {
    path: string;
    itemKind: "file" | "skill";
    skill?: string;
    exportLimits?: SkillExportLimits;
    expectedCurrent: HistoryTargetSnapshot;
    inverse: Extract<OperationHistoryRecord["changes"][number]["inverse"], {
        kind: "absent" | "payload";
    }>;
    reason?: string;
}
export interface OperationUndoPlan {
    kind: "operation-undo";
    schemaVersion: 1;
    planId: string;
    historyId: string;
    sourcePlanId: string;
    changes: OperationUndoChange[];
    hasConflicts: boolean;
}
export declare function planOperationUndo(root: string, historyId: string): OperationUndoPlan;
export declare function operationUndoJournalPath(root: string): string;
export declare function recoverOperationUndo(root: string): boolean;
export declare function applyOperationUndo(root: string, plan: OperationUndoPlan): {
    planId: string;
    restored: string[];
};
export {};
//# sourceMappingURL=history.d.ts.map