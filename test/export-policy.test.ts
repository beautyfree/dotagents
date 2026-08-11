import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSkillExport } from "../src/export-policy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function skillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dotagents-export-"));
  roots.push(root);
  mkdirSync(join(root, "references"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
  writeFileSync(join(root, "references", "tone.md"), "Be concise.\n");
  writeFileSync(join(root, ".git", "config"), "not portable\n");
  return root;
}

describe("owned skill export policy", () => {
  it("produces a stable allowlisted plan without matched secret values", () => {
    const root = skillRoot();
    writeFileSync(join(root, ".DS_Store"), "finder metadata\n");
    writeFileSync(join(root, "references", "private.md"), "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n");
    const first = planSkillExport("writing", root);
    const second = planSkillExport("writing", root);
    expect(second).toEqual(first);
    expect(first.files.map((file) => file.relativePath)).toEqual([
      "SKILL.md",
      "references/private.md",
      "references/tone.md",
    ]);
    expect(first.excludedPaths).toEqual([".DS_Store", ".git"]);
    expect(first.secretFindings).toEqual([
      { relativePath: "references/private.md", rule: "github-token", line: 1, column: 7 },
    ]);
    expect(JSON.stringify(first)).not.toContain("ghp_");
  });

  it("rejects links, unsafe names, and content limits", () => {
    const root = skillRoot();
    symlinkSync(join(root, "SKILL.md"), join(root, "linked.md"));
    expect(() => planSkillExport("writing", root)).toThrow("rejects symlink");
    expect(() => planSkillExport("Not Portable", root)).toThrow("lowercase kebab-case");
    rmSync(join(root, "linked.md"));
    expect(() => planSkillExport("writing", root, { maxFiles: 1, maxBytes: 1_000, excludedDirectories: [] })).toThrow(
      "exceeds 1 files",
    );
  });
});
