import { type GitFastForwardPlan } from "./git-fast-forward.js";
import type { SourceSecurityPolicyInput } from "./source-policy.js";
export type LinkedSkillPackage = {
    root: string;
    skills: string[];
};
export type LinkedSkillPackageUpdate = {
    package: LinkedSkillPackage;
    state: "up-to-date" | "ready" | "local-changes";
    plan: GitFastForwardPlan | null;
    localChanges: Array<{
        path: string;
        status: string;
    }>;
};
/**
 * Finds package worktrees from the links that are actually installed under a
 * shared skills directory. A package is not identified by its name: any Git
 * worktree with one or more direct skill links is handled the same way.
 */
export declare function discoverLinkedSkillPackages(sharedRoot: string): Promise<LinkedSkillPackage[]>;
/** Read-only review of a package worktree. No package-specific adapter needed. */
export declare function planLinkedSkillPackageUpdate(options: {
    sharedRoot: string;
    packageRoot: string;
    sourcePolicy?: SourceSecurityPolicyInput;
}): Promise<LinkedSkillPackageUpdate>;
/**
 * Applies the exact reviewed Git fast-forward. Existing links target paths
 * inside the same worktree, so they remain intact; no linked skill is ever
 * replaced individually.
 */
export declare function applyLinkedSkillPackageUpdate(options: {
    sharedRoot: string;
    packageRoot: string;
    plan: GitFastForwardPlan;
}): Promise<{
    package: LinkedSkillPackage;
    head: string;
}>;
//# sourceMappingURL=linked-skill-package-updates.d.ts.map