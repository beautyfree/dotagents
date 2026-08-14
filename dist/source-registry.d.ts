export interface LocalSkillSourceRecord {
    source: "git" | "local" | "skills.sh" | "clawhub";
    repository: string | null;
    skill_path: string | null;
    ref: string | null;
    content_sha256: string | null;
    /**
     * Canonical content fingerprint captured when the local skill was first
     * observed. Unlike content_sha256 (a legacy export hash), this is the
     * discovery integrity hash used to detect local edits safely.
     */
    observed_integrity?: string | null;
    /** First time dotagents recorded this skill on this computer. */
    first_seen_at: string;
    /** Set after a person has acknowledged a newly discovered skill. */
    reviewed_at: string | null;
    /** Relationship to the editable copy on this computer. */
    ownership: "external" | "owned" | "forked" | "unknown";
    /** Preserved upstream facts for an editable fork. */
    forked_from: {
        repository: string | null;
        skill_path: string | null;
        ref: string | null;
    } | null;
    updated_at: string;
}
export type ObservedLocalSkill = {
    skill: string;
    source?: LocalSkillSourceRecord["source"];
    repository?: string | null;
    skill_path?: string | null;
    ref?: string | null;
    content_sha256?: string | null;
    observed_integrity?: string | null;
};
export declare function sourceRegistryPath(environment?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): string;
export declare function readLocalSkillSources(file?: string): Record<string, LocalSkillSourceRecord>;
/** Device-local source metadata for update workflows; never copied into a portable library. */
export declare function saveLocalSkillSource(skill: string, input: Omit<LocalSkillSourceRecord, "updated_at" | "first_seen_at" | "reviewed_at" | "ownership" | "forked_from"> & Partial<Pick<LocalSkillSourceRecord, "reviewed_at" | "ownership" | "forked_from">>, file?: string): void;
export declare function markLocalSkillReviewed(skill: string, file?: string): void;
/**
 * Records skills discovered outside dotagents install/import flows.
 *
 * The first inventory is a baseline: it must not turn a person's established
 * toolkit into a wall of "new" work. Every skill discovered after that point
 * starts unreviewed until the person acknowledges it.
 */
export declare function observeLocalSkills(observed: ObservedLocalSkill[], file?: string): {
    initialized: boolean;
    added: string[];
};
export declare function removeLocalSkillSource(skill: string, file?: string): void;
//# sourceMappingURL=source-registry.d.ts.map