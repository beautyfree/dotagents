import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { computeSkillIntegrity } from "./integrity.js";
import { loadLibrary } from "./library.js";
import { isMachineLocalMetadataPath } from "./paths.js";
import { parse } from "yaml";
export const DEFAULT_SCAN_LIMITS = {
    // Git-backed skill packages may include docs and checked-in tooling next to
    // their SKILL.md. This remains a bounded read-only inventory pass; portable
    // exports retain their stricter, explicit policy.
    maxFilesPerSkill: 2_000,
    // Discovery also fingerprints Git-backed packages before deciding whether
    // they stay linked. A few legitimate packages ship a single checked-in
    // helper binary, so the read-only scan limit is deliberately higher than a
    // later portable-copy policy.
    maxFileBytes: 64 * 1024 * 1024,
    maxSkillBytes: 1024 * 1024 * 1024,
};
function computePortableExportHash(files) {
    const entries = files
        .filter((file) => !isMachineLocalMetadataPath(file.path))
        .map((file) => `${file.path}\0${createHash("sha256").update(file.content).digest("hex")}`);
    return createHash("sha256").update(entries.join("\n")).digest("hex");
}
async function isWithinTrustedRoot(target, skillRoot, trustedRoots) {
    const roots = await Promise.all([skillRoot, ...trustedRoots].map(async (root) => {
        try {
            return await realpath(root);
        }
        catch {
            return null;
        }
    }));
    return roots.some((root) => {
        if (!root)
            return false;
        const relative = path.relative(root, target);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
}
export function declaredSkillName(skillMd) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillMd.replace(/^\uFEFF/, ""));
    if (!match)
        return null;
    try {
        const frontmatter = parse(match[1] ?? "");
        const name = typeof frontmatter?.name === "string" ? frontmatter.name.trim() : "";
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ? name : null;
    }
    catch {
        return null;
    }
}
function issue(code, message, remediation, filePath) {
    return { code, message, remediation, path: filePath };
}
async function collectSkillFiles(skillRoot, limits, options) {
    const files = [];
    let bytes = 0;
    const walk = async (directory) => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return issue("io-error", `Could not read skill directory ${directory}.`, "Check permissions and retry.", directory);
        }
        // Keep this byte ordering identical to export-policy's readdirSync().sort()
        // traversal. The resulting exportHash is compared to existing libraries,
        // so a locale-aware ordering here would create false local modifications.
        entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            const relative = path.relative(skillRoot, absolute).replaceAll(path.sep, "/");
            if (relative === ".dotagents-managed.json")
                continue;
            if (entry.isSymbolicLink()) {
                try {
                    const target = await realpath(absolute);
                    const targetMetadata = await lstat(target);
                    const allowed = targetMetadata.isFile() && (await isWithinTrustedRoot(target, skillRoot, options.trustedFileRoots ?? []));
                    if (!allowed) {
                        return issue("unsafe-link", `Skill contains a symbolic link at ${relative}.`, "Only links to regular files inside a reviewed root can be saved as portable copies.", absolute);
                    }
                    if (files.length >= limits.maxFilesPerSkill ||
                        targetMetadata.size > limits.maxFileBytes ||
                        bytes + targetMetadata.size > limits.maxSkillBytes) {
                        return issue("limit-exceeded", `Linked file ${relative} exceeds this library's portable file limits.`, "Reduce the linked file size or keep the skill as an external dependency.", absolute);
                    }
                    bytes += targetMetadata.size;
                    files.push({ path: relative, content: await readFile(target) });
                    continue;
                }
                catch {
                    return issue("unsafe-link", `Skill contains an unreadable symbolic link at ${relative}.`, "Repair the link or keep the skill as an external dependency.", absolute);
                }
            }
            if (entry.isDirectory()) {
                // A nested .agents directory describes local agent wiring. It is not
                // part of a portable skill bundle and commonly contains package links.
                if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".agents")
                    continue;
                const nested = await walk(absolute);
                if (nested)
                    return nested;
                continue;
            }
            if (!entry.isFile())
                continue;
            if (files.length >= limits.maxFilesPerSkill) {
                return issue("limit-exceeded", `Skill exceeds ${limits.maxFilesPerSkill} files.`, "Remove generated files or keep the skill as an external dependency.", skillRoot);
            }
            const metadata = await lstat(absolute);
            if (metadata.size > limits.maxFileBytes) {
                return issue("limit-exceeded", `${relative} exceeds the ${limits.maxFileBytes}-byte file limit.`, "Remove large generated or binary files from the portable skill.", absolute);
            }
            bytes += metadata.size;
            if (bytes > limits.maxSkillBytes) {
                return issue("limit-exceeded", `Skill exceeds the ${limits.maxSkillBytes}-byte total limit.`, "Reduce the skill size or keep it as an external dependency.", skillRoot);
            }
            files.push({ path: relative, content: await readFile(absolute) });
        }
        return null;
    };
    const unsafe = await walk(skillRoot);
    return unsafe ? { ok: false, issues: [unsafe] } : { ok: true, value: { files, bytes }, issues: [] };
}
export async function scanOwnedSkill(root, skillPath, limits = DEFAULT_SCAN_LIMITS, options = {}) {
    const skillRoot = skillPath === "." ? root : path.join(root, ...skillPath.split("/"));
    let metadata;
    try {
        metadata = await lstat(skillRoot);
    }
    catch {
        return {
            ok: false,
            issues: [
                issue("file-not-found", `Exported skill directory is missing: ${skillPath}.`, "Restore the directory or remove it from the manifest.", skillRoot),
            ],
        };
    }
    if (metadata.isSymbolicLink()) {
        return {
            ok: false,
            issues: [
                issue("unsafe-link", `Exported skill root is a symbolic link: ${skillPath}.`, "Use an external dependency or materialize reviewed files inside the library.", skillRoot),
            ],
        };
    }
    if (!metadata.isDirectory()) {
        return {
            ok: false,
            issues: [
                issue("invalid-manifest", `Exported skill is not a directory: ${skillPath}.`, "Point skills.json to a directory containing SKILL.md.", skillRoot),
            ],
        };
    }
    const skillFile = path.join(skillRoot, "SKILL.md");
    let skillFileMetadata;
    try {
        skillFileMetadata = await lstat(skillFile);
    }
    catch {
        return {
            ok: false,
            issues: [
                issue("missing-skill-file", `${skillPath} has no regular SKILL.md.`, "Add SKILL.md or remove this export.", skillFile),
            ],
        };
    }
    if (skillFileMetadata.isSymbolicLink()) {
        return {
            ok: false,
            issues: [
                issue("unsafe-link", `${skillPath}/SKILL.md is a symbolic link.`, "Replace it with a regular file inside the skill or use an external dependency.", skillFile),
            ],
        };
    }
    if (!skillFileMetadata.isFile()) {
        return {
            ok: false,
            issues: [
                issue("missing-skill-file", `${skillPath} has no regular SKILL.md.`, "Add SKILL.md or remove this export.", skillFile),
            ],
        };
    }
    const name = skillPath === "." ? declaredSkillName(await readFile(skillFile, "utf8")) : path.posix.basename(skillPath);
    if (!name) {
        return {
            ok: false,
            issues: [
                issue("missing-skill-metadata", "A repository-root skill must declare a portable name in SKILL.md frontmatter.", "Add a lowercase kebab-case name field to SKILL.md.", skillFile),
            ],
        };
    }
    const collected = await collectSkillFiles(skillRoot, limits, options);
    if (!collected.ok)
        return collected;
    return {
        ok: true,
        value: {
            name,
            path: skillPath,
            root: skillRoot,
            fileCount: collected.value.files.length,
            bytes: collected.value.bytes,
            integrity: computeSkillIntegrity(collected.value.files),
            exportHash: computePortableExportHash(collected.value.files),
        },
        issues: [],
    };
}
export async function scanLibrary(root, limits = DEFAULT_SCAN_LIMITS) {
    const loaded = await loadLibrary(root);
    if (!loaded.ok)
        return loaded;
    const ownedSkills = [];
    const names = new Set();
    for (const skillPath of loaded.value.manifest.skills) {
        const scanned = await scanOwnedSkill(root, skillPath, limits);
        if (!scanned.ok)
            return scanned;
        const folded = scanned.value.name.toLocaleLowerCase("en-US");
        if (names.has(folded)) {
            return {
                ok: false,
                issues: [
                    issue("duplicate-skill", `Multiple exported skills use the name ${scanned.value.name}.`, "Rename one skill so flat package names are unique.", skillPath),
                ],
            };
        }
        names.add(folded);
        const { root: _skillRoot, ...inventory } = scanned.value;
        ownedSkills.push(inventory);
    }
    ownedSkills.sort((left, right) => left.name.localeCompare(right.name, "en"));
    return {
        ok: true,
        value: {
            root,
            name: loaded.value.manifest.name,
            version: loaded.value.manifest.version,
            ownedSkills,
            dependencyCount: Object.keys(loaded.value.manifest.dependencies).length,
            locked: loaded.value.lock !== null,
        },
        issues: [],
    };
}
//# sourceMappingURL=inventory.js.map