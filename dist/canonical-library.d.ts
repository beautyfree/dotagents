import { type LibraryLock, type LibraryManifest } from "./schema.js";
import { type LibraryPublishCandidate, type LibraryPublishPlan } from "./library-publish.js";
import { type SourceSecurityPolicy, type SourceSecurityPolicyInput } from "./source-policy.js";
export interface CanonicalLibraryPublicationInput {
    root: string;
    name: string;
    candidates: LibraryPublishCandidate[];
    /** Portable, consumer-owned metadata. dotagents stores it but never interprets it. */
    metadata?: Record<string, unknown>;
    license?: string;
    sourcePolicy?: SourceSecurityPolicyInput;
    cacheRoot?: string;
    generatedBy?: string;
}
export interface CanonicalLibraryPublicationPlan {
    kind: "canonical-library-publication";
    schemaVersion: 1;
    planId: string;
    publish: LibraryPublishPlan;
    manifest: LibraryManifest;
    lock: LibraryLock;
    sourcePolicy: SourceSecurityPolicy | null;
    portableFiles: Record<string, string>;
}
/**
 * Creates the canonical skills.json, skills.lock and dotagents.yaml from one
 * reviewed package-owned publish plan. UI clients supply transport and optional
 * opaque metadata only; they do not resolve sources or author library files.
 */
export declare function planCanonicalLibraryPublication(input: CanonicalLibraryPublicationInput): Promise<CanonicalLibraryPublicationPlan>;
//# sourceMappingURL=canonical-library.d.ts.map