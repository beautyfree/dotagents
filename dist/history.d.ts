import { z } from "zod";
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
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
        }, {
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
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
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
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
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
    }>, "many">;
    undo_available: z.ZodBoolean;
}, "strict", z.ZodTypeAny, {
    schema_version: 2;
    id: string;
    operation: string;
    source_plan_id: string;
    completed_at: string;
    target_root: string;
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
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
    }[];
    undo_available: boolean;
}, {
    schema_version: 2;
    id: string;
    operation: string;
    source_plan_id: string;
    completed_at: string;
    target_root: string;
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
            kind: "payload";
            payload: string;
            snapshot: {
                kind: "absent";
            } | {
                sha256: string;
                kind: "file";
            } | {
                integrity: string;
                kind: "directory";
            };
        } | {
            reason: "sensitive-previous-content" | "unsupported-previous-target";
            kind: "unavailable";
        };
        skill?: string | undefined;
    }[];
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