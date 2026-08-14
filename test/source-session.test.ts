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

  it("uses the recorded repository-relative path before a matching skill name", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-source-session-path-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const publisher = join(root, "publisher");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    execFileSync("git", ["clone", remote, publisher]);
    git(publisher, "config", "user.name", "Test");
    git(publisher, "config", "user.email", "test@example.invalid");
    for (const [directory, body] of [
      [join(publisher, "legacy", "writing"), "# Legacy\n"],
      [join(publisher, "skills", "writing"), "# Preferred\n"],
    ] as const) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "SKILL.md"), `---\nname: writing\ndescription: Writing skill.\n---\n${body}`);
    }
    git(publisher, "add", ".");
    git(publisher, "commit", "-m", "Add duplicate names");
    git(publisher, "push", "-u", "origin", "main");
    const source = pathToFileURL(remote).href;
    const session = await SkillSourceSession.open({
      repository: source,
      sourcePolicy: exactSourceSecurityPolicy([source]),
      temporaryRoot: root,
    });
    expect(session.findSkill("writing", "skills/writing/SKILL.md")).toEndWith("/checkout/skills/writing");
    await session.dispose();
  });

  it("populates and refreshes an app-owned source cache instead of recloning", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-source-session-cache-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const publisher = join(root, "publisher");
    const cache = join(root, "application-cache", "source");
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

    const first = await SkillSourceSession.open({
      repository: source,
      sourcePolicy: exactSourceSecurityPolicy([source]),
      cacheDirectory: cache,
    });
    expect(first.path).toBe(cache);
    await first.dispose();
    expect(existsSync(join(cache, ".git"))).toBe(true);

    mkdirSync(join(publisher, "skills", "second"), { recursive: true });
    writeFileSync(
      join(publisher, "skills", "second", "SKILL.md"),
      "---\nname: second\ndescription: Second skill.\n---\n# Second\n",
    );
    git(publisher, "add", ".");
    git(publisher, "commit", "-m", "Add second skill");
    git(publisher, "push");
    const second = await SkillSourceSession.open({
      repository: source,
      sourcePolicy: exactSourceSecurityPolicy([source]),
      cacheDirectory: cache,
    });
    expect(second.findSkill("second")).toEndWith("/skills/second");
    await second.dispose();
  });
});
