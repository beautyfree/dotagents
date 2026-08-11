import type { ForkOrigin, SnapshotOrigin, VendoredOrigin } from "./config.js";
import { type SkillExportFinding, type SkillExportPlan } from "./export-policy.js";
export type { SkillExportFinding, SkillExportPlan } from "./export-policy.js";
/** A source-independent input for building a portable dotagents library. */
export interface OwnedLibrarySkillCandidate {
    kind?: "owned";
    id: string;
    sourcePath: string;
    installationAgentSlugs?: string[];
    /** Optional portable attribution when this owned copy began as an external skill. */
    forkedFrom?: ForkOrigin;
}
export interface GitLibrarySkillCandidate {
    kind: "git";
    id: string;
    repository: string;
    ref: string;
    skillPath: string;
    contentHash?: string;
    installationAgentSlugs?: string[];
}
/** A pinned skills.sh source. It is still a normal immutable Git dependency. */
export interface SkillsCliLibrarySkillCandidate {
    kind: "skills-cli";
    id: string;
    sourceUrl: string;
    ref: string;
    skillPath: string;
    contentHash?: string;
    installationAgentSlugs?: string[];
}
export interface VendoredLibrarySkillCandidate {
    kind: "vendored";
    id: string;
    sourcePath: string;
    origin: VendoredOrigin;
    installationAgentSlugs?: string[];
}
export interface SnapshotLibrarySkillCandidate {
    kind: "snapshot";
    id: string;
    sourcePath: string;
    origin: SnapshotOrigin;
    installationAgentSlugs?: string[];
}
export type LibraryPublishCandidate = OwnedLibrarySkillCandidate | GitLibrarySkillCandidate | SkillsCliLibrarySkillCandidate | VendoredLibrarySkillCandidate | SnapshotLibrarySkillCandidate;
export type LibraryBundledExportPlan = Omit<SkillExportPlan, "skill"> & {
    id: string;
    bundledPath: string;
};
export interface LibraryPublishPlan {
    kind: "dotagents-library-publish";
    schemaVersion: 1;
    planId: string;
    candidates: LibraryPublishCandidate[];
    bundledSkills: LibraryBundledExportPlan[];
    bundledDistributions: Record<string, "owned" | "vendored" | "snapshot">;
    vendoredOrigins: Record<string, VendoredOrigin>;
    snapshotOrigins: Record<string, SnapshotOrigin>;
    forkedFrom: Record<string, ForkOrigin>;
    secretFindings: SkillExportFinding[];
}
/**
 * Creates a deterministic, no-write plan for a portable library. This is the
 * shared core used by the CLI and desktop clients; clients provide only UI and
 * provider-specific transport around the reviewed plan.
 */
export declare function planLibraryPublish(candidates: LibraryPublishCandidate[]): LibraryPublishPlan;
//# sourceMappingURL=library-publish.d.ts.map