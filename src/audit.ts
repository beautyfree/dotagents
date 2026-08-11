import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { DotagentsIssue } from "./issues.js";
import { scanLibrary, type LibraryInventory } from "./inventory.js";
import { loadLibrary } from "./library.js";

export type SecretFinding = {
  rule:
    | "private-key"
    | "github-token"
    | "provider-token"
    | "aws-access-key"
    | "connection-string"
    | "credential-assignment";
  line: number;
  column: number;
};

export type SecretFileFinding = SecretFinding & {
  /** Portable path inside the reviewed skill. Never an absolute machine path. */
  relativePath: string;
};

type SecretRule = { id: SecretFinding["rule"]; pattern: RegExp };

const secretRules: SecretRule[] = [
  { id: "private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
  { id: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { id: "provider-token", pattern: /\b(?:sk-ant-|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/g },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: "connection-string",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s@]+@[^/\s:]+(?::\d+)?/gi,
  },
];

function isDocumentedConnectionExample(line: string, matchedUri: string, fencedExample: boolean): boolean {
  if (
    /(?:\b(?:placeholder|sample|replace(?:\s+me)?|your[_ -]?(?:database|password|url|credential)|real values?)\b|\be\.g\.)/i.test(
      line,
    )
  )
    return true;

  // Documentation commonly uses syntactically valid connection URLs so that
  // examples can be copied and edited. Treat only unmistakable placeholder
  // credentials as examples; realistic or unknown credentials still block.
  if (!fencedExample) return false;
  const credentials = /^[a-z][a-z0-9+.-]*:\/\/([^:/\s@]+):([^/\s@]+)@([^/:\s]+)/i.exec(matchedUri);
  if (!credentials) return false;
  const placeholderUser =
    /^(?:user(?:name)?|postgres|root|admin|db|database|example|demo|test|your[_-]?user(?:name)?)$/i;
  const placeholderPassword =
    /^(?:pass(?:word)?|postgres|root|admin|secret|token|changeme|replace[_-]?me|your[_-]?(?:pass(?:word)?|secret)|example|demo|test)$/i;
  const placeholderHost =
    /^(?:localhost|127\.0\.0\.1|db|database|host|hostname|(?:db|database)\.example(?:\.(?:com|org|net))?|example\.(?:com|org|net))$/i;
  // Requiring all three parts to look synthetic avoids hiding a real secret
  // merely because a production username happens to be `admin` or `postgres`.
  return (
    placeholderUser.test(credentials[1] ?? "") &&
    placeholderPassword.test(credentials[2] ?? "") &&
    placeholderHost.test(credentials[3] ?? "")
  );
}

/** Returns locations and rule IDs only; matched values never cross the API boundary. */
export function scanTextForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  let fencedExample = false;
  for (const [lineIndex, line] of lines.entries()) {
    const fence = /^\s*```/.test(line);
    for (const rule of secretRules) {
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(line);
      while (match !== null) {
        if (rule.id !== "connection-string" || !isDocumentedConnectionExample(line, match[0], fencedExample)) {
          findings.push({ rule: rule.id, line: lineIndex + 1, column: match.index + 1 });
        }
        match = rule.pattern.exec(line);
      }
    }
    if (fence) fencedExample = !fencedExample;
  }
  return findings;
}

/**
 * Scans a skill that already passed the bounded inventory rules. The returned
 * findings contain only a relative file location and rule ID; matched values
 * are deliberately discarded before crossing the API boundary.
 */
export async function scanSkillForSecrets(skillRoot: string): Promise<SecretFileFinding[]> {
  const findings: SecretFileFinding[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".dotagents-managed.json") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to scan linked import content: ${absolute}`);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(skillRoot, absolute).replaceAll(path.sep, "/");
      const content = await readFile(absolute);
      // NUL-heavy binary files are not useful secret-text input. They remain
      // covered by inventory size/hash checks and are copied byte-for-byte.
      const prefix = content.subarray(0, Math.min(content.length, 8_192));
      if (prefix.includes(0)) continue;
      for (const finding of scanTextForSecrets(content.toString("utf8"))) findings.push({ ...finding, relativePath });
    }
  };
  await walk(skillRoot);
  return findings;
}

export interface AuditLibraryOptions {
  root: string;
  visibility?: "private" | "team" | "public";
}

