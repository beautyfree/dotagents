import type { DiscoveredSkill } from "./discovery.js";
export interface GitSourceMigrationEntry {
    skill: string;
    source: string;
    action: "linked" | "unchanged" | "skipped";
    reason?: string;
}
export interface GitSourceMigrationPlan {
    kind: "git-source-migration";
    schemaVersion: 1;
    planId: string;
    library: string;
    baseConfigHash: string;
    nextConfigText: string;
    entries: GitSourceMigrationEntry[];
}
/**
 * Adds Git source metadata to already-bundled skills without changing their
 * files or turning them into dependencies. Only byte-identical local sources
 * are linked, so an old app-sidecar can never overwrite a user's library.
 */
export declare function planGitSourceMigration(libraryRoot: string, discovered: readonly DiscoveredSkill[]): Promise<GitSourceMigrationPlan>;
/** Writes only the exact reviewed migration and refuses a concurrently changed config. */
export declare function applyGitSourceMigration(plan: GitSourceMigrationPlan): Promise<void>;
//# sourceMappingURL=source-migration.d.ts.map