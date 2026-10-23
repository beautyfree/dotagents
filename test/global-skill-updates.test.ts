import { afterEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverSkills } from "../src/discovery.js";
import { listOperationHistory } from "../src/history.js";
import {
  applyReviewedManagedSkillUpdates,
  checkGlobalSkillUpdates,
  reviewGlobalSkillUpdate,
} from "../src/global-skill-updates.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dotagents-update-check-"));
  roots.push(directory);
  return directory;
}

function skill(parent: string, name: string, body: string): string {
  const directory = path.join(parent, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`,
  );
  return directory;
}

it("reports only a reviewed source update as update-available", async () => {
  const local = root();
  const remote = root();
  const localPath = skill(local, "writing", "local v1");
  skill(remote, "writing", "remote v2");
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    managedRoots: [local],
    sources: {
      writing: {
        source: "skills.sh",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: (await discoverSkills([{ path: local, kind: "shared" }])).skills[0]!.integrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.items).toEqual([
    expect.objectContaining({ skill: "writing", state: "update-available", managed: true }),
  ]);
  expect(localPath).toContain("writing");
});

it("allows a verified regular folder with an unknown installation origin to update", async () => {
  const local = root();
  const remote = root();
  skill(local, "writing", "local v1");
  skill(remote, "writing", "remote v2");
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    managedRoots: [local],
    sources: {
      writing: {
        source: "git",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: localReport.skills[0]!.integrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "unknown",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.items[0]).toMatchObject({ skill: "writing", state: "update-available", managed: true });
});

it("leaves a skill exposed through a package link to the package update flow", async () => {
  const local = root();
  const packageRoot = path.join(local, "package");
  const remote = root();
  const linkedTarget = skill(packageRoot, "writing", "local v1");
  symlinkSync(linkedTarget, path.join(local, "writing"));
  skill(remote, "writing", "remote v2");
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);

  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    managedRoots: [local],
    sources: {
      writing: {
        source: "skills.sh",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: localReport.skills[0]!.integrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });

  expect(result.items).toEqual([]);
});

it("uses the npx skills lock as direct source evidence before the registry warms", async () => {
  const local = root();
  const remote = root();
  skill(local, "writing", "local v1");
  skill(remote, "writing", "remote v2");
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    sources: {},
    skillsCliLock: {
      path: "<memory>",
      version: 3,
      skills: [
        {
          name: "writing",
          source: "github:example/writing",
          source_type: "github",
          source_url: "https://github.com/example/writing",
          ref: "main",
          skill_path: "writing",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.items[0]).toMatchObject({
    source: "skills.sh",
    repository: "https://github.com/example/writing",
    state: "review-required",
  });
});

it("leaves a manually copied global skill outside the update workflow", async () => {
  const local = root();
  skill(local, "writing", "a local copy with no source metadata");
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    managedRoots: [local],
    sources: {},
  });
  expect(result.items).toEqual([expect.objectContaining({ skill: "writing", state: "not-trackable", managed: false })]);
});

it("bounds concurrent remote source checks", async () => {
  const local = root();
  const remotes = [root(), root(), root(), root()];
  const reports = remotes.map((remote, index) => {
    const name = `writing-${index}`;
    skill(local, name, "local");
    skill(remote, name, "remote");
    return { name, remote };
  });
  const remoteReports = await Promise.all(
    reports.map(({ remote }) => discoverSkills([{ path: remote, kind: "shared" }])),
  );
  let active = 0;
  let peak = 0;
  await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    sources: Object.fromEntries(
      reports.map(({ name }, index) => [
        name,
        {
          source: "git" as const,
          repository: `https://github.com/example/${name}`,
          skill_path: name,
          ref: null,
          content_sha256: null,
          observed_integrity: null,
          first_seen_at: "2026-01-01T00:00:00.000Z",
          reviewed_at: "2026-01-01T00:00:00.000Z",
          ownership: "external" as const,
          forked_from: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ]),
    ),
    openSession: async ({ repository }) => {
      const index = reports.findIndex(({ name }) => repository.endsWith(`/${name}`));
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const report = remoteReports[index]!;
      return {
        path: remotes[index]!,
        skills: report.skills,
        findSkill: () => report.skills[0]!.sourcePath,
        dispose: async () => {
          active -= 1;
        },
      };
    },
  });
  expect(peak).toBe(3);
});

