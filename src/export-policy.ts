import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { type SecretFinding, scanTextForSecrets } from "./audit.js";
import { isMachineLocalMetadataPath, normalizePortablePath } from "./paths.js";

export interface SkillExportLimits {
  maxFiles: number;
  maxBytes: number;
  excludedDirectories: readonly string[];
}

export const DEFAULT_SKILL_EXPORT_LIMITS: SkillExportLimits = {
  maxFiles: 1_000,
  maxBytes: 50 * 1024 * 1024,
  excludedDirectories: [".git", "node_modules"],
};

export interface SkillExportFile {
  relativePath: string;
  size: number;
  sha256: string;
}

export interface SkillExportFinding extends SecretFinding {
  relativePath: string;
}

export interface SkillExportPlan {
  skill: string;
  sourcePath: string;
  sha256: string;
  files: SkillExportFile[];
  excludedPaths: string[];
  secretFindings: SkillExportFinding[];
}

function assertSkillName(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new Error(`Skill name must be a lowercase kebab-case identifier: ${value}`);
}

/**
 * Builds a deterministic, value-free, read-only export plan for an owned skill.
 * Symlinks and unsupported file types are rejected instead of being followed.
 */
export function planSkillExport(
  skill: string,
  sourcePath: string,
  limits: SkillExportLimits = DEFAULT_SKILL_EXPORT_LIMITS,
): SkillExportPlan {
  assertSkillName(skill);
  if (!Number.isSafeInteger(limits.maxFiles) || limits.maxFiles < 1)
    throw new Error("Export maxFiles must be positive");
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1)
    throw new Error("Export maxBytes must be positive");
  const root = realpathSync(sourcePath);
  if (!lstatSync(root).isDirectory()) throw new Error(`Skill export source is not a directory: ${sourcePath}`);

  const excludedDirectories = new Set(limits.excludedDirectories);
  const files: SkillExportFile[] = [];
  const excludedPaths: string[] = [];
  const secretFindings: SkillExportFinding[] = [];
  let totalBytes = 0;

  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
      if (normalizePortablePath(relativePath) !== relativePath)
        throw new Error(`Skill export contains an unsafe path: ${relativePath}`);
      if (isMachineLocalMetadataPath(relativePath)) {
        excludedPaths.push(relativePath);
        continue;
      }
      const entry = lstatSync(absolutePath);
      if (entry.isSymbolicLink()) throw new Error(`Skill export rejects symlink: ${relativePath}`);
      if (entry.isDirectory()) {
        if (excludedDirectories.has(name)) {
          excludedPaths.push(relativePath);
          continue;
        }
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Skill export rejects unsupported file: ${relativePath}`);
      if (files.length >= limits.maxFiles) throw new Error(`Skill export exceeds ${limits.maxFiles} files`);

      const content = readFileSync(absolutePath);
      totalBytes += content.length;
      if (totalBytes > limits.maxBytes) throw new Error(`Skill export exceeds ${limits.maxBytes} bytes`);
      if (!content.subarray(0, Math.min(content.length, 8_192)).includes(0)) {
        for (const finding of scanTextForSecrets(content.toString("utf8"))) {
          secretFindings.push({ ...finding, relativePath });
        }
      }
      files.push({
        relativePath,
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  };

  visit(root);
  if (!files.some((file) => file.relativePath === "SKILL.md"))
    throw new Error(`Skill export requires SKILL.md: ${sourcePath}`);
  const sha256 = createHash("sha256")
    .update(files.map((file) => `${file.relativePath}\0${file.sha256}`).join("\n"))
    .digest("hex");
  return { skill, sourcePath: root, sha256, files, excludedPaths, secretFindings };
}
