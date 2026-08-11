import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyImportPlan } from "../src/import-apply.js";
import { planImport } from "../src/import.js";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "../src/init.js";
import { applySetupPlan, planSetup } from "../src/setup.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function skill(root: string, name: string): void {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Helps with ${name}.\n---\n# ${name}\n`,
  );
}

describe("guided setup", () => {
  it("discovers a direct global agent install even when the agent has no configuration beyond its skills", async () => {
    const home = mkdtempSync(join(tmpdir(), "dotagents-setup-direct-agent-"));
    roots.push(home);
    const library = join(home, ".agents");
    const agentSkill = join(home, ".claude", "skills", "direct-writing");
    mkdirSync(agentSkill, { recursive: true });
    writeFileSync(
      join(agentSkill, "SKILL.md"),
      "---\nname: direct-writing\ndescription: Installed directly for Claude.\n---\n# Direct writing\n",
    );

    const plan = await planSetup({ root: library, home, platform: "linux", environment: { PATH: "" } });

    expect(plan.summary).toMatchObject({ skillsFound: 1, owned: 1 });
    expect(plan.candidates).toContainEqual(
      expect.objectContaining({ kind: "owned", skill: "direct-writing", agents: ["claude-code"] }),
    );
  });

  it("adopts an explicitly reviewed skill already in a new canonical library", async () => {
    const home = mkdtempSync(join(tmpdir(), "dotagents-setup-home-"));
    roots.push(home);
    const library = join(home, ".agents");
    skill(library, "writing");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "config.toml"), "model = 'test'\n");

    const plan = await planSetup({ root: library, home, platform: "linux" });
    expect(plan.initialization).not.toBeNull();
    expect(plan.summary).toMatchObject({ skillsFound: 1, owned: 1, needsReview: 0 });
    expect(plan.candidates).toContainEqual(expect.objectContaining({ kind: "adopt-owned", skill: "writing" }));
    const result = await applySetupPlan(plan);

    expect(result).toMatchObject({ createdLibrary: true, import: { copied: 0, adopted: 1 } });
    expect(readFileSync(join(library, "skills.json"), "utf8")).toContain("skills/writing");
    expect(readFileSync(join(library, "skills", "writing", "SKILL.md"), "utf8")).toContain("# writing");
  });

  it("records a verified Skills CLI source as a dependency instead of copying it", async () => {
    const home = mkdtempSync(join(tmpdir(), "dotagents-setup-source-"));
    roots.push(home);
    const library = join(home, ".agents");
    skill(library, "review");
    writeFileSync(
      join(library, ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          review: {
            source: "example/review-skills",
            sourceType: "github",
            sourceUrl: "https://github.com/example/review-skills.git",
            ref: "main",
            skillPath: "skills/review",
            updatedAt: "2026-08-04T00:00:00Z",
          },
        },
      }),
    );

    const plan = await planSetup({ root: library, home, platform: "linux" });
    expect(plan.summary).toMatchObject({ sourceLinked: 1, owned: 0 });
    expect(plan.candidates).toContainEqual(expect.objectContaining({ kind: "dependency", skill: "review" }));
  });

  it("rejects an unsafe remote before it can create a library", async () => {
    const home = mkdtempSync(join(tmpdir(), "dotagents-setup-remote-"));
    roots.push(home);
    const library = join(home, "library");

    await expect(
      planSetup({ root: library, home, platform: "linux", remote: "https://user:password@example.com/library.git" }),
    ).rejects.toThrow("credentials");
    expect(existsSync(join(library, "skills.json"))).toBe(false);
  });

  it("keeps implicit adoption blocked outside guided setup", async () => {
    const library = mkdtempSync(join(tmpdir(), "dotagents-adopt-library-"));
    roots.push(library);
    await applyInitializeLibraryPlan(planInitializeLibrary(library, "personal"));
    skill(library, "writing");

    const plan = await planImport(library, [
      { kind: "adopt-owned", skill: "writing", sourcePath: join(library, "skills", "writing") },
    ]);
    expect(plan.operations).toContainEqual(expect.objectContaining({ action: "adopt-owned", skill: "writing" }));
    await applyImportPlan(plan);
    expect(existsSync(join(library, "skills", "writing", "SKILL.md"))).toBe(true);
  });
});
