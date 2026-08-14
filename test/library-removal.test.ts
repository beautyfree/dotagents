import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCanonicalLibraryRemoval } from "../src/library-removal.js";

describe("canonical library removal planning", () => {
  it("removes only the reviewed bundled skill from the portable manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-library-removal-"));
    try {
      mkdirSync(join(root, "skills", "writing"), { recursive: true });
      mkdirSync(join(root, "skills", "review"), { recursive: true });
      writeFileSync(join(root, "skills", "writing", "SKILL.md"), "# Writing\n");
      writeFileSync(join(root, "skills", "review", "SKILL.md"), "# Review\n");
      writeFileSync(
        join(root, "skills.json"),
        JSON.stringify({
          schema_version: 1,
          name: "agent-library",
          version: "1.0.0",
          skills: ["skills/writing", "skills/review"],
        }),
      );
      writeFileSync(
        join(root, "dotagents.yaml"),
        "schema_version: 1\ndefaults:\n  include: all\nskills:\n  writing:\n    include: true\n  review:\n    include: true\n",
      );

      const plan = planCanonicalLibraryRemoval(root, "writing");

      expect(plan.removedPath).toBe("skills/writing");
      expect(plan.manifest.skills).toEqual(["skills/review"]);
      expect(plan.portableFiles["dotagents.yaml"]).not.toContain("writing:");
      expect(plan.portableFiles["dotagents.yaml"]).toContain("review:");
      expect(plan.portableFiles["skills.json"]).not.toContain("writing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a skill which is not bundled in the selected library", () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-library-removal-"));
    try {
      writeFileSync(
        join(root, "skills.json"),
        JSON.stringify({
          schema_version: 1,
          name: "agent-library",
          version: "1.0.0",
          skills: [],
        }),
      );
      expect(() => planCanonicalLibraryRemoval(root, "writing")).toThrow("no longer in the library");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
