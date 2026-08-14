import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanLibrary, scanOwnedSkill } from "../src/inventory.js";
import { planSkillExport } from "../src/export-policy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeLibrary(skillPath = "skills/writing"): string {
  const root = mkdtempSync(join(tmpdir(), "dotagents-library-"));
  roots.push(root);
  mkdirSync(join(root, skillPath), { recursive: true });
  writeFileSync(
    join(root, "skills.json"),
    JSON.stringify({
      schema_version: 1,
      name: "test-library",
      version: "1.0.0",
      skills: [skillPath],
      dependencies: {},
    }),
  );
  writeFileSync(join(root, skillPath, "SKILL.md"), "# Writing\n");
  return root;
}

describe("library inventory", () => {
  it("scans owned files and produces stable integrity", async () => {
    const root = makeLibrary();
    writeFileSync(join(root, "skills/writing/example.md"), "example\n");
    const first = await scanLibrary(root);
    const second = await scanLibrary(root);
    expect(first.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.ownedSkills[0]).toMatchObject({ name: "writing", fileCount: 2 });
      expect(first.value.ownedSkills[0]?.integrity).toBe(second.value.ownedSkills[0]?.integrity);
      expect(first.value.ownedSkills[0]?.exportHash).toBe(
        planSkillExport("writing", join(root, "skills/writing")).sha256,
      );
    }
  });

  it("bundles a reviewed file link and rejects links outside the reviewed root", async () => {
    const root = makeLibrary();
    symlinkSync(join(root, "skills/writing/SKILL.md"), join(root, "skills/writing/outside.md"));
    const linked = await scanLibrary(root);
    expect(linked.ok).toBe(true);

    const outside = join(root, "outside.md");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(root, "skills/writing/external.md"));
    const rejected = await scanOwnedSkill(join(root, "skills"), "writing");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.issues[0]?.code).toBe("unsafe-link");

    const trusted = await scanOwnedSkill(join(root, "skills"), "writing", undefined, { trustedFileRoots: [root] });
    expect(trusted.ok).toBe(true);

    const missing = makeLibrary("skills/missing");
    rmSync(join(missing, "skills/missing/SKILL.md"));
    const result = await scanLibrary(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("missing-skill-file");
  });

  it("enforces file-count limits before loading unbounded content", async () => {
    const root = makeLibrary();
    writeFileSync(join(root, "skills/writing/extra.md"), "x");
    const result = await scanLibrary(root, { maxFilesPerSkill: 1, maxFileBytes: 1024, maxSkillBytes: 2048 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("limit-exceeded");
  });
});
