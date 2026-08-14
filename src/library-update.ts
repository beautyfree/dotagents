import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type SecretFinding, scanTextForSecrets } from "./audit.js";
import { planSkillExport, type SkillExportLimits, type SkillExportPlan } from "./export-policy.js";
import { normalizePortablePath } from "./paths.js";
import { computePlanId } from "./plan.js";
import {
  removeOperationHistory,
  writeOperationHistory,
  type HistoryTargetSnapshot,
  type OperationHistoryRetention,
} from "./history.js";

export interface LibraryUpdateSkillInput {
  skill: string;
  path: string;
  sourcePath: string;
  integrity?: string;
  /** Optional reviewed limits for large, global skill bundles. */
  exportLimits?: SkillExportLimits;
}

export interface PlanLibraryUpdateInput {
  root: string;
  skills: LibraryUpdateSkillInput[];
  portableFiles: Record<string, string>;
}

export type LibraryUpdateTargetSnapshot =
  | { kind: "absent" }
  | { kind: "file"; sha256: string }
  | { kind: "directory"; integrity: string }
  | { kind: "symlink"; linkTarget: string }
  | { kind: "unsupported"; description: string };

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
  /** Retained in the reviewed plan so apply rechecks large skills consistently. */
  exportLimits?: SkillExportLimits;
  expectedTarget: LibraryUpdateTargetSnapshot;
  reason?: string;
}

export type LibraryUpdateOperation = LibraryUpdateFileOperation | LibraryUpdateSkillOperation;
export type LibraryUpdateSecretFinding = SecretFinding & { item: string; relativePath: string };

export interface LibraryUpdatePlan {
  kind: "library-update";
  schemaVersion: 1;
  planId: string;
  root: string;
  expectedRoot: { kind: "absent" } | { kind: "directory"; realPath: string };
  operations: LibraryUpdateOperation[];
  secretFindings: LibraryUpdateSecretFinding[];
  hasConflicts: boolean;
}

export interface ApplyLibraryUpdateOptions {
  portableFiles: Record<string, string>;
  /**
   * Exact, value-free findings explicitly acknowledged in the reviewed UI.
   * A different path, rule, line, or column is never covered by this approval.
   */
  acknowledgedSecretFindings?: readonly LibraryUpdateSecretFinding[];
  journalPath?: string;
  /** Override only for a reviewed operation which explicitly needs more local undo history. */
  historyRetention?: Partial<OperationHistoryRetention>;
  /** Human-readable origin retained in Device-local history. */
  historyOperation?: "library-update" | "doctor-repair";
  /** Test/UI seam. Throwing rolls back every committed operation. */
  beforeOperation?: (operation: LibraryUpdateOperation, index: number) => void;
}

export interface ApplyLibraryUpdateResult {
  planId: string;
  updated: string[];
  historyId: string;
}

function isAcknowledgedSecretFinding(
  finding: LibraryUpdateSecretFinding,
  acknowledgements: readonly LibraryUpdateSecretFinding[],
): boolean {
  return acknowledgements.some(
    (acknowledgement) =>
      acknowledgement.item === finding.item &&
      acknowledgement.relativePath === finding.relativePath &&
      acknowledgement.rule === finding.rule &&
      acknowledgement.line === finding.line &&
      acknowledgement.column === finding.column,
  );
}

