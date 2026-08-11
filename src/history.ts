import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { scanTextForSecrets } from "./audit.js";
import { planSkillExport } from "./export-policy.js";
import { normalizePortablePath } from "./paths.js";
import { computePlanId } from "./plan.js";

export const OPERATION_HISTORY_VERSION = 2 as const;
export const OPERATION_UNDO_JOURNAL_VERSION = 1 as const;

const snapshotSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }).strict(),
  z.object({ kind: z.literal("file"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("directory"), integrity: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export type HistoryTargetSnapshot = z.infer<typeof snapshotSchema>;

const historyChangeSchema = z
  .object({
    path: z.string().min(1),
    itemKind: z.enum(["file", "skill"]),
    skill: z.string().min(1).optional(),
    postcondition: snapshotSchema,
    inverse: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("absent") }).strict(),
      z
        .object({
          kind: z.literal("payload"),
          payload: z.string().min(1),
          snapshot: snapshotSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal("unavailable"),
          reason: z.enum(["sensitive-previous-content", "unsupported-previous-target"]),
        })
        .strict(),
    ]),
  })
  .strict();

const operationHistoryRecordSchema = z
  .object({
    schema_version: z.literal(OPERATION_HISTORY_VERSION),
    id: z.string().min(1),
    operation: z.string().min(1),
    source_plan_id: z.string().regex(/^[a-f0-9]{64}$/),
    completed_at: z.string().datetime(),
    target_root: z.string().min(1),
    changes: z.array(historyChangeSchema),
    undo_available: z.boolean(),
  })
  .strict();

const operationHistoryUndoMarkerSchema = z
  .object({
    schema_version: z.literal(1),
    undone_at: z.string().datetime(),
  })
  .strict();

type StoredOperationHistoryRecord = z.infer<typeof operationHistoryRecordSchema>;
export type OperationHistoryRecord = StoredOperationHistoryRecord & { undone_at: string | null };

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

export const DEFAULT_OPERATION_HISTORY_RETENTION: OperationHistoryRetention = {
  maxRecords: 50,
  maxBytes: 100 * 1024 * 1024,
};

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function portableRelativePath(value: string): string {
  const normalized = normalizePortablePath(value);
  if (!normalized || normalized !== value.replaceAll("\\", "/")) {
    throw new Error(`History path is not portable: ${value}`);
  }
  return normalized;
}

export function operationHistoryRoot(root: string): string {
  return path.join(path.resolve(root), ".dotagents", "history");
}

export function operationHistoryRecordPath(root: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)) throw new Error("Invalid operation history id");
  return path.join(operationHistoryRoot(root), id, "record.json");
}

export function operationHistoryUndoMarkerPath(root: string, id: string): string {
  return path.join(path.dirname(operationHistoryRecordPath(root, id)), "undone.json");
}

function atomicJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, filePath);
}

function treeBytes(target: string): number {
  const metadata = statSync(target);
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory()) return 0;
  return readdirSync(target, { withFileTypes: true }).reduce(
    (total, entry) => total + treeBytes(path.join(target, entry.name)),
    0,
  );
}

function retentionPolicy(input?: Partial<OperationHistoryRetention>): OperationHistoryRetention {
  const value = { ...DEFAULT_OPERATION_HISTORY_RETENTION, ...input };
  if (!Number.isInteger(value.maxRecords) || value.maxRecords < 1 || value.maxRecords > 10_000) {
    throw new Error("History maxRecords must be an integer between 1 and 10000");
  }
  if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1 || value.maxBytes > 10 * 1024 * 1024 * 1024) {
    throw new Error("History maxBytes must be between 1 byte and 10 GiB");
  }
  return value;
}

export function pruneOperationHistory(
  root: string,
  input?: Partial<OperationHistoryRetention>,
  preserveId?: string,
): void {
  const policy = retentionPolicy(input);
  const records = listOperationHistory(root).map((record) => ({
    record,
    directory: path.dirname(operationHistoryRecordPath(root, record.id)),
  }));
  let bytes = records.reduce((total, entry) => total + treeBytes(entry.directory), 0);
  let count = records.length;
  for (const entry of [...records].reverse()) {
    if (count <= policy.maxRecords && bytes <= policy.maxBytes) break;
    if (entry.record.id === preserveId) continue;
    const size = treeBytes(entry.directory);
    rmSync(entry.directory, { recursive: true, force: true });
    bytes -= size;
    count -= 1;
  }
  if (count > policy.maxRecords || bytes > policy.maxBytes) {
    throw new Error("The newest operation history record exceeds the configured retention limit");
  }
}

