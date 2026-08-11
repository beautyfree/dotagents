import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markLocalSkillReviewed,
  observeLocalSkills,
  readLocalSkillSources,
  saveLocalSkillSource,
} from "../src/source-registry.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function registryFile(): string {
  const root = mkdtempSync(join(tmpdir(), "dotagents-source-registry-"));
  roots.push(root);
  return join(root, "sources.json");
}

it("treats pre-relationship records as already reviewed", () => {
  const file = registryFile();
  writeFileSync(
    file,
    JSON.stringify({
      schema_version: 1,
      skills: {
        legacy: {
          source: "git",
          repository: "https://example.com/legacy.git",
          skill_path: "legacy",
          ref: null,
          content_sha256: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  expect(readLocalSkillSources(file).legacy).toMatchObject({
    first_seen_at: "2026-01-01T00:00:00.000Z",
    reviewed_at: "2026-01-01T00:00:00.000Z",
    ownership: "unknown",
  });
});

it("preserves first seen and review state when a source is refreshed", () => {
  const file = registryFile();
  saveLocalSkillSource(
    "writing",
    { source: "local", repository: null, skill_path: null, ref: null, content_sha256: null },
    file,
  );
  const initial = readLocalSkillSources(file).writing;
  if (!initial) throw new Error("missing source record");
  markLocalSkillReviewed("writing", file);
  const reviewed = readLocalSkillSources(file).writing;
  if (!reviewed) throw new Error("missing reviewed source record");
  saveLocalSkillSource(
    "writing",
    {
      source: "git",
      repository: "https://example.com/writing.git",
      skill_path: "writing",
      ref: "main",
      content_sha256: null,
    },
    file,
  );
  expect(readLocalSkillSources(file).writing).toMatchObject({
    first_seen_at: initial.first_seen_at,
    reviewed_at: reviewed.reviewed_at,
    source: "git",
    repository: "https://example.com/writing.git",
  });
});

it("baselines the first inventory but flags skills discovered later", () => {
  const file = registryFile();
  expect(observeLocalSkills([{ skill: "already-here" }], file)).toMatchObject({
    initialized: true,
    added: ["already-here"],
  });
  expect(readLocalSkillSources(file)["already-here"]?.reviewed_at).not.toBeNull();

  expect(observeLocalSkills([{ skill: "brand-new" }], file)).toMatchObject({
    initialized: false,
    added: ["brand-new"],
  });
  expect(readLocalSkillSources(file)["brand-new"]?.reviewed_at).toBeNull();
});

it("upgrades an anonymous baseline when a skills.sh lock proves provenance", () => {
  const file = registryFile();
  observeLocalSkills([{ skill: "writing" }], file);
  observeLocalSkills(
    [
      {
        skill: "writing",
        source: "skills.sh",
        repository: "https://github.com/example/writing",
        skill_path: "skills/writing",
        ref: "v1",
      },
    ],
    file,
  );
  expect(readLocalSkillSources(file).writing).toMatchObject({
    source: "skills.sh",
    ownership: "external",
    repository: "https://github.com/example/writing",
  });
});
