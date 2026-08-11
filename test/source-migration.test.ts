import { afterEach, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "../src/init.js";
import { discoverSkills } from "../src/discovery.js";
import { applyGitSourceMigration, planGitSourceMigration } from "../src/source-migration.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("links an existing identical bundled skill to its Git source without changing its files", async () => {
  const root = mkdtempSync(join(tmpdir(), "dotagents-source-migration-"));
  roots.push(root);
  const source = join(root, "source");
  mkdirSync(join(source, "skills", "writing"), { recursive: true });
  writeFileSync(
    join(source, "skills", "writing", "SKILL.md"),
    "---\nname: writing\ndescription: Portable writing\n---\n# Writing\n",
  );
  execFileSync("git", ["init"], { cwd: source });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: source });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: source });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/example/writing.git"], { cwd: source });
  execFileSync("git", ["add", "."], { cwd: source });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: source });

  const library = join(root, "library");
  await applyInitializeLibraryPlan(planInitializeLibrary(library, "library"));
  cpSync(join(source, "skills", "writing"), join(library, "skills", "writing"), { recursive: true });
  writeFileSync(
    join(library, "skills.json"),
    JSON.stringify(
      { schema_version: 1, name: "library", version: "0.1.0", skills: ["skills/writing"], dependencies: {} },
      null,
      2,
    ),
  );
  const discovered = await discoverSkills([{ path: join(source, "skills"), kind: "shared" }]);
  const plan = await planGitSourceMigration(library, discovered.skills);
  expect(plan.entries).toEqual([
    expect.objectContaining({ skill: "writing", action: "linked", source: "https://github.com/example/writing" }),
  ]);
  await applyGitSourceMigration(plan);
  const config = parse(readFileSync(join(library, "dotagents.yaml"), "utf8")) as {
    skills: Record<string, { snapshot?: { url?: string } }>;
  };
  expect(config.skills.writing?.snapshot?.url).toBe("https://github.com/example/writing");
});
