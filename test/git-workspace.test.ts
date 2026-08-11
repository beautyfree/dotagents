import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type Socket } from "node:net";
import {
  applyLibraryClone,
  applyGitClonePlan,
  applyLibraryCommit,
  applyLibraryGitInitialization,
  applyLibraryPull,
  applyLibraryPush,
  cloneLibrary,
  getLibraryGitStatus,
  initializeLibraryGit,
  planLibraryClone,
  planGitCheckout,
  planLibraryCommit,
  planLibraryGitInitialization,
  planLibraryPull,
  planLibraryPush,
  NodeWorkspaceGitPort,
  type WorkspaceGitPort,
} from "../src/git-workspace.js";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "../src/init.js";
import { exactSourceSecurityPolicy } from "../src/source-policy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function initializedLibrary(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await applyInitializeLibraryPlan(planInitializeLibrary(root, name));
  return root;
}

function addSkill(root: string, name: string, body = "portable\n"): void {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(
    join(root, "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description.\n---\n# ${name}\n${body}`,
  );
  const manifest = JSON.parse(readFileSync(join(root, "skills.json"), "utf8"));
  manifest.skills = [...new Set([...(manifest.skills ?? []), `skills/${name}`])].sort();
  writeFileSync(join(root, "skills.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("Git-backed library workspace", () => {
  it("forwards review cancellation to the active Git command", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-cancel-"));
    roots.push(parent);
    const remote = "https://example.com/team/library.git";
    const controller = new AbortController();
    controller.abort();
    const git: WorkspaceGitPort = {
      async run(_args, _cwd, options) {
        expect(options?.signal).toBe(controller.signal);
        throw new DOMException("Review cancelled", "AbortError");
      },
    };

    await expect(
      planGitCheckout(remote, join(parent, "library"), "HEAD", exactSourceSecurityPolicy([remote]), git, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("terminates a hanging Git process when its review is cancelled", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP test port");
    const controller = new AbortController();
    const pending = new NodeWorkspaceGitPort().run(
      ["ls-remote", `git://127.0.0.1:${address.port}/library.git`],
      process.cwd(),
      { nonInteractive: true, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    try {
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("initializes Git only after its repository and remote preconditions are reviewed", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-init-plan-"));
    roots.push(parent);
    const library = await initializedLibrary(parent, "library");
    const plan = await planLibraryGitInitialization(library, "git@example.com:team/library.git");
    expect(plan).toMatchObject({
      kind: "git-initialize",
      repositoryPresent: false,
      remoteIdentity: "https://example.com/team/library",
    });
    expect(existsSync(join(library, ".git"))).toBe(false);
    await applyLibraryGitInitialization(plan);
    expect(existsSync(join(library, ".git"))).toBe(true);

    const another = await initializedLibrary(parent, "another-library");
    const stale = await planLibraryGitInitialization(another);
    await initializeLibraryGit(another);
    await expect(applyLibraryGitInitialization(stale)).rejects.toThrow("changed after the preview");
  });

  it("clones only after an unchanged reviewed plan is applied", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-clone-plan-"));
    roots.push(parent);
    const remote = join(parent, "remote.git");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const source = await initializedLibrary(parent, "source-library");
    addSkill(source, "portable");
    await initializeLibraryGit(source, pathToFileURL(remote).href);
    await applyLibraryCommit(await planLibraryCommit(source, "Initial library"));
    const policy = exactSourceSecurityPolicy([pathToFileURL(remote).href]);
    await applyLibraryPush(await planLibraryPush(source, policy));

    const target = join(parent, "cloned-library");
    await expect(planLibraryClone("https://example.com/library.git?token=secret", target)).rejects.toThrow(
      "query parameters",
    );
    await expect(planLibraryClone(pathToFileURL(remote).href, target)).rejects.toThrow("allow_local");
    const plan = await planLibraryClone(pathToFileURL(remote).href, target, policy);
    expect(plan).toMatchObject({
      kind: "git-clone",
      schemaVersion: 4,
      destination: target,
      requestedRef: "HEAD",
      branch: "main",
    });
    expect(plan.resolvedCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(plan.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(target)).toBe(false);
    const cancelledTarget = join(parent, "cancelled-library");
    const cancelledPlan = await planLibraryClone(pathToFileURL(remote).href, cancelledTarget, policy);
    const applyController = new AbortController();
    applyController.abort();
    await expect(applyLibraryClone(cancelledPlan, undefined, { signal: applyController.signal })).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
    expect(existsSync(cancelledTarget)).toBe(false);
    await expect(applyLibraryClone({ ...plan, destination: `${target}-changed` })).rejects.toThrow("stale or modified");
    await applyLibraryClone(plan);
    expect(readFileSync(join(target, "skills/portable/SKILL.md"), "utf8")).toContain("portable");
    expect(
      execFileSync("git", ["config", "--get", "core.autocrlf"], {
        cwd: target,
        encoding: "utf8",
      }).trim(),
    ).toBe("false");

    const coolingTarget = join(parent, "cooling-library");
    const coolingPolicy = exactSourceSecurityPolicy([pathToFileURL(remote).href], {
      minimum_release_age_minutes: 60,
    });
    await expect(planLibraryClone(pathToFileURL(remote).href, coolingTarget, coolingPolicy)).rejects.toThrow(
      "reviewed minimum is 60 minutes",
    );
    const reviewedException = exactSourceSecurityPolicy([pathToFileURL(remote).href], {
      minimum_release_age_minutes: 60,
      minimum_release_age_exclude: [pathToFileURL(remote).href],
    });
    expect(
      (await planLibraryClone(pathToFileURL(remote).href, coolingTarget, reviewedException)).releaseAgeExcluded,
    ).toBe(true);

    const occupiedTarget = join(parent, "occupied-library");
    const occupiedPlan = await planLibraryClone(pathToFileURL(remote).href, occupiedTarget, policy);
    mkdirSync(occupiedTarget);
    await expect(applyLibraryClone(occupiedPlan)).rejects.toThrow("must not already exist");
  }, 60_000);

  it("resolves branches, tags, and commits before applying an exact generic checkout", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-checkout-plan-"));
    roots.push(parent);
    const remote = join(parent, "remote.git");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const source = await initializedLibrary(parent, "source-library");
    addSkill(source, "portable");
    await initializeLibraryGit(source, pathToFileURL(remote).href);
    const commit = await applyLibraryCommit(await planLibraryCommit(source, "Initial library"));
    if (!commit) throw new Error("expected initial commit");
    const policy = exactSourceSecurityPolicy([pathToFileURL(remote).href]);
    await applyLibraryPush(await planLibraryPush(source, policy));
    execFileSync("git", ["branch", "stable"], { cwd: source });
    execFileSync("git", ["tag", "v1"], { cwd: source });
    execFileSync("git", ["push", "origin", "stable", "refs/tags/v1"], {
      cwd: source,
    });

    const branchTarget = join(parent, "branch-checkout");
    const branchPlan = await planGitCheckout(pathToFileURL(remote).href, branchTarget, "stable", policy);
    expect(branchPlan).toMatchObject({
      requestedRef: "stable",
      branch: "stable",
      resolvedCommit: commit,
    });
    await applyGitClonePlan(branchPlan);
    expect(
      execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: branchTarget,
        encoding: "utf8",
      }).trim(),
    ).toBe("stable");

    const tagTarget = join(parent, "tag-checkout");
    const tagPlan = await planGitCheckout(pathToFileURL(remote).href, tagTarget, "v1", policy);
    expect(tagPlan).toMatchObject({
      requestedRef: "v1",
      branch: null,
      resolvedCommit: commit,
    });
    await applyGitClonePlan(tagPlan);
    expect(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: tagTarget,
        encoding: "utf8",
      }).trim(),
    ).toBe(commit);

    const commitTarget = join(parent, "commit-checkout");
    const commitPlan = await planGitCheckout(pathToFileURL(remote).href, commitTarget, commit, policy);
    expect(commitPlan).toMatchObject({
      requestedRef: commit,
      branch: null,
      resolvedCommit: commit,
    });
    await applyGitClonePlan(commitPlan);
  }, 60_000);

  it("commits only reviewed portable files and blocks unsafe or secret changes", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-commit-"));
    roots.push(parent);
    const library = await initializedLibrary(parent, "personal");
    addSkill(library, "writing");
    await initializeLibraryGit(library);
    const plan = await planLibraryCommit(library, "Create portable library");
    expect(plan.hasBlockers).toBe(false);
    expect(plan.files.map((file) => file.path)).toContain("skills/writing/SKILL.md");
    expect(await applyLibraryCommit(plan)).toMatch(/^[a-f0-9]{40}$/);
    expect((await getLibraryGitStatus(library)).changed).toBe(false);

    // Finder metadata can appear in any nested skill directory. It must remain
    // local and must never turn a portable-library sync into a blocked review.
    writeFileSync(join(library, "skills", "writing", ".DS_Store"), "finder metadata\n");
    const finderMetadata = await planLibraryCommit(library, "Ignore Finder metadata");
    expect(finderMetadata.hasBlockers).toBe(false);
    expect(finderMetadata.files).toEqual([]);
    expect(await applyLibraryCommit(finderMetadata)).toBeNull();
    expect((await getLibraryGitStatus(library)).changed).toBe(false);

    writeFileSync(join(library, "dotagents.scope.json"), '{"schema_version":1,"scope":"personal"}\n');
    const scope = await planLibraryCommit(library, "Add portable scope");
    expect(scope.hasBlockers).toBe(false);
    expect(scope.files.map((file) => file.path)).toContain("dotagents.scope.json");
    await applyLibraryCommit(scope);

    writeFileSync(join(library, "dotagents.scope.json"), '{"schema_version":1,"scope":"everywhere"}\n');
    const invalidScope = await planLibraryCommit(library, "Invalid portable scope");
    expect(invalidScope.hasBlockers).toBe(true);
    expect(invalidScope.auditErrors).toContainEqual(
      expect.objectContaining({
        code: "invalid-scope-descriptor",
        field: "dotagents.scope.json",
      }),
    );
    writeFileSync(join(library, "dotagents.scope.json"), '{"schema_version":1,"scope":"personal"}\n');

    writeFileSync(join(library, ".env"), "TOKEN=secret\n");
    const unsafe = await planLibraryCommit(library, "Unsafe file");
    expect(unsafe.hasBlockers).toBe(true);
    expect(unsafe.unsafePaths).toEqual([".env"]);
    rmSync(join(library, ".env"));
    writeFileSync(join(library, "README.md"), "github_pat_abcdefghijklmnopqrstuvwxyz123456\n");
    const secret = await planLibraryCommit(library, "Secret file");
    expect(secret.hasBlockers).toBe(true);
    expect(secret.secretFindings).toEqual([{ file: "README.md", rule: "github-token", line: 1, column: 1 }]);
    await expect(applyLibraryCommit(secret)).rejects.toThrow("blockers");
  });

  it("syncs only declared v2 resources and audits their complete content", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-resources-"));
    roots.push(parent);
    const library = await initializedLibrary(parent, "resources");
    const manifest = {
      schema_version: 2,
      resources: [
        {
          kind: "command",
          id: "review",
          path: "commands/review.md",
          format: "markdown",
          invocation: "review",
        },
      ],
    };
    mkdirSync(join(library, "commands"));
    writeFileSync(join(library, "commands/review.md"), "# Review\n");
    writeFileSync(join(library, "resources.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await initializeLibraryGit(library);
    const reviewed = await planLibraryCommit(library, "Add command resource");
    expect(reviewed.hasBlockers).toBe(false);
    expect(reviewed.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["resources.json", "commands/review.md"]),
    );
    await applyLibraryCommit(reviewed);

    writeFileSync(join(library, "commands/unmanaged.md"), "# Not declared\n");
    const unmanaged = await planLibraryCommit(library, "Unmanaged resource");
    expect(unmanaged.hasBlockers).toBe(true);
    expect(unmanaged.unsafePaths).toContain("commands/unmanaged.md");
    rmSync(join(library, "commands/unmanaged.md"));

    const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    writeFileSync(join(library, "commands/review.md"), `${secret}\n`);
    const blocked = await planLibraryCommit(library, "Secret resource");
    expect(blocked.hasBlockers).toBe(true);
    expect(blocked.secretFindings).toContainEqual({
      file: "commands/review.md",
      rule: "github-token",
      line: 1,
      column: 1,
    });
    expect(JSON.stringify(blocked)).not.toContain(secret);
  });

  it("pushes and fast-forwards through a generic remote only after separate previews", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-sync-"));
    roots.push(parent);
    const remote = join(parent, "remote.git");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const first = await initializedLibrary(parent, "first-library");
    addSkill(first, "review", "first\n");
    await initializeLibraryGit(first, pathToFileURL(remote).href);
    await applyLibraryCommit(await planLibraryCommit(first, "Initial library"));
    const policy = exactSourceSecurityPolicy([pathToFileURL(remote).href]);
    await expect(planLibraryPush(first)).rejects.toThrow("allow_local");
    const firstPush = await planLibraryPush(first, policy);
    expect(firstPush.remoteIdentity).toBe(pathToFileURL(remote).href.replace(/\/$/, ""));
    await applyLibraryPush(firstPush);

    const second = join(parent, "second-library");
    await cloneLibrary(pathToFileURL(remote).href, second, policy);
    writeFileSync(
      join(second, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: review description.\n---\n# review\nsecond\n",
    );
    await applyLibraryCommit(await planLibraryCommit(second, "Update review"));
    await applyLibraryPush(await planLibraryPush(second, policy));

    const coolingPolicy = exactSourceSecurityPolicy([pathToFileURL(remote).href], {
      minimum_release_age_minutes: 60,
    });
    await expect(planLibraryPull(first, "private", coolingPolicy)).rejects.toThrow("reviewed minimum is 60 minutes");
    const pull = await planLibraryPull(first, "private", policy);
    expect(pull).toMatchObject({
      hasBlockers: false,
      files: ["skills/review/SKILL.md"],
    });
    expect(readFileSync(join(first, "skills/review/SKILL.md"), "utf8")).toContain("first");
    await applyLibraryPull(pull);
    expect(readFileSync(join(first, "skills/review/SKILL.md"), "utf8")).toContain("second");
  }, 60_000);

  it("blocks a malicious remote secret before fast-forwarding the working tree", async () => {
    const parent = mkdtempSync(join(tmpdir(), "dotagents-git-secret-pull-"));
    roots.push(parent);
    const remote = join(parent, "remote.git");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const first = await initializedLibrary(parent, "first-library");
    await initializeLibraryGit(first, pathToFileURL(remote).href);
    await applyLibraryCommit(await planLibraryCommit(first, "Initial library"));
    const policy = exactSourceSecurityPolicy([pathToFileURL(remote).href]);
    await applyLibraryPush(await planLibraryPush(first, policy));
    const attacker = join(parent, "attacker");
    execFileSync("git", ["clone", pathToFileURL(remote).href, attacker]);
    execFileSync("git", ["config", "user.email", "attacker@example.invalid"], {
      cwd: attacker,
    });
    execFileSync("git", ["config", "user.name", "attacker"], { cwd: attacker });
    writeFileSync(join(attacker, "README.md"), "ghp_abcdefghijklmnopqrstuvwxyz123456\n");
    execFileSync("git", ["add", "README.md"], { cwd: attacker });
    execFileSync("git", ["commit", "-m", "malicious"], { cwd: attacker });
    execFileSync("git", ["push", "origin", "main"], { cwd: attacker });

    const pull = await planLibraryPull(first, "private", policy);
    expect(pull.hasBlockers).toBe(true);
    expect(pull.secretFindings).toEqual([{ file: "README.md", rule: "github-token", line: 1, column: 1 }]);
    await expect(applyLibraryPull(pull)).rejects.toThrow("blockers");
    expect(readFileSync(join(first, "README.md"), "utf8")).not.toContain("ghp_");
    expect(existsSync(join(first, ".dotagents"))).toBe(true);
  }, 60_000);
});
