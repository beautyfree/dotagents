import { afterEach, describe, expect, it } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "../src/init.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CLI materialization flow", () => {
  it("sets up a personal library once, then syncs without asking for a path or remote", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-backup-"));
    roots.push(root);
    const library = join(root, "library");
    const remote = join(root, "remote.git");
    const home = join(root, "home");
    const config = join(root, "config");
    await applyInitializeLibraryPlan(planInitializeLibrary(library, "personal"));
    mkdirSync(join(library, "skills", "writing"), { recursive: true });
    writeFileSync(
      join(library, "skills", "writing", "SKILL.md"),
      "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n",
    );
    const manifest = JSON.parse(readFileSync(join(library, "skills.json"), "utf8"));
    manifest.skills = ["skills/writing"];
    writeFileSync(join(library, "skills.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);

    const setup = await run(
      "bun",
      ["src/cli.ts", "setup", library, "--home", home, "--remote", remote, "--yes", "--json"],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, DOTAGENTS_CONFIG_HOME: config },
      },
    );
    expect(JSON.parse(setup.stdout)).toMatchObject({ ok: true, result: { root: library } });
    writeFileSync(join(library, "skills", "writing", "note.md"), "portable note\n");
    const sync = await run("bun", ["src/cli.ts", "sync", "--yes", "--json"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, DOTAGENTS_CONFIG_HOME: config },
    });
    expect(JSON.parse(sync.stdout)).toMatchObject({ ok: true, ahead: 0, behind: 0 });
    expect(execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8" }).trim()).toMatch(
      /^[a-f0-9]{40}$/,
    );
    expect(
      execFileSync("git", ["--git-dir", remote, "show", "main:skills/writing/note.md"], { encoding: "utf8" }),
    ).toContain("portable note");
  });

  it("makes the separate first-sync step explicit after connecting a new remote", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-first-sync-"));
    roots.push(root);
    const library = join(root, "library");
    const remote = join(root, "remote.git");
    const home = join(root, "home");
    await applyInitializeLibraryPlan(planInitializeLibrary(library, "personal"));
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const setup = await run("bun", ["src/cli.ts", "setup", library, "--home", home, "--remote", remote, "--yes"], {
      cwd: join(import.meta.dir, ".."),
    });
    expect(setup.stdout).toContain("Nothing has been uploaded yet. Run dotagents sync");
    expect(execFileSync("git", ["--git-dir", remote, "branch", "--format=%(refname)"], { encoding: "utf8" })).toBe("");
  });

  it("documents deny-by-default trust for every networked Git command", async () => {
    const help = await run("bun", ["src/cli.ts", "--help"], { cwd: join(import.meta.dir, "..") });
    expect(help.stdout).toContain("--provider github|gitlab");
    expect(help.stdout).toContain("one-time browser sign-in");
    expect(help.stdout).toContain("no provider CLI is required");
    expect(help.stdout).toContain("sync [library-directory] [--pull|--push]");
    expect(help.stdout).toContain("Network access is denied");
    expect(help.stdout).toContain("--allow-local-sources");
  });

  it("requires a remote when a non-interactive self-hosted setup is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-generic-"));
    roots.push(root);
    await expect(
      run("bun", ["src/cli.ts", "setup", join(root, "library"), "--provider", "generic", "--yes"], {
        cwd: join(import.meta.dir, ".."),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("--remote") });
  });

  it("requires an interactive Device Flow before a provider setup", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-provider-network-"));
    roots.push(root);
    await expect(
      run("bun", ["src/cli.ts", "setup", join(root, "library"), "--provider", "github", "--yes"], {
        cwd: join(import.meta.dir, ".."),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("interactively once") });
  });

  it("offers one guided setup command with a machine-readable preview", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-setup-"));
    roots.push(root);
    const library = join(root, "library");
    const home = join(root, "home");
    mkdirSync(join(library, "skills", "writing"), { recursive: true });
    writeFileSync(
      join(library, "skills", "writing", "SKILL.md"),
      "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n",
    );
    const preview = await run("bun", ["src/cli.ts", "setup", library, "--home", home, "--dry-run", "--json"], {
      cwd: join(import.meta.dir, ".."),
    });
    expect(JSON.parse(preview.stdout)).toMatchObject({ kind: "setup", summary: { skillsFound: 1, owned: 1 } });

    const applied = await run("bun", ["src/cli.ts", "setup", library, "--home", home, "--yes", "--json"], {
      cwd: join(import.meta.dir, ".."),
    });
    expect(JSON.parse(applied.stdout)).toMatchObject({ ok: true, result: { import: { copied: 0, adopted: 1 } } });
  });

  it("uses --home for status before a local connection profile exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-home-"));
    roots.push(root);
    const home = join(root, "home");
    const library = join(home, ".agents");
    await applyInitializeLibraryPlan(planInitializeLibrary(library, "personal"));

    const status = await run("bun", ["src/cli.ts", "status", "--home", home, "--json"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, DOTAGENTS_CONFIG_HOME: join(root, "config") },
    });

    expect(JSON.parse(status.stdout)).toMatchObject({ targets: [] });
  });

  it("previews, requires confirmation, applies, and reports status", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-e2e-"));
    roots.push(root);
    const library = join(root, "library");
    const targets = join(root, "targets");
    const planFile = join(root, "plan.json");
    mkdirSync(join(library, "skills/writing"), { recursive: true });
    writeFileSync(join(library, "skills/writing/SKILL.md"), "# Writing\n");
    writeFileSync(
      join(library, "skills.json"),
      JSON.stringify({
        schema_version: 1,
        name: "personal",
        version: "1.0.0",
        skills: ["skills/writing"],
        dependencies: {},
      }),
    );

    await run("bun", ["src/cli.ts", "plan", library, "--target", `fixture=copy=${targets}`, "--out", planFile], {
      cwd: join(import.meta.dir, ".."),
    });
    expect(JSON.parse(readFileSync(planFile, "utf8")).operations[0].action).toBe("create-copy");

    await expect(
      run("bun", ["src/cli.ts", "apply", planFile], { cwd: join(import.meta.dir, "..") }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("explicit --yes") });
    await run("bun", ["src/cli.ts", "apply", planFile, "--yes", "--json"], { cwd: join(import.meta.dir, "..") });
    const status = await run("bun", ["src/cli.ts", "status", library, "--json"], { cwd: join(import.meta.dir, "..") });
    expect(JSON.parse(status.stdout).targets[0]).toMatchObject({
      agent: "fixture",
      skill: "writing",
      health: "current",
    });
  });

  it("previews recovery and rejects an unreviewed confirmation", async () => {
    const library = mkdtempSync(join(tmpdir(), "dotagents-cli-recovery-"));
    roots.push(library);
    const preview = await run("bun", ["src/cli.ts", "recover", library, "--json"], {
      cwd: join(import.meta.dir, ".."),
    });
    const plan = JSON.parse(preview.stdout) as { planId: string; import: null; materialization: null };
    expect(plan).toMatchObject({ import: null, materialization: null });
    expect(plan.planId).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      run("bun", ["src/cli.ts", "recover", library, "--yes"], { cwd: join(import.meta.dir, "..") }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("--plan-id is missing") });
    const applied = await run("bun", ["src/cli.ts", "recover", library, "--plan-id", plan.planId, "--yes", "--json"], {
      cwd: join(import.meta.dir, ".."),
    });
    expect(JSON.parse(applied.stdout)).toEqual({ recovered: false, import: "none", materialization: false });
  });

  it("serializes the normalized reviewed source policy into a dependency plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "dotagents-cli-policy-"));
    roots.push(root);
    const upstream = join(root, "upstream");
    const library = join(root, "library");
    mkdirSync(join(upstream, "skills", "review"), { recursive: true });
    mkdirSync(library, { recursive: true });
    writeFileSync(
      join(upstream, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Reviews work.\n---\n# Review\n",
    );
    execFileSync("git", ["init", "--initial-branch", "main"], { cwd: upstream });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: upstream });
    execFileSync("git", ["config", "user.name", "test"], { cwd: upstream });
    execFileSync("git", ["add", "."], { cwd: upstream });
    execFileSync("git", ["commit", "-m", "review skill"], { cwd: upstream });
    const source = pathToFileURL(upstream).href;
    writeFileSync(
      join(library, "skills.json"),
      JSON.stringify({
        schema_version: 1,
        name: "policy-fixture",
        version: "1.0.0",
        skills: [],
        dependencies: { review: { url: source, ref: "HEAD", select: ["skills/review"] } },
      }),
    );

    const preview = await run(
      "bun",
      [
        "src/cli.ts",
        "resolve",
        library,
        "--trust-source",
        source,
        "--allow-local-sources",
        "--minimum-release-age",
        "0",
        "--json",
      ],
      { cwd: join(import.meta.dir, "..") },
    );
    expect(JSON.parse(preview.stdout).sourcePolicy).toEqual({
      trust: { mode: "allowlist", repositories: [source], hosts: [], github_organizations: [], allow_local: true },
      minimum_release_age_minutes: 0,
      minimum_release_age_exclude: [],
    });
  }, 20_000);
});
