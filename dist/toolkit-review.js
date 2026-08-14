import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { planSkillExport } from "./export-policy.js";
/**
 * Canonical, UI-agnostic local-vs-library classification. Consumers provide
 * only portable identifiers and integrity hashes; no application state or
 * machine paths leak into the result.
 */
export function classifyToolkitChanges(input) {
    const libraryById = new Map(input.library.map((item) => [item.id, item]));
    const localIds = new Set(input.items.map((item) => item.id));
    const changes = new Map();
    for (const item of input.items) {
        const saved = libraryById.get(item.id);
        if (!saved) {
            const exclusion = input.libraryExclusions?.[item.id];
            const kind = exclusion?.integrity === item.integrity ? "kept-local" : "new-local";
            changes.set(`${kind}:${item.id}`, { id: item.id, name: item.name, kind });
        }
        else if (saved.integrity && saved.integrity !== item.integrity)
            changes.set(`changed-local:${item.id}`, { id: item.id, name: item.name, kind: "changed-local" });
    }
    for (const id of Object.keys(input.observedIntegrity ?? {})) {
        if (!localIds.has(id))
            changes.set(`missing-local:${id}`, { id, name: id, kind: "missing-local" });
    }
    const rank = {
        "changed-local": 0,
        "new-local": 1,
        "missing-local": 2,
        "kept-local": 3,
    };
    return [...changes.values()].sort((left, right) => rank[left.kind] - rank[right.kind] || left.name.localeCompare(right.name, "en"));
}
// Diffs are rendered through a virtualized viewport in Skiller, so the limit
// protects IPC and memory rather than the number of DOM rows. This comfortably
// covers large real-world SKILL.md files such as generated tool guides.
const TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
const SKILL_MD_PREVIEW_BYTES = 24_000;
const IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
};
function boundedPath(root, file) {
    const target = resolve(root, file);
    const remainder = relative(root, target);
    return !remainder || remainder.startsWith("..") || remainder.includes(`..${sep}`) ? null : target;
}
function boundedText(root, file) {
    const target = boundedPath(root, file);
    if (!target)
        return null;
    try {
        const metadata = lstatSync(target);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > TEXT_PREVIEW_BYTES)
            return null;
        const bytes = readFileSync(target);
        return bytes.includes(0) ? null : bytes.toString("utf8");
    }
    catch {
        return null;
    }
}
function boundedImage(root, file) {
    const mime = IMAGE_MIME_TYPES[file.slice(file.lastIndexOf(".")).toLowerCase()];
    const target = boundedPath(root, file);
    if (!mime || !target)
        return null;
    try {
        const metadata = lstatSync(target);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > IMAGE_PREVIEW_BYTES)
            return null;
        return `data:${mime};base64,${readFileSync(target).toString("base64")}`;
    }
    catch {
        return null;
    }
}
function skillMdPreview(root) {
    const target = join(root, "SKILL.md");
    try {
        const metadata = lstatSync(target);
        if (!metadata.isFile() || metadata.isSymbolicLink())
            return null;
        const content = readFileSync(target);
        const preview = content.subarray(0, SKILL_MD_PREVIEW_BYTES);
        return preview.includes(0) ? null : { text: preview.toString("utf8"), truncated: content.length > preview.length };
    }
    catch {
        return null;
    }
}
function compactDiff(saved, local) {
    const before = saved?.split("\n") ?? [], after = local?.split("\n") ?? [];
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
        prefix += 1;
    while (suffix < before.length - prefix &&
        suffix < after.length - prefix &&
        before[before.length - 1 - suffix] === after[after.length - 1 - suffix])
        suffix += 1;
    const lines = ["--- Saved library", "+++ This computer"];
    if (prefix)
        lines.push(`  … ${prefix} unchanged ${prefix === 1 ? "line" : "lines"}`);
    for (const line of before.slice(prefix, before.length - suffix))
        lines.push(`- ${line}`);
    for (const line of after.slice(prefix, after.length - suffix))
        lines.push(`+ ${line}`);
    if (suffix)
        lines.push(`  … ${suffix} unchanged ${suffix === 1 ? "line" : "lines"}`);
    return lines.join("\n");
}
function localState(path) {
    if (!existsSync(path))
        return "absent";
    const metadata = lstatSync(path);
    return metadata.isSymbolicLink()
        ? "symlink"
        : metadata.isDirectory()
            ? "directory"
            : metadata.isFile()
                ? "file"
                : "unsupported";
}
export function compareToolkitSkill(input) {
    const library = planSkillExport(input.id, input.libraryPath);
    const state = localState(input.localPath);
    let local = null;
    if (state === "directory") {
        try {
            local = planSkillExport(input.id, input.localPath);
        }
        catch {
            /* represented as unsupported below */
        }
    }
    const saved = new Map(library.files.map((file) => [file.relativePath, file.sha256]));
    const current = new Map((local?.files ?? []).map((file) => [file.relativePath, file.sha256]));
    const changed_files = [...saved.keys()]
        .filter((path) => current.has(path) && current.get(path) !== saved.get(path))
        .sort();
    const only_on_computer = [...current.keys()].filter((path) => !saved.has(path)).sort();
    const only_in_library = [...saved.keys()].filter((path) => !current.has(path)).sort();
    const localSkillMd = local ? skillMdPreview(input.localPath) : null;
    const librarySkillMd = skillMdPreview(input.libraryPath);
    return {
        local_state: state === "directory" && !local ? "unsupported" : state,
        local_file_count: local?.files.length ?? null,
        library_file_count: library.files.length,
        changed_files,
        only_on_computer,
        only_in_library,
        unchanged_file_count: [...saved.keys()].filter((path) => current.get(path) === saved.get(path)).length,
        ...(localSkillMd ? { local_skill_md: localSkillMd.text, local_skill_md_truncated: localSkillMd.truncated } : {}),
        ...(librarySkillMd
            ? { library_skill_md: librarySkillMd.text, library_skill_md_truncated: librarySkillMd.truncated }
            : {}),
    };
}
export function previewToolkitChangedFile(input) {
    const status = input.comparison.changed_files.includes(input.file)
        ? "modified"
        : input.comparison.only_on_computer.includes(input.file)
            ? "added"
            : input.comparison.only_in_library.includes(input.file)
                ? "deleted"
                : null;
    if (!status)
        throw new Error("This file is not changed in the selected skill");
    const image_data_url = boundedImage(status === "deleted" ? input.libraryPath : input.localPath, input.file);
    if (image_data_url)
        return { path: input.file, status, image_data_url };
    const diff = compactDiff(status === "added" ? null : boundedText(input.libraryPath, input.file), status === "deleted" ? null : boundedText(input.localPath, input.file));
    return diff
        ? { path: input.file, status, diff }
        : {
            path: input.file,
            status,
            unavailable_reason: "This file is binary, too large, or too long for an in-app diff.",
        };
}
export function previewNewToolkitFile(input) {
    if (!input.files.includes(input.file))
        throw new Error("This file is not part of the selected local skill");
    const image_data_url = boundedImage(input.localPath, input.file);
    if (image_data_url)
        return { path: input.file, status: "added", image_data_url };
    const text = boundedText(input.localPath, input.file);
    return text === null
        ? {
            path: input.file,
            status: "added",
            unavailable_reason: "This file is binary or too large for an in-app preview.",
        }
        : {
            path: input.file,
            status: "added",
            diff: ["--- Not in saved library", "+++ This computer", ...text.split("\n").map((line) => `+ ${line}`)].join("\n"),
        };
}
//# sourceMappingURL=toolkit-review.js.map