export const LIBRARY_UPDATE_JOURNAL_VERSION = 1 as const;

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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function rootSnapshot(root: string): LibraryUpdatePlan["expectedRoot"] {
  if (!existsSync(root)) return { kind: "absent" };
  const metadata = lstatSync(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Library update root must be a regular directory: ${root}`);
  }
  return { kind: "directory", realPath: realpathSync(root) };
}

function portablePath(value: string): string {
  const normalized = normalizePortablePath(value);
  if (!normalized || normalized !== value.replaceAll("\\", "/") || value.includes("\\")) {
    throw new Error(`Library update path is not portable: ${value}`);
  }
  return normalized;
}

function assertNonOverlappingPaths(paths: string[]): void {
  const sorted = [...paths].sort((left, right) => left.localeCompare(right, "en"));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    if (current === previous || current.startsWith(`${previous}/`)) {
      throw new Error(`Library update paths overlap: ${previous} and ${current}`);
    }
  }
}

function snapshotFileTarget(target: string): LibraryUpdateTargetSnapshot {
  if (!existsSync(target)) return { kind: "absent" };
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink()) return { kind: "symlink", linkTarget: readlinkSync(target) };
  if (metadata.isFile()) return { kind: "file", sha256: sha256(readFileSync(target)) };
  if (metadata.isDirectory()) return { kind: "unsupported", description: "The portable file target is a directory" };
  return { kind: "unsupported", description: "The portable file target is not a regular file" };
}

function snapshotSkillTarget(
  skill: string,
  target: string,
  exportLimits?: SkillExportLimits,
): LibraryUpdateTargetSnapshot {
  if (!existsSync(target)) return { kind: "absent" };
  const metadata = lstatSync(target);
  if (metadata.isSymbolicLink()) return { kind: "symlink", linkTarget: readlinkSync(target) };
  if (metadata.isFile()) return { kind: "unsupported", description: "The skill target is a regular file" };
  if (!metadata.isDirectory()) return { kind: "unsupported", description: "The skill target is not a directory" };
  try {
    return { kind: "directory", integrity: planSkillExport(skill, target, exportLimits).sha256 };
  } catch (error) {
    return {
      kind: "unsupported",
      description: error instanceof Error ? error.message : "The existing skill cannot be reviewed safely",
    };
  }
}

function operationConflict(
  snapshot: LibraryUpdateTargetSnapshot,
  kind: LibraryUpdateOperation["kind"],
): string | undefined {
  if (snapshot.kind === "absent") return undefined;
  if (kind === "file" && snapshot.kind === "file") return undefined;
  if (kind === "skill" && snapshot.kind === "directory") return undefined;
  if (snapshot.kind === "unsupported") return snapshot.description;
  return `The ${kind} target is a ${snapshot.kind}`;
}

/**
 * Creates one deterministic no-write plan for replacing reviewed skill trees
 * and portable root files. File bodies are deliberately excluded from the
 * serializable plan; apply receives and revalidates them at the adapter seam.
 */
export function planLibraryUpdate(input: PlanLibraryUpdateInput): LibraryUpdatePlan {
  const root = path.resolve(input.root);
  const expectedRoot = rootSnapshot(root);
  const operations: LibraryUpdateOperation[] = [];
  const secretFindings: LibraryUpdateSecretFinding[] = [];
  const portableFiles = Object.entries(input.portableFiles)
    .map(([file, content]) => ({ path: portablePath(file), content }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  for (const file of portableFiles) {
    for (const finding of scanTextForSecrets(file.content)) {
      secretFindings.push({ ...finding, item: file.path, relativePath: file.path });
    }
    const target = path.join(root, ...file.path.split("/"));
    const expectedTarget = snapshotFileTarget(target);
    const reason = operationConflict(expectedTarget, "file");
    operations.push({
      kind: "file",
      path: file.path,
      target,
      sha256: sha256(file.content),
      size: Buffer.byteLength(file.content),
      expectedTarget,
      ...(reason ? { reason } : {}),
    });
  }
  for (const inputSkill of [...input.skills].sort((left, right) => left.skill.localeCompare(right.skill, "en"))) {
    const skillPath = portablePath(inputSkill.path);
    const sourcePlan = planSkillExport(inputSkill.skill, inputSkill.sourcePath, inputSkill.exportLimits);
    if (inputSkill.integrity && inputSkill.integrity !== sourcePlan.sha256) {
      throw new Error(`Library update source integrity mismatch: ${inputSkill.skill}`);
    }
    secretFindings.push(
      ...sourcePlan.secretFindings.map((finding) => ({
        ...finding,
        item: inputSkill.skill,
        relativePath: `${skillPath}/${finding.relativePath}`,
      })),
    );
    const target = path.join(root, ...skillPath.split("/"));
    const expectedTarget = snapshotSkillTarget(inputSkill.skill, target, inputSkill.exportLimits);
    const reason = operationConflict(expectedTarget, "skill");
    operations.push({
      kind: "skill",
      skill: inputSkill.skill,
      path: skillPath,
      target,
      sourcePlan,
      ...(inputSkill.exportLimits ? { exportLimits: inputSkill.exportLimits } : {}),
      expectedTarget,
      ...(reason ? { reason } : {}),
    });
  }
  operations.sort((left, right) => left.path.localeCompare(right.path, "en"));
  assertNonOverlappingPaths(operations.map((operation) => operation.path));
  const payload = {
    kind: "library-update" as const,
    schemaVersion: 1 as const,
    root,
    expectedRoot,
    operations,
    secretFindings,
    hasConflicts: operations.some((operation) => operation.reason !== undefined),
  };
  return { ...payload, planId: computePlanId(payload) };
}

export function libraryUpdateJournalPath(root: string): string {
  return path.join(path.resolve(root), ".dotagents", "library-update-journal.json");
}

function assertRootUnchanged(plan: LibraryUpdatePlan): void {
  const current = rootSnapshot(plan.root);
  if (JSON.stringify(current) !== JSON.stringify(plan.expectedRoot)) {
    throw new Error("Library update root changed after review");
  }
}

function writeJournal(filePath: string, journal: LibraryUpdateJournal): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, filePath);
}

function currentSnapshot(operation: LibraryUpdateOperation): LibraryUpdateTargetSnapshot {
  return operation.kind === "file"
    ? snapshotFileTarget(operation.target)
    : snapshotSkillTarget(operation.skill, operation.target, operation.exportLimits);
}

function assertTargetUnchanged(operation: LibraryUpdateOperation): void {
  if (JSON.stringify(currentSnapshot(operation)) !== JSON.stringify(operation.expectedTarget)) {
    throw new Error(`Library update target changed after review: ${operation.path}`);
  }
}

function portableFileContents(
  plan: LibraryUpdatePlan,
  provided: Record<string, string>,
  acknowledgements: readonly LibraryUpdateSecretFinding[],
): Map<string, string> {
  const expected = plan.operations.filter(
    (operation): operation is LibraryUpdateFileOperation => operation.kind === "file",
  );
  const actual = new Map<string, string>();
  for (const [file, content] of Object.entries(provided)) actual.set(portablePath(file), content);
  if (actual.size !== expected.length || expected.some((operation) => !actual.has(operation.path))) {
    throw new Error("Portable files do not match the reviewed library update plan");
  }
  for (const operation of expected) {
    const content = actual.get(operation.path);
    if (
      content === undefined ||
      sha256(content) !== operation.sha256 ||
      Buffer.byteLength(content) !== operation.size
    ) {
      throw new Error(`Portable file changed after review: ${operation.path}`);
    }
    const unacknowledgedFindings = scanTextForSecrets(content).filter(
      (finding) =>
        !isAcknowledgedSecretFinding(
          { ...finding, item: operation.path, relativePath: operation.path },
          acknowledgements,
        ),
    );
    if (unacknowledgedFindings.length > 0) {
      throw new Error(`Portable file now contains possible secrets: ${operation.path}`);
    }
  }
  return actual;
}

function assertSkillSource(
  operation: LibraryUpdateSkillOperation,
  acknowledgements: readonly LibraryUpdateSecretFinding[],
): SkillExportPlan {
  const current = planSkillExport(operation.skill, operation.sourcePlan.sourcePath, operation.exportLimits);
  if (current.sha256 !== operation.sourcePlan.sha256) {
    throw new Error(`Library update source changed after review: ${operation.skill}`);
  }
  const unacknowledgedFindings = current.secretFindings.filter(
    (finding) =>
      !isAcknowledgedSecretFinding(
        {
          ...finding,
          item: operation.skill,
          relativePath: `${operation.path}/${finding.relativePath}`,
        },
        acknowledgements,
      ),
  );
  if (unacknowledgedFindings.length > 0) {
    throw new Error(`Library update source now contains possible secrets: ${operation.skill}`);
  }
  return current;
}

function stageSkill(
  operation: LibraryUpdateSkillOperation,
  destination: string,
  acknowledgements: readonly LibraryUpdateSecretFinding[],
): void {
  const sourcePlan = assertSkillSource(operation, acknowledgements);
  mkdirSync(destination, { recursive: false });
  for (const file of sourcePlan.files) {
    const content = readFileSync(path.join(sourcePlan.sourcePath, ...file.relativePath.split("/")));
    if (sha256(content) !== file.sha256) {
      throw new Error(`Library update source changed while staging: ${operation.skill}/${file.relativePath}`);
    }
    const target = path.join(destination, ...file.relativePath.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: "wx" });
  }
  if (planSkillExport(operation.skill, destination, operation.exportLimits).sha256 !== sourcePlan.sha256) {
    throw new Error(`Staged library update changed: ${operation.skill}`);
  }
}

function stageOperation(
  operation: LibraryUpdateOperation,
  stagePath: string,
  files: Map<string, string>,
  acknowledgements: readonly LibraryUpdateSecretFinding[],
): void {
  rmSync(stagePath, { recursive: true, force: true });
  mkdirSync(path.dirname(stagePath), { recursive: true });
  if (operation.kind === "skill") {
    stageSkill(operation, stagePath, acknowledgements);
    return;
  }
  const content = files.get(operation.path);
  if (content === undefined) throw new Error(`Portable file is missing: ${operation.path}`);
  writeFileSync(stagePath, content, { encoding: "utf8", flag: "wx" });
  if (sha256(readFileSync(stagePath)) !== operation.sha256) {
    throw new Error(`Staged portable file changed: ${operation.path}`);
  }
}

function targetMatchesApplied(entry: LibraryUpdateJournalEntry): boolean {
  try {
    const snapshot = currentSnapshot(entry.operation);
    return entry.operation.kind === "file"
      ? snapshot.kind === "file" && snapshot.sha256 === entry.operation.sha256
      : snapshot.kind === "directory" && snapshot.integrity === entry.operation.sourcePlan.sha256;
  } catch {
    return false;
  }
}

function rollbackLibraryUpdate(filePath: string, journal: LibraryUpdateJournal): void {
  journal.phase = "rolling-back";
  writeJournal(filePath, journal);
  for (const entry of [...journal.entries].reverse()) {
    rmSync(entry.stagePath, { recursive: true, force: true });
    if (!["backing-up", "backed-up", "committing", "applied"].includes(entry.status)) continue;
    if (entry.hadPrevious) {
      if (!existsSync(entry.backupPath)) {
        if (entry.status === "backing-up" && existsSync(entry.operation.target)) continue;
        throw new Error(`Library update backup is missing: ${entry.operation.path}`);
      }
      if (existsSync(entry.operation.target)) {
        if (!targetMatchesApplied(entry)) {
          throw new Error(`Library update target changed after interruption: ${entry.operation.path}`);
        }
        rmSync(entry.operation.target, { recursive: true, force: true });
      }
      mkdirSync(path.dirname(entry.operation.target), { recursive: true });
      renameSync(entry.backupPath, entry.operation.target);
    } else if (existsSync(entry.operation.target)) {
      if (!targetMatchesApplied(entry)) {
        throw new Error(`Library update target changed after interruption: ${entry.operation.path}`);
      }
      rmSync(entry.operation.target, { recursive: true, force: true });
    }
  }
  if (journal.historyId) removeOperationHistory(path.dirname(path.dirname(filePath)), journal.historyId);
  rmSync(filePath, { force: true });
}

export function hasLibraryUpdateRecovery(journalPath: string): boolean {
  return existsSync(journalPath);
}

/**
 * Describe an interrupted library update without exposing machine paths or
 * file contents. Callers can show the scope of recovery before asking the
 * user to roll it back.
 */
export function inspectLibraryUpdateRecovery(journalPath: string): LibraryUpdateRecoveryPreview | null {
  if (!existsSync(journalPath)) return null;
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as LibraryUpdateJournal;
  if (journal.kind !== "library-update" || journal.schemaVersion !== LIBRARY_UPDATE_JOURNAL_VERSION) {
    throw new Error("Unsupported library update journal");
  }
  return {
    kind: "library-update",
    phase: journal.phase,
    itemCount: journal.entries.length,
    changedItemCount: journal.entries.filter((entry) =>
      ["backing-up", "backed-up", "committing", "applied"].includes(entry.status),
    ).length,
  };
}

/** Recover a completed or interrupted update without deleting later user edits. */
export function recoverLibraryUpdate(journalPath: string): boolean {
  if (!existsSync(journalPath)) return false;
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as LibraryUpdateJournal;
  if (journal.kind !== "library-update" || journal.schemaVersion !== LIBRARY_UPDATE_JOURNAL_VERSION) {
    throw new Error("Unsupported library update journal");
  }
  if (journal.phase === "completed") {
    for (const entry of journal.entries) {
      rmSync(entry.stagePath, { recursive: true, force: true });
      rmSync(entry.backupPath, { recursive: true, force: true });
    }
    rmSync(journalPath, { force: true });
    return true;
  }
  rollbackLibraryUpdate(journalPath, journal);
  return true;
}

/** Apply exactly the reviewed update as one rollback-capable transaction. */
export function applyLibraryUpdatePlan(
  plan: LibraryUpdatePlan,
  options: ApplyLibraryUpdateOptions,
): ApplyLibraryUpdateResult {
  const { planId, ...payload } = plan;
  if (computePlanId(payload) !== planId) throw new Error("Library update plan is stale or modified");
  if (plan.hasConflicts) throw new Error("Library update plan contains target conflicts");
  const unacknowledgedSecretFindings = plan.secretFindings.filter(
    (finding) => !isAcknowledgedSecretFinding(finding, options.acknowledgedSecretFindings ?? []),
  );
  if (unacknowledgedSecretFindings.length > 0) {
    throw new Error(`Library update is blocked by ${unacknowledgedSecretFindings.length} possible secret finding(s)`);
  }
  const acknowledgements = options.acknowledgedSecretFindings ?? [];
  const files = portableFileContents(plan, options.portableFiles, acknowledgements);
  const journalPath = options.journalPath ?? libraryUpdateJournalPath(plan.root);
  if (existsSync(journalPath)) throw new Error("An unfinished library update requires recovery first");
  assertRootUnchanged(plan);
  for (const operation of plan.operations) {
    assertTargetUnchanged(operation);
    if (operation.kind === "skill") assertSkillSource(operation, acknowledgements);
  }
  const nonce = randomUUID();
  const journal: LibraryUpdateJournal = {
    kind: "library-update",
    schemaVersion: LIBRARY_UPDATE_JOURNAL_VERSION,
    planId,
    phase: "applying",
    historyId: null,
    entries: plan.operations.map((operation) => ({
      operation,
      stagePath: `${operation.target}.dotagents-stage-${nonce}`,
      backupPath: `${operation.target}.dotagents-backup-${nonce}`,
      hadPrevious: operation.expectedTarget.kind !== "absent",
      status: "pending",
    })),
  };
  writeJournal(journalPath, journal);
  try {
    for (const entry of journal.entries) {
      stageOperation(entry.operation, entry.stagePath, files, acknowledgements);
      entry.status = "staged";
      writeJournal(journalPath, journal);
    }
    for (const entry of journal.entries) assertTargetUnchanged(entry.operation);
    for (const [index, entry] of journal.entries.entries()) {
      options.beforeOperation?.(entry.operation, index);
      assertTargetUnchanged(entry.operation);
      mkdirSync(path.dirname(entry.operation.target), { recursive: true });
      if (entry.hadPrevious) {
        entry.status = "backing-up";
        writeJournal(journalPath, journal);
        renameSync(entry.operation.target, entry.backupPath);
        entry.status = "backed-up";
        writeJournal(journalPath, journal);
      }
      entry.status = "committing";
      writeJournal(journalPath, journal);
      renameSync(entry.stagePath, entry.operation.target);
      entry.status = "applied";
      writeJournal(journalPath, journal);
    }
    journal.historyId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${planId.slice(0, 12)}-${nonce.slice(0, 8)}`;
    writeJournal(journalPath, journal);
    const history = writeOperationHistory(plan.root, {
      operation: options.historyOperation ?? "library-update",
      sourcePlanId: planId,
      recordId: journal.historyId,
      ...(options.historyRetention ? { retention: options.historyRetention } : {}),
      changes: journal.entries.map((entry) => ({
        path: entry.operation.path,
        itemKind: entry.operation.kind,
        ...(entry.operation.kind === "skill" ? { skill: entry.operation.skill } : {}),
        ...(entry.operation.kind === "skill" && entry.operation.exportLimits
          ? { exportLimits: entry.operation.exportLimits }
          : {}),
        postcondition: (entry.operation.kind === "file"
          ? { kind: "file", sha256: entry.operation.sha256 }
          : { kind: "directory", integrity: entry.operation.sourcePlan.sha256 }) as HistoryTargetSnapshot,
        ...(entry.hadPrevious ? { previousPath: entry.backupPath } : {}),
      })),
    });
    journal.phase = "completed";
    writeJournal(journalPath, journal);
    for (const entry of journal.entries) {
      rmSync(entry.stagePath, { recursive: true, force: true });
      rmSync(entry.backupPath, { recursive: true, force: true });
    }
    rmSync(journalPath, { force: true });
    return { planId, updated: journal.entries.map((entry) => entry.operation.path), historyId: history.id };
  } catch (error) {
    rollbackLibraryUpdate(journalPath, journal);
    throw error;
  }
}
