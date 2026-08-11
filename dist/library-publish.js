import { planSkillExport } from "./export-policy.js";
import { computePlanId } from "./plan.js";
function canonicalCandidates(candidates) {
    const seen = new Set();
    return [...candidates]
        .sort((left, right) => left.id.localeCompare(right.id, "en"))
        .map((candidate) => {
        if (seen.has(candidate.id))
            throw new Error(`Duplicate library skill: ${candidate.id}`);
        seen.add(candidate.id);
        return {
            ...candidate,
            ...(candidate.installationAgentSlugs
                ? { installationAgentSlugs: [...new Set(candidate.installationAgentSlugs)].sort() }
                : {}),
        };
    });
}
/**
 * Creates a deterministic, no-write plan for a portable library. This is the
 * shared core used by the CLI and desktop clients; clients provide only UI and
 * provider-specific transport around the reviewed plan.
 */
export function planLibraryPublish(candidates) {
    const normalized = canonicalCandidates(candidates);
    const bundledCandidates = normalized.filter((candidate) => candidate.kind === undefined ||
        candidate.kind === "owned" ||
        candidate.kind === "vendored" ||
        candidate.kind === "snapshot");
    const bundledSkills = bundledCandidates.map((candidate) => {
        const exported = planSkillExport(candidate.id, candidate.sourcePath);
        return { ...exported, id: candidate.id, bundledPath: `skills/${candidate.id}` };
    });
    const bundledDistributions = Object.fromEntries(bundledCandidates.map((candidate) => [
        candidate.id,
        candidate.kind === "vendored" ? "vendored" : candidate.kind === "snapshot" ? "snapshot" : "owned",
    ]));
    const payload = {
        kind: "dotagents-library-publish",
        schemaVersion: 1,
        candidates: normalized,
        bundledSkills,
        bundledDistributions,
        vendoredOrigins: Object.fromEntries(bundledCandidates
            .filter((candidate) => candidate.kind === "vendored")
            .map((candidate) => [candidate.id, candidate.origin])),
        snapshotOrigins: Object.fromEntries(bundledCandidates
            .filter((candidate) => candidate.kind === "snapshot")
            .map((candidate) => [candidate.id, candidate.origin])),
        forkedFrom: Object.fromEntries(bundledCandidates
            .filter((candidate) => (candidate.kind === undefined || candidate.kind === "owned") && candidate.forkedFrom !== undefined)
            .map((candidate) => [candidate.id, candidate.forkedFrom])),
        secretFindings: bundledSkills.flatMap((skill) => skill.secretFindings),
    };
    return { ...payload, planId: computePlanId(payload) };
}
//# sourceMappingURL=library-publish.js.map