it("times out a slow source check without blocking the remaining inventory", async () => {
  const local = root();
  skill(local, "writing", "local");
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    sourceCheckTimeoutMs: 10,
    sources: {
      writing: {
        source: "git",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: null,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    openSession: async ({ signal }) =>
      await new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  });
  expect(result.items[0]).toMatchObject({ skill: "writing", state: "source-unavailable" });
  expect(result.items[0]?.reason).toContain("Source check timed out");
});

it("never calls a changed local copy an update-ready item", async () => {
  const local = root();
  const remote = root();
  skill(local, "writing", "edited locally");
  skill(remote, "writing", "remote v2");
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const result = await checkGlobalSkillUpdates({
    roots: [{ path: local, kind: "shared" }],
    sources: {
      writing: {
        source: "git",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: "sha256-old-baseline",
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.items[0]).toMatchObject({ state: "local-changes", managed: false });
});

it("atomically replaces a reviewed managed copy only when both fingerprints still match", async () => {
  const local = root();
  const remote = root();
  const stateRoot = root();
  skill(local, "writing", "local v1");
  skill(remote, "writing", "remote v2");
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const progress: Array<{ done: number; total: number; phase: string }> = [];
  const result = await applyReviewedManagedSkillUpdates({
    root: local,
    historyRoot: stateRoot,
    sources: {
      writing: {
        source: "git",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: localReport.skills[0]!.integrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    updates: [
      {
        skill: "writing",
        repository: "https://github.com/example/writing",
        skillPath: "writing",
        expectedLocalIntegrity: localReport.skills[0]!.integrity,
        expectedRemoteIntegrity: remoteReport.skills[0]!.integrity,
      },
    ],
    onProgress: (event) => progress.push(event),
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.updated).toEqual([{ skill: "writing", integrity: remoteReport.skills[0]!.integrity }]);
  expect((await discoverSkills([{ path: local, kind: "shared" }])).skills[0]!.integrity).toBe(
    remoteReport.skills[0]!.integrity,
  );
  expect(listOperationHistory(stateRoot)).toMatchObject([
    expect.objectContaining({ target_root: local, operation: "library-update" }),
  ]);
  expect(existsSync(path.join(local, ".dotagents", "history"))).toBe(false);
  expect(progress).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ done: 0, total: 1, phase: "preparing" }),
      // A source being prepared is not yet an applied update. The UI must not
      // show a completed counter while the source is still being fetched.
      expect.objectContaining({ done: 0, total: 1, phase: "fetching" }),
      expect.objectContaining({ done: 0, total: 1, phase: "applying" }),
      expect.objectContaining({ done: 1, total: 1, phase: "complete" }),
    ]),
  );
});

it("uses the reviewed export policy when a source contains excluded machine metadata", async () => {
  const local = root();
  const remote = root();
  skill(local, "writing", "local v1");
  const remoteSkill = skill(remote, "writing", "remote v2");
  mkdirSync(path.join(remoteSkill, ".agents"));
  writeFileSync(path.join(remoteSkill, ".agents", "machine-only.json"), '{"local":true}');
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const update = {
    skill: "writing",
    repository: "https://github.com/example/writing",
    skillPath: "writing",
    expectedLocalIntegrity: localReport.skills[0]!.integrity,
    expectedRemoteIntegrity: remoteReport.skills[0]!.integrity,
  };
  const result = await applyReviewedManagedSkillUpdates({
    root: local,
    sources: {
      writing: {
        source: "git",
        repository: update.repository,
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: update.expectedLocalIntegrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    updates: [update],
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.updated[0]?.integrity).toBe(remoteReport.skills[0]!.integrity);
  expect((await discoverSkills([{ path: local, kind: "shared" }])).skills[0]!.integrity).toBe(
    remoteReport.skills[0]!.integrity,
  );
  expect(existsSync(path.join(local, "writing", ".agents"))).toBe(false);
});

it("keeps disposable source sessions alive until their staged atomic update is planned", async () => {
  const local = root();
  const remote = root();
  skill(local, "writing", "local v1");
  skill(remote, "writing", "remote v2");
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const result = await applyReviewedManagedSkillUpdates({
    root: local,
    sources: {
      writing: {
        source: "git",
        repository: "https://github.com/example/writing",
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: localReport.skills[0]!.integrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    updates: [
      {
        skill: "writing",
        repository: "https://github.com/example/writing",
        skillPath: "writing",
        expectedLocalIntegrity: localReport.skills[0]!.integrity,
        expectedRemoteIntegrity: remoteReport.skills[0]!.integrity,
      },
    ],
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => rmSync(remote, { recursive: true, force: true }),
    }),
  });
  expect(result.updated[0]?.integrity).toBe(remoteReport.skills[0]!.integrity);
  expect((await discoverSkills([{ path: local, kind: "shared" }])).skills[0]!.integrity).toBe(
    remoteReport.skills[0]!.integrity,
  );
});

it("applies a reviewed global toolkit that exceeds the ad-hoc export file limit", async () => {
  const local = root();
  const remote = root();
  const localSkill = skill(local, "writing", "local v1");
  const remoteSkill = skill(remote, "writing", "remote v2");
  for (let index = 0; index < 1_001; index += 1) {
    writeFileSync(path.join(localSkill, `reference-${index}.md`), "local reference");
    writeFileSync(path.join(remoteSkill, `reference-${index}.md`), "remote reference");
  }
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const update = {
    skill: "writing",
    repository: "https://github.com/example/writing",
    skillPath: "writing",
    expectedLocalIntegrity: localReport.skills[0]!.integrity,
    expectedRemoteIntegrity: remoteReport.skills[0]!.integrity,
  };
  const result = await applyReviewedManagedSkillUpdates({
    root: local,
    sources: {
      writing: {
        source: "git",
        repository: update.repository,
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: update.expectedLocalIntegrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    updates: [update],
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(result.updated[0]?.integrity).toBe(remoteReport.skills[0]!.integrity);
});

it("lists per-file additions, removals, and modifications for a reviewed update", async () => {
  const local = root();
  const remote = root();
  const localSkill = skill(local, "writing", "local v1");
  const remoteSkill = skill(remote, "writing", "remote v2");
  writeFileSync(path.join(localSkill, "removed.md"), "removed");
  writeFileSync(path.join(remoteSkill, "added.md"), "added");
  const localReport = await discoverSkills([{ path: local, kind: "shared" }]);
  const remoteReport = await discoverSkills([{ path: remote, kind: "shared" }]);
  const update = {
    skill: "writing",
    repository: "https://github.com/example/writing",
    skillPath: "writing",
    expectedLocalIntegrity: localReport.skills[0]!.integrity,
    expectedRemoteIntegrity: remoteReport.skills[0]!.integrity,
  };
  const details = await reviewGlobalSkillUpdate({
    root: local,
    sources: {
      writing: {
        source: "git",
        repository: update.repository,
        skill_path: "writing",
        ref: null,
        content_sha256: null,
        observed_integrity: update.expectedLocalIntegrity,
        first_seen_at: "2026-01-01T00:00:00.000Z",
        reviewed_at: "2026-01-01T00:00:00.000Z",
        ownership: "external",
        forked_from: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    },
    update,
    openSession: async () => ({
      path: remote,
      skills: remoteReport.skills,
      findSkill: () => remoteReport.skills[0]!.sourcePath,
      dispose: async () => undefined,
    }),
  });
  expect(details.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "SKILL.md", kind: "modified" }),
      expect.objectContaining({ path: "added.md", kind: "added" }),
      expect.objectContaining({ path: "removed.md", kind: "removed" }),
    ]),
  );
});
