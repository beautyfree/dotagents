import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planSkillExport } from "../src/export-policy.js";
import {
  applyLibraryUpdatePlan,
  type LibraryUpdatePlan,
  inspectLibraryUpdateRecovery,
  libraryUpdateJournalPath,
  planLibraryUpdate,
  recoverLibraryUpdate,
} from "../src/library-update.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; workspace: string; source: string } {
  const root = mkdtempSync(path.join(tmpdir(), "dotagents-library-update-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const source = path.join(root, "source", "writing");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, "SKILL.md"), "# Writing\n");
  return { root, workspace, source };
}

function plan(
  current: ReturnType<typeof fixture>,
  files: Record<string, string> = { "skills.json": '{"skills":[]}\n' },
): LibraryUpdatePlan {
  return planLibraryUpdate({
    root: current.workspace,
    skills: [
      {
        skill: "writing",
        path: "skills/writing",
        sourcePath: current.source,
        integrity: planSkillExport("writing", current.source).sha256,
      },
    ],
    portableFiles: files,
  });
}

describe("transactional library update", () => {
  it("builds a deterministic no-write plan and applies files and skills together", () => {
    const current = fixture();
    const files = { "skills.json": '{"skills":["skills/writing"]}\n' };
    const review = plan(current, files);
    expect(review.planId).toBe(plan(current, files).planId);
    expect(libraryUpdateJournalPath(current.workspace)).toBe(
      path.join(current.workspace, ".dotagents", "library-update-journal.json"),
    );
    expect(existsSync(path.join(current.workspace, "skills.json"))).toBe(false);
    expect(applyLibraryUpdatePlan(review, { portableFiles: files }).updated).toEqual(["skills.json", "skills/writing"]);
    expect(readFileSync(path.join(current.workspace, "skills.json"), "utf8")).toBe(files["skills.json"]);
    expect(readFileSync(path.join(current.workspace, "skills", "writing", "SKILL.md"), "utf8")).toBe("# Writing\n");
  });

  it("creates an absent reviewed workspace but rejects a root that appeared after review", () => {
    const current = fixture();
    const absentWorkspace = path.join(current.root, "new-workspace");
    const files = { "skills.json": "{}\n" };
    const review = planLibraryUpdate({
      root: absentWorkspace,
      skills: [{ skill: "writing", path: "skills/writing", sourcePath: current.source }],
      portableFiles: files,
    });
    expect(review.expectedRoot).toEqual({ kind: "absent" });
    applyLibraryUpdatePlan(review, { portableFiles: files });
    expect(readFileSync(path.join(absentWorkspace, "skills", "writing", "SKILL.md"), "utf8")).toBe("# Writing\n");

    const replacedRoot = path.join(current.root, "replaced-root");
    const stale = planLibraryUpdate({ root: replacedRoot, skills: [], portableFiles: files });
    mkdirSync(replacedRoot);
    expect(() => applyLibraryUpdatePlan(stale, { portableFiles: files })).toThrow("root changed after review");
  });

  it("rejects stale files, sources, targets, secrets, and overlapping paths before writes", () => {
    const staleFile = fixture();
    const files = { "skills.json": "{}\n" };
    const filePlan = plan(staleFile, files);
    expect(() => applyLibraryUpdatePlan(filePlan, { portableFiles: { "skills.json": "changed\n" } })).toThrow(
      "changed after review",
    );
    expect(existsSync(path.join(staleFile.workspace, "skills.json"))).toBe(false);

    const staleSource = fixture();
    const sourcePlan = plan(staleSource, files);
    writeFileSync(path.join(staleSource.source, "SKILL.md"), "# Changed\n");
    expect(() => applyLibraryUpdatePlan(sourcePlan, { portableFiles: files })).toThrow("source changed after review");
    expect(existsSync(path.join(staleSource.workspace, "skills.json"))).toBe(false);

    const staleTarget = fixture();
    const targetPlan = plan(staleTarget, files);
    writeFileSync(path.join(staleTarget.workspace, "skills.json"), "appeared\n");
    expect(() => applyLibraryUpdatePlan(targetPlan, { portableFiles: files })).toThrow("target changed after review");

    const secret = fixture();
    const secretFiles = { "dotagents.yaml": "token: github_pat_abcdefghijklmnopqrstuvwxyz123456\n" };
    const secretPlan = plan(secret, secretFiles);
    expect(secretPlan.secretFindings).toEqual([
      { item: "dotagents.yaml", relativePath: "dotagents.yaml", rule: "github-token", line: 1, column: 8 },
    ]);
    expect(JSON.stringify(secretPlan)).not.toContain("github_pat_");
    expect(() => applyLibraryUpdatePlan(secretPlan, { portableFiles: secretFiles })).toThrow("blocked");
    expect(
      applyLibraryUpdatePlan(secretPlan, {
        portableFiles: secretFiles,
        acknowledgedSecretFindings: secretPlan.secretFindings,
      }).updated,
    ).toEqual(["dotagents.yaml", "skills/writing"]);

    expect(() =>
      planLibraryUpdate({
        root: secret.workspace,
        skills: [{ skill: "writing", path: "skills/writing", sourcePath: secret.source }],
        portableFiles: { skills: "conflict\n" },
      }),
    ).toThrow("paths overlap");
  });

  it("rolls back every earlier replacement when a later operation fails", () => {
    const current = fixture();
    mkdirSync(path.join(current.workspace, "skills", "writing"), { recursive: true });
    writeFileSync(path.join(current.workspace, "skills", "writing", "SKILL.md"), "# Old\n");
    writeFileSync(path.join(current.workspace, "skills.json"), "old\n");
    const files = { "skills.json": "new\n" };
    const review = plan(current, files);
    expect(() =>
      applyLibraryUpdatePlan(review, {
        portableFiles: files,
        beforeOperation: (_operation, index) => {
          if (index === 1) throw new Error("simulated failure");
        },
      }),
    ).toThrow("simulated failure");
    expect(readFileSync(path.join(current.workspace, "skills.json"), "utf8")).toBe("old\n");
    expect(readFileSync(path.join(current.workspace, "skills", "writing", "SKILL.md"), "utf8")).toBe("# Old\n");
  });

  it("recovers an interrupted applied target from the durable journal", () => {
    const current = fixture();
    const files = { "skills.json": "new\n" };
    const review = plan(current, files);
    const operation = review.operations.find((entry) => entry.path === "skills.json");
    if (!operation) throw new Error("fixture produced no portable file operation");
    writeFileSync(operation.target, files["skills.json"]);
    const journalPath = path.join(current.root, "journal.json");
    writeFileSync(
      journalPath,
      JSON.stringify({
        kind: "library-update",
        schemaVersion: 1,
        planId: review.planId,
        phase: "applying",
        entries: [
          {
            operation,
            stagePath: `${operation.target}.dotagents-stage-test`,
            backupPath: `${operation.target}.dotagents-backup-test`,
            hadPrevious: false,
            status: "applied",
          },
        ],
      }),
    );
    expect(inspectLibraryUpdateRecovery(journalPath)).toEqual({
      kind: "library-update",
      phase: "applying",
      itemCount: 1,
      changedItemCount: 1,
    });
    expect(recoverLibraryUpdate(journalPath)).toBe(true);
    expect(existsSync(operation.target)).toBe(false);
    expect(existsSync(journalPath)).toBe(false);
    expect(inspectLibraryUpdateRecovery(journalPath)).toBeNull();
  });
});
