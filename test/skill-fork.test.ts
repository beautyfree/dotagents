import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forkSkillToLibrary } from "../src/skill-fork.js";
import { readLocalSkillSources } from "../src/source-registry.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("copies an external skill and preserves upstream provenance locally", () => {
  const root = mkdtempSync(join(tmpdir(), "dotagents-fork-"));
  roots.push(root);
  const source = join(root, "source");
  const library = join(root, "library");
  const registry = join(root, "sources.json");
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: source\n---\nHello\n");

  const fork = forkSkillToLibrary({
    sourceDirectory: source,
    libraryDirectory: library,
    forkId: "my-source",
    upstream: { repository: "https://github.com/example/source", skill_path: "skills/source", ref: "abc123" },
    registryFile: registry,
  });

  expect(readFileSync(join(fork, "SKILL.md"), "utf8")).toContain("Hello");
  expect(readLocalSkillSources(registry)["my-source"]).toMatchObject({
    ownership: "forked",
    forked_from: { repository: "https://github.com/example/source", skill_path: "skills/source", ref: "abc123" },
  });
});
