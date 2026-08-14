import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyToolkitChanges, compareToolkitSkill, previewToolkitChangedFile } from "../src/toolkit-review.js";

test("toolkit review classifies portable hashes without host paths", () => {
  expect(
    classifyToolkitChanges({
      items: [
        { id: "same", name: "Same", integrity: "a" },
        { id: "changed", name: "Changed", integrity: "new" },
        { id: "new", name: "New", integrity: "x" },
      ],
      library: [
        { id: "same", integrity: "a" },
        { id: "changed", integrity: "old" },
      ],
      observedIntegrity: { missing: "old" },
    }),
  ).toEqual([
    { id: "changed", name: "Changed", kind: "changed-local" },
    { id: "new", name: "New", kind: "new-local" },
    { id: "missing", name: "missing", kind: "missing-local" },
  ]);
});

test("toolkit review keeps an explicitly excluded local skill out of the new queue until it changes", () => {
  expect(
    classifyToolkitChanges({
      items: [{ id: "local-only", name: "Local only", integrity: "a".repeat(64) }],
      library: [],
      libraryExclusions: { "local-only": { integrity: "a".repeat(64) } },
    }),
  ).toEqual([{ id: "local-only", name: "Local only", kind: "kept-local" }]);

  expect(
    classifyToolkitChanges({
      items: [{ id: "local-only", name: "Local only", integrity: "b".repeat(64) }],
      library: [],
      libraryExclusions: { "local-only": { integrity: "a".repeat(64) } },
    }),
  ).toEqual([{ id: "local-only", name: "Local only", kind: "new-local" }]);
});

test("toolkit review previews a changed portable file without following links", () => {
  const root = mkdtempSync(join(tmpdir(), "dotagents-toolkit-review-"));
  try {
    const saved = join(root, "saved");
    const local = join(root, "local");
    mkdirSync(saved);
    mkdirSync(local);
    writeFileSync(join(saved, "SKILL.md"), "# Example\nold\n");
    writeFileSync(join(local, "SKILL.md"), "# Example\nnew\n");
    const comparison = compareToolkitSkill({ id: "example", libraryPath: saved, localPath: local });
    expect(comparison.changed_files).toEqual(["SKILL.md"]);
    expect(
      previewToolkitChangedFile({ libraryPath: saved, localPath: local, file: "SKILL.md", comparison }).diff,
    ).toContain("- old");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
