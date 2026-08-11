import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addSkillImprovementNote,
  privateEvaluationWorkspace,
  readSkillImprovementNotes,
} from "../src/skill-evolution.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("keeps improvement notes local to a skill", () => {
  const directory = mkdtempSync(join(tmpdir(), "dotagents-evolution-"));
  roots.push(directory);
  const note = addSkillImprovementNote(
    "writing",
    {
      prompt: "Write a concise update",
      actual: "Too long",
      expected: "Three concrete bullets",
    },
    directory,
  );
  expect(readSkillImprovementNotes("writing", directory)).toEqual([note]);
  expect(readSkillImprovementNotes("other", directory)).toEqual([]);
  expect(
    readFileSync(`${privateEvaluationWorkspace("writing", directory)}/observed-${note.id}.yaml`, "utf8"),
  ).toContain("checks:");
});
