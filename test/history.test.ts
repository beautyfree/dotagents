import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyOperationUndo,
  listOperationHistory,
  operationHistoryRecordPath,
  planOperationUndo,
  readOperationHistory,
  writeOperationHistory,
} from "../src/history.js";
import { applyLibraryUpdatePlan, planLibraryUpdate } from "../src/library-update.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dotagents-history-"));
  temporary.push(directory);
  return directory;
}

describe("durable local operation history", () => {
  test("records a completed update and applies an explicitly reviewed Undo", () => {
    const library = root();
    const plan = planLibraryUpdate({ root: library, skills: [], portableFiles: { "note.md": "new\n" } });
    const applied = applyLibraryUpdatePlan(plan, { portableFiles: { "note.md": "new\n" } });

    expect(readFileSync(path.join(library, "note.md"), "utf8")).toBe("new\n");
    expect(listOperationHistory(library).map((entry) => entry.id)).toEqual([applied.historyId]);
    const undo = planOperationUndo(library, applied.historyId);
    expect(undo.hasConflicts).toBe(false);
    expect(applyOperationUndo(library, undo).restored).toEqual(["note.md"]);
    expect(existsSync(path.join(library, "note.md"))).toBe(false);
    expect(readOperationHistory(library, applied.historyId).undone_at).toBeString();
    expect(() => planOperationUndo(library, applied.historyId)).toThrow(/already been undone/i);
  });

  test("restores replaced content but rejects a target edited after the operation", () => {
    const library = root();
    writeFileSync(path.join(library, "note.md"), "old\n", "utf8");
    const plan = planLibraryUpdate({ root: library, skills: [], portableFiles: { "note.md": "new\n" } });
    const applied = applyLibraryUpdatePlan(plan, { portableFiles: { "note.md": "new\n" } });
    const undo = planOperationUndo(library, applied.historyId);
    expect(undo.hasConflicts).toBe(false);
    applyOperationUndo(library, undo);
    expect(readFileSync(path.join(library, "note.md"), "utf8")).toBe("old\n");

    const second = planLibraryUpdate({ root: library, skills: [], portableFiles: { "note.md": "again\n" } });
    const secondApplied = applyLibraryUpdatePlan(second, { portableFiles: { "note.md": "again\n" } });
    writeFileSync(path.join(library, "note.md"), "user edit\n", "utf8");
    const staleUndo = planOperationUndo(library, secondApplied.historyId);
    expect(staleUndo.hasConflicts).toBe(true);
    expect(() => applyOperationUndo(library, staleUndo)).toThrow(/conflicts|stale/i);
    expect(readFileSync(path.join(library, "note.md"), "utf8")).toBe("user edit\n");
  });

  test("never copies a possible secret into the history record or inverse payload", () => {
    const library = root();
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    writeFileSync(path.join(library, "note.md"), `${secret}\n`, "utf8");
    const plan = planLibraryUpdate({ root: library, skills: [], portableFiles: { "note.md": "safe\n" } });
    const applied = applyLibraryUpdatePlan(plan, { portableFiles: { "note.md": "safe\n" } });
    const record = readOperationHistory(library, applied.historyId);
    expect(record.undo_available).toBe(false);
    expect(record.changes[0]?.inverse).toEqual({ kind: "unavailable", reason: "sensitive-previous-content" });
    expect(readFileSync(operationHistoryRecordPath(library, applied.historyId), "utf8")).not.toContain(secret);
    expect(planOperationUndo(library, applied.historyId).hasConflicts).toBe(true);
  });

  test("bounds local history by configured record count", () => {
    const library = root();
    for (const [index, value] of ["a", "b", "c"].entries()) {
      writeOperationHistory(library, {
        operation: "test",
        sourcePlanId: value.repeat(64),
        recordId: `record-${index}`,
        completedAt: new Date(Date.UTC(2026, 0, index + 1)),
        retention: { maxRecords: 2, maxBytes: 1024 * 1024 },
        changes: [
          {
            path: `file-${index}.md`,
            itemKind: "file",
            postcondition: { kind: "file", sha256: value.repeat(64) },
          },
        ],
      });
    }
    expect(listOperationHistory(library).map((entry) => entry.id)).toEqual(["record-2", "record-1"]);
    expect(existsSync(operationHistoryRecordPath(library, "record-0"))).toBe(false);
  });

  test("stores history separately from a device-local target root", () => {
    const historyRoot = root();
    const targetRoot = root();
    writeFileSync(path.join(targetRoot, "note.md"), "created\n", "utf8");
    const sha256 = new Bun.CryptoHasher("sha256").update("created\n").digest("hex");
    const record = writeOperationHistory(historyRoot, {
      operation: "restore",
      sourcePlanId: "a".repeat(64),
      targetRoot,
      changes: [
        {
          path: "note.md",
          itemKind: "file",
          postcondition: { kind: "file", sha256 },
        },
      ],
    });
    expect(record.target_root).toBe(targetRoot);
    const undo = planOperationUndo(historyRoot, record.id);
    expect(applyOperationUndo(historyRoot, undo).restored).toEqual(["note.md"]);
    expect(existsSync(path.join(targetRoot, "note.md"))).toBe(false);
  });
});
