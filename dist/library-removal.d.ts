import { type LibraryManifest } from "./schema.js";
export interface CanonicalLibraryRemovalPlan {
    kind: "canonical-library-removal";
    schemaVersion: 1;
    planId: string;
    skillId: string;
    /** Relative path to delete after the reviewed portable files are written. */
    removedPath: string;
    manifest: LibraryManifest;
    portableFiles: Record<string, string>;
}
/**
 * Plans removal of one bundled skill from a canonical dotagents library.
 *
 * It intentionally does not touch the user's local installation: removing a
 * skill from a portable library is a Git-backed publication decision, not an
 * uninstall. The caller applies the returned portable files and removed path
 * transactionally, then commits and pushes them using its own transport.
 */
export declare function planCanonicalLibraryRemoval(root: string, skillId: string): CanonicalLibraryRemovalPlan;
//# sourceMappingURL=library-removal.d.ts.map