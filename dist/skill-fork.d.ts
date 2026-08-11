import { type LocalSkillSourceRecord } from "./source-registry.js";
export type SkillForkInput = {
    sourceDirectory: string;
    libraryDirectory: string;
    forkId: string;
    upstream: Pick<LocalSkillSourceRecord, "repository" | "skill_path" | "ref">;
    registryFile?: string;
};
/**
 * Creates an independent, editable copy of an external skill.
 *
 * Symlinks are rejected rather than dereferenced: a fork must not silently
 * capture files outside the reviewed skill directory.
 */
export declare function forkSkillToLibrary(input: SkillForkInput): string;
//# sourceMappingURL=skill-fork.d.ts.map