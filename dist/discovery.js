import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { normalizeGitIdentity } from "./git-identity.js";
import { scanOwnedSkill } from "./inventory.js";
export const DEFAULT_DISCOVERY_LIMITS = { maxDepth: 8, maxDirectories: 20_000 };
function metadata(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.replace(/^\uFEFF/, ""));
    if (!match)
        return { name: null, description: null, whenToUse: null };
    try {
        const value = parse(match[1] ?? "");
        const string = (key) => typeof value?.[key] === "string" && value[key].trim() ? value[key].trim() : null;
        return { name: string("name"), description: string("description"), whenToUse: string("when_to_use") };
    }
    catch {
        return { name: null, description: null, whenToUse: null };
    }
}
function portableKey(name) {
    return (name
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "skill");
}
function integritySuffix(integrity) {
    return createHash("sha256").update(integrity).digest("hex").slice(0, 8);
}
function issue(code, message, remediation, issuePath) {
    return { code, severity: "warning", message, remediation, path: issuePath };
}
async function exists(filePath) {
    try {
        await lstat(filePath);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
}
function sourcePackageName(url) {
    const pathname = url
        .replace(/\\/g, "/")
        .replace(/\.git$/i, "")
        .split("/")
        .filter(Boolean)
        .at(-1) ?? "source";
    const stem = portableKey(pathname);
    return `git-${stem}-${createHash("sha256").update(url).digest("hex").slice(0, 8)}`;
}
function originUrl(config) {
    const start = /^\s*\[remote "origin"\]\s*$/im.exec(config);
    const remainder = start ? config.slice((start.index ?? 0) + start[0].length) : "";
    const nextSection = remainder.search(/^\s*\[/m);
    const section = nextSection < 0 ? remainder : remainder.slice(0, nextSection);
    const value = section ? /^\s*url\s*=\s*(.+?)\s*$/im.exec(section)?.[1]?.trim() : undefined;
    if (!value)
        return null;
    try {
        return normalizeGitIdentity(value);
    }
    catch {
        // Credentials or an unsupported URL must never become portable metadata.
        return null;
    }
}
async function gitSourceForSkill(skillRoot) {
    let directory = skillRoot;
    for (;;) {
        const gitPath = path.join(directory, ".git");
        try {
            const gitStat = await lstat(gitPath);
            if (!gitStat.isDirectory())
                return null;
            const [config, head] = await Promise.all([
                readFile(path.join(gitPath, "config"), "utf8"),
                readFile(path.join(gitPath, "HEAD"), "utf8"),
            ]);
            const url = originUrl(config);
            if (!url)
                return null;
            const headValue = head.trim();
            const ref = headValue.startsWith("ref: ")
                ? (await readFile(path.join(gitPath, headValue.slice("ref: ".length).trim()), "utf8")).trim()
                : headValue;
            if (!/^[a-f0-9]{40,64}$/i.test(ref))
                return null;
            const relative = path.relative(directory, skillRoot).replaceAll(path.sep, "/") || ".";
            if (relative.startsWith("../") || path.isAbsolute(relative))
                return null;
            return { package: sourcePackageName(url), url, ref, skillPath: relative, source: "git" };
        }
        catch (error) {
            if (error.code !== "ENOENT")
                return null;
        }
        const parent = path.dirname(directory);
        if (parent === directory)
            return null;
        directory = parent;
    }
}
async function internalSkillMarkdownAlias(skillRoot, discoveryRoot) {
    try {
        const skillMd = path.join(skillRoot, "SKILL.md");
        if (!(await lstat(skillMd)).isSymbolicLink())
            return false;
        const [target, root] = await Promise.all([realpath(skillMd), realpath(discoveryRoot)]);
        const relative = path.relative(root, target);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    }
    catch {
        return false;
    }
}
async function collectRoots(root, limits) {
    const paths = [];
    const issues = [];
    let aliases = 0;
    let visited = 0;
    const visit = async (directory, depth) => {
        if (depth > limits.maxDepth)
            return;
        visited += 1;
        if (visited > limits.maxDirectories)
            throw new Error(`Discovery root exceeds ${limits.maxDirectories} directories`);
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            issues.push(issue("io-error", "A skill directory could not be read safely.", "Check its permissions or leave it local.", directory));
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
        for (const entry of entries) {
            if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".dotagents")
                continue;
            const candidate = path.join(directory, entry.name);
            let directoryLike = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                try {
                    directoryLike = (await stat(candidate)).isDirectory();
                }
                catch {
                    issues.push(issue("unsafe-link", "A dangling linked skill folder was left untouched.", "Repair or remove the link before importing it.", candidate));
                    continue;
                }
            }
            if (!directoryLike)
                continue;
            if (await exists(path.join(candidate, "SKILL.md"))) {
                if (await internalSkillMarkdownAlias(candidate, root.path))
                    aliases += 1;
                else
                    paths.push(candidate);
            }
            else if (!entry.isSymbolicLink())
                await visit(candidate, depth + 1);
        }
    };
    if (await exists(path.join(root.path, "SKILL.md")))
        paths.push(root.path);
    await visit(root.path, 0);
    return { paths, aliases, issues };
}
async function mapWithConcurrency(values, limit, work) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
        for (;;) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= values.length)
                return;
            const value = values[index];
            if (value === undefined)
                return;
            results[index] = await work(value);
        }
    });
    await Promise.all(workers);
    return results;
}
/**
 * Read-only cross-agent discovery. Byte-identical aliases are one skill with
 * multiple locations; same-name content differences remain explicit conflicts.
 */
