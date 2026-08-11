import path from "node:path";
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
// Finder, Windows Explorer, and similar file managers can create these files
// inside a skill folder without the person using the library doing anything.
// They are device metadata, never part of a portable agent library.
const machineLocalMetadataNames = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
export function isMachineLocalMetadataPath(input) {
    return input
        .replaceAll("\\", "/")
        .replace(/^\.\//, "")
        .split("/")
        .some((segment) => machineLocalMetadataNames.has(segment));
}
export function normalizePortablePath(input) {
    const normalized = input.replaceAll("\\", "/");
    if (normalized.length === 0 ||
        normalized.startsWith("/") ||
        /^[A-Za-z]:\//.test(normalized) ||
        normalized.includes("\0"))
        return null;
    const rawSegments = normalized.split("/");
    if (rawSegments.some((segment) => segment === ".."))
        return null;
    const clean = path.posix.normalize(normalized);
    if (clean === "." || clean === ".." || clean.startsWith("../"))
        return null;
    const segments = clean.split("/");
    if (segments.some((segment) => segment.length === 0 ||
        [...segment].some((character) => character.charCodeAt(0) <= 0x1f) ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        windowsReservedName.test(segment)))
        return null;
    return clean;
}
export function normalizeSkillPath(input) {
    const clean = normalizePortablePath(input);
    if (!clean)
        return null;
    return clean.startsWith("./") ? clean.slice(2) : clean;
}
//# sourceMappingURL=paths.js.map