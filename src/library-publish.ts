import type { ForkOrigin, SnapshotOrigin, VendoredOrigin } from "./config.js";
import { planSkillExport, type SkillExportFinding, type SkillExportPlan } from "./export-policy.js";
import { computePlanId } from "./plan.js";

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

export type LibraryPublishCandidate =
  | OwnedLibrarySkillCandidate
  | GitLibrarySkillCandidate
  | SkillsCliLibrarySkillCandidate
  | VendoredLibrarySkillCandidate
  | SnapshotLibrarySkillCandidate;

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

function canonicalCandidates(candidates: LibraryPublishCandidate[]): LibraryPublishCandidate[] {
  const seen = new Set<string>();
  return [...candidates]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((candidate) => {
      if (seen.has(candidate.id)) throw new Error(`Duplicate library skill: ${candidate.id}`);
      seen.add(candidate.id);
      return {
        ...candidate,
        ...(candidate.installationAgentSlugs
          ? { installationAgentSlugs: [...new Set(candidate.installationAgentSlugs)].sort() }
          : {}),
      } as LibraryPublishCandidate;
    });
}

/**
 * Creates a deterministic, no-write plan for a portable library. This is the
 * shared core used by the CLI and desktop clients; clients provide only UI and
 * provider-specific transport around the reviewed plan.
 */
export function planLibraryPublish(candidates: LibraryPublishCandidate[]): LibraryPublishPlan {
  const normalized = canonicalCandidates(candidates);
  const bundledCandidates = normalized.filter(
    (
      candidate,
    ): candidate is OwnedLibrarySkillCandidate | VendoredLibrarySkillCandidate | SnapshotLibrarySkillCandidate =>
      candidate.kind === undefined ||
      candidate.kind === "owned" ||
      candidate.kind === "vendored" ||
      candidate.kind === "snapshot",
  );
  const bundledSkills = bundledCandidates.map((candidate): LibraryBundledExportPlan => {
    const exported = planSkillExport(candidate.id, candidate.sourcePath);
    return { ...exported, id: candidate.id, bundledPath: `skills/${candidate.id}` };
  });
  const bundledDistributions: Record<string, "owned" | "vendored" | "snapshot"> = Object.fromEntries(
    bundledCandidates.map((candidate) => [
      candidate.id,
      candidate.kind === "vendored" ? "vendored" : candidate.kind === "snapshot" ? "snapshot" : "owned",
    ]),
  );
  const payload = {
    kind: "dotagents-library-publish" as const,
    schemaVersion: 1 as const,
    candidates: normalized,
    bundledSkills,
    bundledDistributions,
    vendoredOrigins: Object.fromEntries(
      bundledCandidates
        .filter((candidate): candidate is VendoredLibrarySkillCandidate => candidate.kind === "vendored")
        .map((candidate) => [candidate.id, candidate.origin]),
    ),
    snapshotOrigins: Object.fromEntries(
      bundledCandidates
        .filter((candidate): candidate is SnapshotLibrarySkillCandidate => candidate.kind === "snapshot")
        .map((candidate) => [candidate.id, candidate.origin]),
    ),
    forkedFrom: Object.fromEntries(
      bundledCandidates
        .filter(
          (candidate): candidate is OwnedLibrarySkillCandidate & { forkedFrom: ForkOrigin } =>
            (candidate.kind === undefined || candidate.kind === "owned") && candidate.forkedFrom !== undefined,
        )
        .map((candidate) => [candidate.id, candidate.forkedFrom]),
    ),
    secretFindings: bundledSkills.flatMap((skill) => skill.secretFindings),
  };
  return { ...payload, planId: computePlanId(payload) };
}