export async function discoverSkills(roots, limits = DEFAULT_DISCOVERY_LIMITS) {
    const byIntegrity = new Map();
    const issues = [];
    let linkedAliases = 0;
    const sortedRoots = [...roots].sort((left, right) => `${left.kind}:${left.agent ?? ""}:${left.path}`.localeCompare(`${right.kind}:${right.agent ?? ""}:${right.path}`, "en"));
    const candidates = [];
    for (const root of sortedRoots) {
        if (!(await exists(root.path)))
            continue;
        let collected;
        try {
            collected = await collectRoots(root, limits);
        }
        catch (error) {
            issues.push(issue("limit-exceeded", error instanceof Error ? error.message : "Discovery limit exceeded.", "Narrow this discovery root or remove generated directories.", root.path));
            continue;
        }
        linkedAliases += collected.aliases;
        issues.push(...collected.issues);
        for (const candidate of collected.paths)
            candidates.push({ candidate, root });
    }
    const scannedCandidates = await mapWithConcurrency(candidates, 12, async ({ candidate, root }) => {
        try {
            const actual = await realpath(candidate);
            const scanned = await scanOwnedSkill(path.dirname(actual), path.basename(actual));
            if (!scanned.ok)
                return { root, candidate, issues: scanned.issues.map((entry) => ({ ...entry, severity: "warning" })) };
            return {
                root,
                candidate,
                actual,
                scanned: scanned.value,
                frontmatter: metadata(await readFile(path.join(actual, "SKILL.md"), "utf8")),
                gitSource: await gitSourceForSkill(actual),
            };
        }
        catch {
            return {
                root,
                candidate,
                issues: [
                    issue("file-not-found", "A discovered skill path no longer resolves.", "Refresh discovery after repairing the path.", candidate),
                ],
            };
        }
    });
    for (const result of scannedCandidates) {
        if ("issues" in result) {
            issues.push(...result.issues);
            continue;
        }
        const { root, actual, scanned, frontmatter, gitSource } = result;
        if (!scanned.exportHash) {
            issues.push(issue("io-error", "Could not calculate this skill's portable content hash.", "Refresh discovery after checking the skill files.", actual));
            continue;
        }
        const name = frontmatter.name?.trim() || path.basename(actual);
        const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
        const existing = byIntegrity.get(scanned.integrity);
        const location = { kind: root.kind, ...(root.agent ? { agent: root.agent } : {}) };
        if (existing) {
            if (!existing.locations.some((entry) => entry.kind === location.kind && entry.agent === location.agent))
                existing.locations.push(location);
            continue;
        }
        byIntegrity.set(scanned.integrity, {
            candidateKey: portableKey(name),
            name,
            description: frontmatter.description,
            whenToUse: frontmatter.whenToUse,
            integrity: scanned.integrity,
            exportHash: scanned.exportHash,
            fileCount: scanned.fileCount,
            bytes: scanned.bytes,
            sourcePath: actual,
            locations: [location],
            metadataValid: validName && frontmatter.name === name,
            ...(gitSource ? { gitSource } : {}),
        });
    }
    const skills = [...byIntegrity.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const skill of skills)
        skill.locations.sort((left, right) => `${left.kind}:${left.agent ?? ""}`.localeCompare(`${right.kind}:${right.agent ?? ""}`, "en"));
    const names = new Map();
    for (const skill of skills) {
        const folded = skill.name.toLocaleLowerCase("en-US");
        names.set(folded, [...(names.get(folded) ?? []), skill]);
    }
    const collisions = [...names.values()]
        .filter((group) => group.length > 1)
        .map((group) => {
        const first = group[0];
        if (!first)
            throw new Error("Collision group cannot be empty");
        for (const skill of group)
            skill.candidateKey = `${portableKey(skill.name)}-${integritySuffix(skill.integrity)}`;
        return { name: first.name, candidateKeys: group.map((skill) => skill.candidateKey) };
    });
    return { skills, collisions, issues, linkedAliases };
}
/** Produces conservative defaults: verified provenance is referenced; everything else is owned. */
export function suggestImportCandidates(report, provenance = []) {
    const conflicting = new Set(report.collisions.flatMap((collision) => collision.candidateKeys));
    return report.skills.map((skill) => {
        if (conflicting.has(skill.candidateKey) || !skill.metadataValid) {
            return {
                kind: "local-only",
                skill: portableKey(skill.name),
                sourcePath: skill.sourcePath,
                reason: conflicting.has(skill.candidateKey)
                    ? "Same-name content conflict requires a decision"
                    : "SKILL.md metadata needs review",
            };
        }
        // The Skills CLI global lock describes the canonical shared store. Do not
        // let a same-named direct install in an agent folder be silently replaced
        // by that provenance: it may be an independent local modification.
        const hasCanonicalSharedLocation = skill.locations.some((location) => location.kind === "shared");
        const source = hasCanonicalSharedLocation
            ? (provenance.find((entry) => entry.skill === skill.name && (!entry.integrity || entry.integrity === skill.integrity)) ?? skill.gitSource)
            : skill.gitSource;
        const agents = [...new Set(skill.locations.flatMap((location) => (location.agent ? [location.agent] : [])))].sort();
        if (source)
            return {
                kind: "dependency",
                skill: skill.name,
                package: source.package,
                url: source.url,
                ref: source.ref,
                skillPath: source.skillPath,
                ...(source.source ? { source: source.source } : {}),
                ...(agents.length ? { agents } : {}),
            };
        return { kind: "owned", skill: skill.name, sourcePath: skill.sourcePath, ...(agents.length ? { agents } : {}) };
    });
}
//# sourceMappingURL=discovery.js.map