function snapshotTarget(target: string, itemKind: "file" | "skill", skill?: string): HistoryTargetSnapshot {
  if (!existsSync(target)) return { kind: "absent" };
  const metadata = lstatSync(target);
  if (itemKind === "file") {
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("History file target is not a regular file");
    return { kind: "file", sha256: sha256(readFileSync(target)) };
  }
  if (!skill || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("History skill target is not a regular directory");
  }
  return { kind: "directory", integrity: planSkillExport(skill, target).sha256 };
}

function payloadIsSensitive(previousPath: string, input: OperationHistoryChangeInput): boolean {
  if (input.itemKind === "file") return scanTextForSecrets(readFileSync(previousPath, "utf8")).length > 0;
  if (!input.skill) throw new Error(`History skill name is missing for ${input.path}`);
  return planSkillExport(input.skill, previousPath).secretFindings.length > 0;
}

/**
 * Persist a successful operation and its bounded inverse payload. The caller
 * retains its transaction backups; this function copies rather than moves so
 * a crash can still roll the original operation back.
 */
export function writeOperationHistory(root: string, input: WriteOperationHistoryInput): OperationHistoryRecord {
  if (!/^[a-f0-9]{64}$/.test(input.sourcePlanId)) throw new Error("History source plan id is invalid");
  const completedAt = (input.completedAt ?? new Date()).toISOString();
  const id = input.recordId ?? `${completedAt.replace(/[:.]/g, "-")}-${input.sourcePlanId.slice(0, 12)}`;
  const recordPath = operationHistoryRecordPath(root, id);
  const directory = path.dirname(recordPath);
  if (existsSync(directory)) throw new Error(`Operation history already exists: ${id}`);
  const staging = `${directory}.tmp-${process.pid}-${randomUUID()}`;
  const retention = retentionPolicy(input.retention);
  mkdirSync(path.join(staging, "payload"), { recursive: true });
  try {
    const changes: StoredOperationHistoryRecord["changes"] = [];
    for (const [index, raw] of input.changes.entries()) {
      const relativePath = portableRelativePath(raw.path);
      if (raw.previousUnavailableReason) {
        changes.push({
          path: relativePath,
          itemKind: raw.itemKind,
          ...(raw.skill ? { skill: raw.skill } : {}),
          postcondition: raw.postcondition,
          inverse: { kind: "unavailable", reason: raw.previousUnavailableReason },
        });
        continue;
      }
      if (!raw.previousPath) {
        changes.push({
          path: relativePath,
          itemKind: raw.itemKind,
          ...(raw.skill ? { skill: raw.skill } : {}),
          postcondition: raw.postcondition,
          inverse: { kind: "absent" },
        });
        continue;
      }
      const previous = snapshotTarget(raw.previousPath, raw.itemKind, raw.skill);
      if (payloadIsSensitive(raw.previousPath, raw)) {
        changes.push({
          path: relativePath,
          itemKind: raw.itemKind,
          ...(raw.skill ? { skill: raw.skill } : {}),
          postcondition: raw.postcondition,
          inverse: { kind: "unavailable", reason: "sensitive-previous-content" },
        });
        continue;
      }
      const payload = `payload/${index}`;
      cpSync(raw.previousPath, path.join(staging, payload), { recursive: true, errorOnExist: true });
      if (
        JSON.stringify(snapshotTarget(path.join(staging, payload), raw.itemKind, raw.skill)) !==
        JSON.stringify(previous)
      ) {
        throw new Error(`History payload changed while copying: ${relativePath}`);
      }
      changes.push({
        path: relativePath,
        itemKind: raw.itemKind,
        ...(raw.skill ? { skill: raw.skill } : {}),
        postcondition: raw.postcondition,
        inverse: { kind: "payload", payload, snapshot: previous },
      });
    }
    const record = operationHistoryRecordSchema.parse({
      schema_version: OPERATION_HISTORY_VERSION,
      id,
      operation: input.operation,
      source_plan_id: input.sourcePlanId,
      completed_at: completedAt,
      target_root: path.resolve(input.targetRoot ?? root),
      changes,
      undo_available: changes.every((change) => change.inverse.kind !== "unavailable"),
    });
    writeFileSync(path.join(staging, "record.json"), `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    if (treeBytes(staging) > retention.maxBytes) {
      throw new Error("Operation history payload exceeds the configured byte limit");
    }
    mkdirSync(path.dirname(directory), { recursive: true });
    renameSync(staging, directory);
    pruneOperationHistory(root, retention, id);
    return { ...record, undone_at: null };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function readOperationHistory(root: string, id: string): OperationHistoryRecord {
  const record = operationHistoryRecordSchema.parse(
    JSON.parse(readFileSync(operationHistoryRecordPath(root, id), "utf8")),
  );
  const markerPath = operationHistoryUndoMarkerPath(root, id);
  const marker = existsSync(markerPath)
    ? operationHistoryUndoMarkerSchema.parse(JSON.parse(readFileSync(markerPath, "utf8")))
    : null;
  return { ...record, undone_at: marker?.undone_at ?? null };
}

function markOperationHistoryUndone(root: string, id: string): void {
  const markerPath = operationHistoryUndoMarkerPath(root, id);
  if (existsSync(markerPath)) return;
  atomicJson(markerPath, {
    schema_version: 1,
    undone_at: new Date().toISOString(),
  });
}

/** Remove only one exact local history record, used when its source transaction rolls back. */
export function removeOperationHistory(root: string, id: string): void {
  rmSync(path.dirname(operationHistoryRecordPath(root, id)), { recursive: true, force: true });
}

export function listOperationHistory(root: string): OperationHistoryRecord[] {
  const historyRoot = operationHistoryRoot(root);
  if (!existsSync(historyRoot)) return [];
  return readdirSync(historyRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes(".tmp-"))
    .flatMap((entry) => {
      try {
        return [readOperationHistory(root, entry.name)];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.completed_at.localeCompare(left.completed_at, "en"));
}

export interface OperationUndoChange {
  path: string;
  itemKind: "file" | "skill";
  skill?: string;
  expectedCurrent: HistoryTargetSnapshot;
  inverse: Extract<OperationHistoryRecord["changes"][number]["inverse"], { kind: "absent" | "payload" }>;
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

export function planOperationUndo(root: string, historyId: string): OperationUndoPlan {
  const record = readOperationHistory(root, historyId);
  if (record.undone_at) throw new Error("This operation has already been undone");
  const targetRoot = path.resolve(record.target_root);
  const changes: OperationUndoChange[] = record.changes.map((change) => {
    const current = snapshotTarget(path.join(targetRoot, ...change.path.split("/")), change.itemKind, change.skill);
    const reason =
      change.inverse.kind === "unavailable"
        ? change.inverse.reason === "sensitive-previous-content"
          ? "Previous content was not retained because it may contain a secret"
          : "The previous local target could not be retained safely"
        : JSON.stringify(current) !== JSON.stringify(change.postcondition)
          ? "Target changed after the recorded operation"
          : undefined;
    const inverse = change.inverse.kind === "unavailable" ? ({ kind: "absent" } as const) : change.inverse;
    return {
      path: change.path,
      itemKind: change.itemKind,
      ...(change.skill ? { skill: change.skill } : {}),
      expectedCurrent: change.postcondition,
      inverse,
      ...(reason ? { reason } : {}),
    };
  });
  const data = {
    kind: "operation-undo" as const,
    schemaVersion: 1 as const,
    historyId,
    sourcePlanId: record.source_plan_id,
    changes,
    hasConflicts: changes.some((change) => change.reason !== undefined),
  };
  return { ...data, planId: computePlanId(data) };
}

type UndoJournalEntry = OperationUndoChange & {
  target: string;
  rollbackPath: string;
  stagePath: string;
  status: "pending" | "backed-up" | "applied";
};

type UndoJournal = {
  kind: "operation-undo";
  schemaVersion: typeof OPERATION_UNDO_JOURNAL_VERSION;
  planId: string;
  historyId: string;
  phase: "applying" | "completed";
  entries: UndoJournalEntry[];
};

export function operationUndoJournalPath(root: string): string {
  return path.join(path.resolve(root), ".dotagents", "operation-undo-journal.json");
}

function rollbackUndo(journalPath: string, journal: UndoJournal): void {
  for (const entry of [...journal.entries].reverse()) {
    rmSync(entry.stagePath, { recursive: true, force: true });
    if (entry.status === "pending") continue;
    if (existsSync(entry.target)) rmSync(entry.target, { recursive: true, force: true });
    if (existsSync(entry.rollbackPath)) {
      mkdirSync(path.dirname(entry.target), { recursive: true });
      renameSync(entry.rollbackPath, entry.target);
    }
  }
  rmSync(journalPath, { force: true });
}

export function recoverOperationUndo(root: string): boolean {
  const journalPath = operationUndoJournalPath(root);
  if (!existsSync(journalPath)) return false;
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as UndoJournal;
  if (journal.kind !== "operation-undo" || journal.schemaVersion !== OPERATION_UNDO_JOURNAL_VERSION) {
    throw new Error("Unsupported operation Undo journal");
  }
  if (journal.phase === "completed") {
    markOperationHistoryUndone(root, journal.historyId);
    for (const entry of journal.entries) {
      rmSync(entry.rollbackPath, { recursive: true, force: true });
      rmSync(entry.stagePath, { recursive: true, force: true });
    }
    rmSync(journalPath, { force: true });
    return true;
  }
  rollbackUndo(journalPath, journal);
  return true;
}

export function applyOperationUndo(root: string, plan: OperationUndoPlan): { planId: string; restored: string[] } {
  const current = planOperationUndo(root, plan.historyId);
  const record = readOperationHistory(root, plan.historyId);
  const { planId: _planId, ...payload } = plan;
  if (current.planId !== plan.planId || computePlanId(payload) !== plan.planId) {
    throw new Error("Operation Undo plan is stale or modified");
  }
  if (current.hasConflicts) throw new Error("Operation Undo plan contains conflicts");
  const historyRoot = path.resolve(root);
  const targetRoot = path.resolve(record.target_root);
  const journalPath = operationUndoJournalPath(historyRoot);
  if (existsSync(journalPath)) throw new Error("An unfinished operation Undo requires recovery first");
  const nonce = randomUUID();
  const journal: UndoJournal = {
    kind: "operation-undo",
    schemaVersion: OPERATION_UNDO_JOURNAL_VERSION,
    planId: plan.planId,
    historyId: plan.historyId,
    phase: "applying",
    entries: plan.changes.map((change) => {
      const target = path.join(targetRoot, ...change.path.split("/"));
      return {
        ...change,
        target,
        rollbackPath: `${target}.dotagents-undo-backup-${nonce}`,
        stagePath: `${target}.dotagents-undo-stage-${nonce}`,
        status: "pending",
      };
    }),
  };
  atomicJson(journalPath, journal);
  try {
    const recordDirectory = path.dirname(operationHistoryRecordPath(historyRoot, plan.historyId));
    for (const entry of journal.entries) {
      if (
        JSON.stringify(snapshotTarget(entry.target, entry.itemKind, entry.skill)) !==
        JSON.stringify(entry.expectedCurrent)
      ) {
        throw new Error(`Operation Undo target changed after review: ${entry.path}`);
      }
      if (entry.inverse.kind === "payload") {
        const source = path.join(recordDirectory, ...entry.inverse.payload.split("/"));
        if (
          JSON.stringify(snapshotTarget(source, entry.itemKind, entry.skill)) !== JSON.stringify(entry.inverse.snapshot)
        ) {
          throw new Error(`Operation Undo payload changed after review: ${entry.path}`);
        }
        cpSync(source, entry.stagePath, { recursive: true, errorOnExist: true });
      }
    }
    for (const entry of journal.entries) {
      renameSync(entry.target, entry.rollbackPath);
      entry.status = "backed-up";
      atomicJson(journalPath, journal);
      if (entry.inverse.kind === "payload") renameSync(entry.stagePath, entry.target);
      entry.status = "applied";
      atomicJson(journalPath, journal);
    }
    journal.phase = "completed";
    atomicJson(journalPath, journal);
  } catch (error) {
    rollbackUndo(journalPath, journal);
    throw error;
  }
  // Once the completed phase is durable, recovery must finish this operation;
  // it must never roll it back merely because marker/backup cleanup is interrupted.
  markOperationHistoryUndone(historyRoot, plan.historyId);
  for (const entry of journal.entries) rmSync(entry.rollbackPath, { recursive: true, force: true });
  rmSync(journalPath, { force: true });
  return { planId: plan.planId, restored: plan.changes.map((change) => change.path) };
}
