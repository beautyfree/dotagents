import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SkillSourceSession } from "../src/source-session.js";
import { exactSourceSecurityPolicy } from "../src/source-policy.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("reviewed skill source sessions", () => {
  it("discovers a reviewed skill in a disposable dotagents checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-source-session-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const publisher = join(root, "publisher");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    execFileSync("git", ["clone", remote, publisher]);
    git(publisher, "config", "user.name", "Test");
    git(publisher, "config", "user.email", "test@example.invalid");
    mkdirSync(join(publisher, "skills", "portable"), { recursive: true });
    writeFileSync(
      join(publisher, "skills", "portable", "SKILL.md"),
      "---\nname: portable\ndescription: Portable skill.\n---\n# Portable\n",
    );
    git(publisher, "add", ".");
    git(publisher, "commit", "-m", "Add portable skill");
    git(publisher, "push", "-u", "origin", "main");

    const source = pathToFileURL(remote).href;
    const session = await SkillSourceSession.open({
      repository: source,
      sourcePolicy: exactSourceSecurityPolicy([source]),
      temporaryRoot: root,
    });
    expect(session.findSkill("portable")).toEndWith("/checkout/skills/portable");
    expect(session.path).toContain("dotagents-source-");

    const checkout = session.path;
    await session.dispose();
    expect(existsSync(checkout)).toBe(false);
  });
});
