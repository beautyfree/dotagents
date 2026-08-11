import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyResourceAdoption, planResourceAdoption } from "../src/adopt.js";
import { listOperationHistory } from "../src/history.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(license?: string): { library: string; source: string } {
  const root = mkdtempSync(path.join(tmpdir(), "dotagents-adopt-"));
  roots.push(root);
  const library = path.join(root, "library");
  const source = path.join(root, "native-command.md");
  mkdirSync(library);
  writeFileSync(
    path.join(library, "skills.json"),
    `${JSON.stringify({ schema_version: 1, name: "adopt-test", version: "1.0.0", skills: [], dependencies: {}, ...(license ? { license } : {}) }, null, 2)}\n`,
  );
  writeFileSync(path.join(library, "dotagents.yaml"), "schema_version: 1\nskills: {}\n");
  writeFileSync(source, "# Review\n\nReview the current change.\n");
  return { library, source };
}

function command(source: string, library: string, visibility: "private" | "team" | "public" = "private") {
  return planResourceAdoption({
    libraryRoot: library,
    sourcePath: source,
    visibility,
    descriptor: {
      kind: "command",
      id: "review",
      path: "commands/review.md",
      format: "markdown",
      invocation: "review",
    },
  });
}

describe("reviewed unmanaged resource adoption", () => {
  test("previews and atomically adopts one data-only file without changing the native source", async () => {
    const current = fixture("MIT");
    const before = readFileSync(current.source, "utf8");
    const plan = await command(current.source, current.library, "public");
    expect(plan.blockers).toEqual([]);
    expect(plan.licenseReview).toMatchObject({ status: "reviewed", libraryLicense: "MIT" });
    expect(existsSync(path.join(current.library, "commands/review.md"))).toBe(false);

    const applied = await applyResourceAdoption(plan, plan.planId);
    expect(applied.historyId).toBeString();
    expect(listOperationHistory(current.library)[0]?.operation).toBe("resource-adopt");
    expect(readFileSync(path.join(current.library, "commands/review.md"), "utf8")).toBe(before);
    expect(readFileSync(current.source, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(path.join(current.library, "resources.json"), "utf8")).resources).toEqual([
      plan.resource,
    ]);
  });

  test("blocks public adoption without a reviewed library license", async () => {
    const current = fixture();
    const plan = await command(current.source, current.library, "public");
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "license-review" }));
    await expect(applyResourceAdoption(plan, plan.planId)).rejects.toThrow("blockers");
  });

  test("reports secret locations without serializing the matched value", async () => {
    const current = fixture("MIT");
    const secret = `postgres://user:${"p" + "assword"}@db.example/app`;
    writeFileSync(current.source, secret);
    const plan = await command(current.source, current.library, "public");
    expect(plan.secretFindings).toEqual([
      expect.objectContaining({ rule: "connection-string", line: 1, column: 1, relativePath: "native-command.md" }),
    ]);
    expect(JSON.stringify(plan)).not.toContain(secret);
    await expect(applyResourceAdoption(plan, plan.planId)).rejects.toThrow("blockers");
  });

  test("blocks identity/path collisions and existing canonical targets", async () => {
    const current = fixture("MIT");
    mkdirSync(path.join(current.library, "commands"));
    writeFileSync(path.join(current.library, "commands/review.md"), "user-owned\n");
    const plan = await command(current.source, current.library, "public");
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "target-exists" }));
    expect(readFileSync(path.join(current.library, "commands/review.md"), "utf8")).toBe("user-owned\n");
  });

  test("never adopts a resource over a portable or device control file", async () => {
    const current = fixture("MIT");
    for (const target of ["skills.lock", "dotagents.scope.json", "dotagents.local.yaml"]) {
      await expect(
        planResourceAdoption({
          libraryRoot: current.library,
          sourcePath: current.source,
          visibility: "private",
          descriptor: {
            kind: "command",
            id: "review",
            path: target,
            format: "markdown",
            invocation: "review",
          },
        }),
      ).rejects.toThrow("non-reserved portable library path");
    }
  });

  test("rejects changed source bytes after review", async () => {
    const current = fixture("MIT");
    const plan = await command(current.source, current.library, "public");
    writeFileSync(current.source, "changed after review\n");
    await expect(applyResourceAdoption(plan, plan.planId)).rejects.toThrow("changed after review");
    expect(existsSync(path.join(current.library, "resources.json"))).toBe(false);
  });
});