export interface LibraryAuditReport {
  ok: boolean;
  publicReady: boolean;
  library: LibraryInventory | null;
  issues: DotagentsIssue[];
}

export type LibrarySecretFinding = SecretFileFinding & { skill: string };

/** Scans only owned portable files; dependency content is represented by its immutable lock. */
export async function scanLibraryForSecrets(root: string): Promise<LibrarySecretFinding[]> {
  const scanned = await scanLibrary(path.resolve(root));
  if (!scanned.ok) throw new Error(scanned.issues.map((issue) => issue.message).join("; "));
  const findings: LibrarySecretFinding[] = [];
  for (const skill of scanned.value.ownedSkills) {
    const skillRoot = path.join(scanned.value.root, ...skill.path.split("/"));
    for (const finding of await scanSkillForSecrets(skillRoot)) findings.push({ ...finding, skill: skill.name });
  }
  return findings;
}

function auditIssue(
  code: "missing-skill-metadata" | "missing-license",
  severity: "error" | "warning",
  message: string,
  remediation: string,
  field?: string,
): DotagentsIssue {
  return { code, severity, message, remediation, ...(field ? { field } : {}) };
}

function skillFrontmatter(input: string): Record<string, unknown> | null {
  const normalized = input.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized);
  if (!match) return null;
  try {
    const value = parse(match[1] ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Structural audit only: reads bounded files already accepted by inventory and never executes skill content. */
export async function auditLibrary(options: AuditLibraryOptions): Promise<LibraryAuditReport> {
  const root = path.resolve(options.root);
  const issues: DotagentsIssue[] = [];
  const scanned = await scanLibrary(root);
  if (!scanned.ok)
    return {
      ok: false,
      publicReady: false,
      library: null,
      issues: scanned.issues.map((issue) => ({ ...issue, severity: issue.severity ?? "error" })),
    };
  const loaded = await loadLibrary(root);
  if (!loaded.ok)
    return {
      ok: false,
      publicReady: false,
      library: scanned.value,
      issues: loaded.issues.map((issue) => ({ ...issue, severity: issue.severity ?? "error" })),
    };

  const publicVisibility = options.visibility === "public";
  if (!loaded.value.manifest.license) {
    issues.push(
      auditIssue(
        "missing-license",
        publicVisibility ? "error" : "warning",
        "The library manifest has no license.",
        publicVisibility
          ? "Choose a license before publishing this library publicly."
          : "Add a license before sharing or redistributing the library.",
        "license",
      ),
    );
  }
  for (const skill of scanned.value.ownedSkills) {
    const content = await readFile(path.join(root, ...skill.path.split("/"), "SKILL.md"), "utf8");
    const frontmatter = skillFrontmatter(content);
    if (!frontmatter) {
      issues.push(
        auditIssue(
          "missing-skill-metadata",
          "error",
          `${skill.name}/SKILL.md has no valid YAML frontmatter.`,
          "Add frontmatter with name and description.",
          `${skill.path}/SKILL.md`,
        ),
      );
      continue;
    }
    if (frontmatter.name !== skill.name) {
      issues.push(
        auditIssue(
          "missing-skill-metadata",
          "error",
          `${skill.name}/SKILL.md must declare name: ${skill.name}.`,
          "Make the frontmatter name match the exported skill folder.",
          `${skill.path}/SKILL.md:name`,
        ),
      );
    }
    if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
      issues.push(
        auditIssue(
          "missing-skill-metadata",
          "error",
          `${skill.name}/SKILL.md has no description.`,
          "Add a concise frontmatter description so agents can select the skill.",
          `${skill.path}/SKILL.md:description`,
        ),
      );
    }
  }
  for (const [name, dependency] of Object.entries(loaded.value.lock?.resolved ?? {})) {
    if (!dependency.license) {
      issues.push(
        auditIssue(
          "missing-license",
          publicVisibility ? "error" : "warning",
          `Dependency ${name} has no recorded license metadata.`,
          "Review the upstream repository license before redistributing or vendoring it.",
          `dependencies.${name}.license`,
        ),
      );
    }
  }
  const hasError = issues.some((issue) => issue.severity === "error");
  const licenseWarnings = issues.some((issue) => issue.code === "missing-license");
  return { ok: !hasError, publicReady: !hasError && !licenseWarnings, library: scanned.value, issues };
}
