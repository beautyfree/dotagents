import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCanonicalLibraryPublication } from "../src/canonical-library.js";
import { planLibraryPublish } from "../src/library-publish.js";

describe("portable library publish planning", () => {
  it("owns export and source classification independently of a desktop client", () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-library-publish-"));
    try {
      const local = join(root, "writing");
      mkdirSync(local);
      writeFileSync(join(local, "SKILL.md"), "# Writing\n");
      const plan = planLibraryPublish([
        { id: "writing", sourcePath: local },
        {
          kind: "git",
          id: "review",
          repository: "https://github.com/example/review.git",
          ref: "a".repeat(40),
          skillPath: ".",
        },
      ]);
      expect(plan.kind).toBe("dotagents-library-publish");
      expect(plan.bundledSkills).toMatchObject([{ id: "writing", bundledPath: "skills/writing" }]);
      expect(plan.candidates.map((candidate) => candidate.id)).toEqual(["review", "writing"]);
      expect(plan.secretFindings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("authors the canonical portable files without a desktop application", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-canonical-library-"));
    try {
      const local = join(root, "source", "writing");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "SKILL.md"), "# Writing\n");
      const plan = await planCanonicalLibraryPublication({
        root: join(root, "library"),
        name: "agent-library",
        candidates: [{ id: "writing", sourcePath: local }],
        metadata: { consumer: { display_name: "Example" } },
      });
      expect(JSON.parse(plan.portableFiles["skills.json"] ?? "{}")).toMatchObject({
        name: "agent-library",
        skills: ["skills/writing"],
        metadata: { consumer: { display_name: "Example" } },
      });
      expect(plan.portableFiles["dotagents.yaml"]).toContain("include: all");
      expect(plan.publish.bundledSkills).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a fork's upstream attribution portable without leaking a local path", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-fork-lineage-"));
    try {
      const local = join(root, "source", "writing");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "SKILL.md"), "# Writing\n");
      const plan = await planCanonicalLibraryPublication({
        root: join(root, "library"),
        name: "agent-library",
        candidates: [
          {
            id: "writing",
            sourcePath: local,
            forkedFrom: {
              url: "https://github.com/example/writing.git",
              ref: "a".repeat(40),
              skill_path: "skills/writing",
            },
          },
        ],
      });
      expect(plan.portableFiles["dotagents.yaml"]).toContain("forked_from:");
      expect(plan.portableFiles["dotagents.yaml"]).toContain("https://github.com/example/writing.git");
      expect(plan.portableFiles["dotagents.yaml"]).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
