import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { saveLocalSkillSource } from "./source-registry.js";
function assertSkillId(skill) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill))
        throw new Error(`Invalid skill identifier: ${skill}`);
}
function containsLinkedFile(root) {
    for (const name of readdirSync(root)) {
        const candidate = path.join(root, name);
        const stat = lstatSync(candidate);
        if (stat.isSymbolicLink())
            return true;
        if (stat.isDirectory() && containsLinkedFile(candidate))
            return true;
    }
    return false;
}
/**
 * Creates an independent, editable copy of an external skill.
 *
 * Symlinks are rejected rather than dereferenced: a fork must not silently
 * capture files outside the reviewed skill directory.
 */
export function forkSkillToLibrary(input) {
    assertSkillId(input.forkId);
    const source = realpathSync(input.sourceDirectory);
    if (!existsSync(path.join(source, "SKILL.md")))
        throw new Error("The source skill has no SKILL.md");
    if (containsLinkedFile(source))
        throw new Error("This skill contains a linked file and cannot be forked safely");
    mkdirSync(input.libraryDirectory, { recursive: true, mode: 0o700 });
    const library = realpathSync(input.libraryDirectory);
    const destination = path.resolve(library, input.forkId);
    if (path.dirname(destination) !== library)
        throw new Error("Fork destination is outside the library");
    if (existsSync(destination))
        throw new Error(`A skill named '${input.forkId}' already exists in this library`);
    try {
        cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
        saveLocalSkillSource(input.forkId, {
            source: "local",
            repository: null,
            skill_path: null,
            ref: null,
            content_sha256: null,
            ownership: "forked",
            forked_from: input.upstream,
        }, input.registryFile);
        return destination;
    }
    catch (error) {
        rmSync(destination, { recursive: true, force: true });
        throw error;
    }
}
//# sourceMappingURL=skill-fork.js.map