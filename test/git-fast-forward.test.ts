import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyGitFastForwardPlan, inspectGitFastForwardPlan, planGitFastForward } from "../src/git-fast-forward.js";
import type { WorkspaceGitPort } from "../src/git-workspace.js";
import { exactSourceSecurityPolicy } from "../src/source-policy.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitFile(repository: string, content: string, message: string): void {
  writeFileSync(join(repository, "library.txt"), content);
  git(repository, "add", "library.txt");
  git(repository, "commit", "-m", message);
}

function readText(repository: string): string {
  return readFileSync(join(repository, "library.txt"), "utf8").replaceAll("\r\n", "\n");
}

describe("generic Git fast-forward review", () => {
  it("forwards cancellation to the active Git review command", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-fast-forward-cancel-"));
    roots.push(root);
    const controller = new AbortController();
    controller.abort();
    const gitPort: WorkspaceGitPort = {
      async run(_args, _cwd, options) {
        expect(options?.signal).toBe(controller.signal);
        throw new DOMException("Review cancelled", "AbortError");
      },
    };

    await expect(planGitFastForward(root, {}, gitPort, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("inspects an exact remote commit without changing the worktree and rejects a stale apply", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-fast-forward-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const publisher = join(root, "publisher");
    const observer = join(root, "observer");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    execFileSync("git", ["clone", remote, publisher]);
    git(publisher, "config", "user.name", "Publisher");
    git(publisher, "config", "user.email", "publisher@example.invalid");
    commitFile(publisher, "first\n", "first");
    git(publisher, "push", "-u", "origin", "main");
    execFileSync("git", ["clone", remote, observer]);

    commitFile(publisher, "second\n", "second");
    git(publisher, "push");
    const policy = exactSourceSecurityPolicy([remote]);
    await expect(planGitFastForward(observer)).rejects.toThrow("allow_local");
    await expect(
      planGitFastForward(
        observer,
        exactSourceSecurityPolicy([remote], {
          minimum_release_age_minutes: 60,
        }),
      ),
    ).rejects.toThrow("reviewed minimum is 60 minutes");
    const plan = await planGitFastForward(observer, policy);
    expect(plan).toMatchObject({ schemaVersion: 3, minimumAgeMinutes: 0, releaseAgeExcluded: false });
    expect(plan.files).toEqual(["library.txt"]);
    expect(readText(observer)).toBe("first\n");
    expect(await inspectGitFastForwardPlan(plan, readText)).toBe("second\n");
    expect(readText(observer)).toBe("first\n");

    await applyGitFastForwardPlan(plan);
    expect(readText(observer)).toBe("second\n");

    const stale = await planGitFastForward(observer, policy);
    commitFile(publisher, "third\n", "third");
    git(publisher, "push");
    await expect(applyGitFastForwardPlan(stale)).rejects.toThrow("changed after review");
    expect(readText(observer)).toBe("second\n");
  }, 60_000);
});
