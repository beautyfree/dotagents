import { describe, expect, it } from "bun:test";
import { parseSkillsCliLock, skillsCliLockToProvenance } from "../src/adapters/skills-cli.js";
import { scanTextForSecrets } from "../src/audit.js";
import { mergeConfig, parseLocalConfig, parsePortableConfig, resolveSkillAgentSelection } from "../src/config.js";
import { classifyThreeWaySkill } from "../src/reconcile.js";

describe("portable and local configuration", () => {
  it("merges machine-local choices deterministically and exposes provenance", () => {
    const portable = parsePortableConfig(
      "schema_version: 1\ndefaults: { include: owned }\nskills:\n  writing: { agents: [codex] }\n",
    );
    const local = parseLocalConfig(
      `schema_version: 1\nagents: { selected: [codex] }\nmaterialization: symlink\nexclusions: [private, scratch]\nenvironment: { github_token: '\${GITHUB_TOKEN}' }\n`,
    );
    expect(mergeConfig(portable, local)).toEqual(
      expect.objectContaining({
        defaults: { include: "owned" },
        agents: { selected: ["codex"] },
        materialization: "symlink",
        exclusions: ["private", "scratch"],
        provenance: expect.objectContaining({ skills: "portable", agents: "local" }),
        sourceSecurity: expect.objectContaining({ trust: expect.objectContaining({ mode: "deny" }) }),
      }),
    );
  });

  it("keeps source trust in Device-only local configuration", () => {
    const local = parseLocalConfig(`
schema_version: 1
source_security:
  trust:
    mode: allowlist
    repositories: [https://github.com/beautyfree/dotagents]
  minimum_release_age_minutes: 1440
`);
    const portable = parsePortableConfig("schema_version: 1\ndefaults: { include: all }\n");
    const effective = mergeConfig(portable, local);
    expect(effective.sourceSecurity.trust.repositories).toEqual(["https://github.com/beautyfree/dotagents"]);
    expect(effective.sourceSecurity.minimum_release_age_minutes).toBe(1440);
    expect(() =>
      parsePortableConfig(
        "schema_version: 1\ndefaults: { include: all }\nsource_security: { trust: { mode: allow-all } }\n",
      ),
    ).toThrow(/source_security|Unrecognized key/i);
  });

  it("rejects literal environment secrets in local configuration", () => {
    expect(() => parseLocalConfig("schema_version: 1\nenvironment: { token: literal-secret }\n")).toThrow(
      "environment.token",
    );
  });

  it("requires complete immutable provenance for explicit vendoring", () => {
    expect(() => parsePortableConfig("schema_version: 1\nskills:\n  toolkit: { distribution: vendored }\n")).toThrow(
      "skills.toolkit.origin",
    );
    const config = parsePortableConfig(
      `schema_version: 1\nskills:\n  toolkit:\n    distribution: vendored\n    origin:\n      url: https://github.com/example/toolkit.git\n      commit: ${"a".repeat(40)}\n      skill_path: skills/toolkit\n      integrity: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n      license: MIT\n`,
    );
    expect(config.skills.toolkit?.origin).toMatchObject({ license: "MIT", skill_path: "skills/toolkit" });
  });

  it("keeps portable provenance for a private source snapshot", () => {
    const config = parsePortableConfig(
      `schema_version: 1\nskills:\n  toolkit:\n    distribution: snapshot\n    snapshot:\n      url: https://github.com/example/toolkit.git\n      requested_ref: main\n      skill_path: skills/toolkit\n      integrity: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n`,
    );
    expect(config.skills.toolkit).toMatchObject({
      distribution: "snapshot",
      snapshot: { requested_ref: "main", skill_path: "skills/toolkit" },
    });
    expect(() => parsePortableConfig("schema_version: 1\nskills:\n  toolkit: { distribution: snapshot }\n")).toThrow(
      "Snapshot skills require source",
    );
  });

  it("allows portable fork attribution without turning an owned skill into a dependency", () => {
    const config = parsePortableConfig(
      `schema_version: 1
skills:
  writing:
    forked_from:
      url: https://github.com/example/writing.git
      ref: ${"a".repeat(40)}
      skill_path: skills/writing
`,
    );
    expect(config.skills.writing?.forked_from).toMatchObject({ skill_path: "skills/writing" });
  });

  it("intersects portable routing, private machine choice, and detected agents", () => {
    const portable = parsePortableConfig(
      "schema_version: 1\nskills:\n  writing: { agents: [claude-code, codex] }\n  shared: {}\n",
    );
    const local = parseLocalConfig("schema_version: 1\nagents: { selected: [codex, cursor] }\n");
    const effective = mergeConfig(portable, local);

    expect(resolveSkillAgentSelection(effective, "writing", ["codex", "cursor", "missing"])).toEqual({
      skill: "writing",
      agents: ["codex"],
      portableFilter: ["claude-code", "codex"],
      localFilter: ["codex", "cursor"],
    });
    expect(resolveSkillAgentSelection(effective, "shared", ["codex", "cursor"])).toMatchObject({
      agents: ["codex", "cursor"],
    });
  });
});

describe("shared safety primitives", () => {
  it("keeps secret values out of findings", () => {
    const text = "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456";
    const findings = scanTextForSecrets(text);
    expect(findings).toEqual([{ rule: "github-token", line: 1, column: 7 }]);
    expect(JSON.stringify(findings)).not.toContain("ghp_");
  });

  it("ignores obvious connection examples without weakening real credential detection", () => {
    expect(scanTextForSecrets("```env\nDATABASE_URL=postgres://user:pass@host/db\n```")).toEqual([]);
    expect(scanTextForSecrets("```env\nDATABASE_URL=postgresql://postgres:password@localhost:5432/app\n```")).toEqual(
      [],
    );
    expect(
      scanTextForSecrets("```env\nDATABASE_URL=postgresql://root:root@database.example.com:5432/app\n```"),
    ).toEqual([]);
    expect(scanTextForSecrets("DATABASE_URL=postgres://user:password@db.example/app")).toEqual([
      { rule: "connection-string", line: 1, column: 14 },
    ]);
    expect(
      scanTextForSecrets("```env\nDATABASE_URL=postgres://admin:real-production-value@db.example.com/app\n```"),
    ).toEqual([{ rule: "connection-string", line: 2, column: 14 }]);
    expect(scanTextForSecrets("DATABASE_URL=postgres://prod_app:s3cur3-value@db.internal/app")).toEqual([
      { rule: "connection-string", line: 1, column: 14 },
    ]);
  });

  it("never overwrites unknown local content by default", () => {
    expect(classifyThreeWaySkill("writing", null, "local", "remote").action).toBe("unmanaged");
  });
});

describe("Skills CLI adapter", () => {
  it("reads v3 and rejects unknown schemas", () => {
    const lock = parseSkillsCliLock(
      JSON.stringify({
        version: 3,
        skills: {
          writing: {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            ref: "main",
            skillPath: "skills/writing",
          },
        },
      }),
    );
    expect(lock).toMatchObject({ version: 3, skills: [{ name: "writing", ref: "main" }] });
    if (!lock) throw new Error("fixture lock did not parse");
    expect(skillsCliLockToProvenance(lock)).toEqual({
      provenance: [
        {
          skill: "writing",
          package: "owner-repo",
          url: "https://github.com/owner/repo",
          ref: "main",
          skillPath: "skills/writing",
          source: "skills-cli",
        },
      ],
      skipped: [],
    });
    expect(parseSkillsCliLock('{"version":999,"skills":{}}')).toBeNull();
  });
});
