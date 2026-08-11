import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { parsePortableConfig } from "./config.js";
import { GitDependencyResolver } from "./git-resolver.js";
import { libraryManifestSchema } from "./schema.js";
import { planLibraryPublish } from "./library-publish.js";
import { computePlanId } from "./plan.js";
import { planResolveDependencies } from "./sources.js";
import { exactSourceSecurityPolicy, } from "./source-policy.js";
function readExistingConfig(root) {
    const file = path.join(root, "dotagents.yaml");
    return existsSync(file) ? parsePortableConfig(readFileSync(file, "utf8")) : null;
}
/**
 * Creates the canonical skills.json, skills.lock and dotagents.yaml from one
 * reviewed package-owned publish plan. UI clients supply transport and optional
 * opaque metadata only; they do not resolve sources or author library files.
 */
export async function planCanonicalLibraryPublication(input) {
    const root = path.resolve(input.root);
    const publish = planLibraryPublish(input.candidates);
    const existing = readExistingConfig(root);
    const dependencies = {};
    for (const candidate of publish.candidates) {
        if (candidate.kind === "git")
            dependencies[candidate.id] = { url: candidate.repository, ref: candidate.ref, select: [candidate.skillPath] };
        if (candidate.kind === "skills-cli")
            dependencies[candidate.id] = { url: candidate.sourceUrl, ref: candidate.ref, select: [candidate.skillPath] };
    }
    const manifest = libraryManifestSchema.parse({
        schema_version: 1,
        name: input.name,
        version: "0.1.0",
        description: "A portable AI-agent library powered by dotagents.",
        ...(input.license ? { license: input.license } : {}),
        skills: publish.bundledSkills.map((skill) => skill.bundledPath).sort(),
        dependencies,
        ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    const resolution = await planResolveDependencies(manifest, new GitDependencyResolver({
        cacheRoot: input.cacheRoot ?? path.join(root, ".dotagents", "cache", "git"),
        sourcePolicy: input.sourcePolicy ??
            exactSourceSecurityPolicy(Object.values(dependencies).map((dependency) => dependency.url)),
    }), null, input.generatedBy ?? "dotagents");
    const policies = publish.candidates.flatMap((candidate) => {
        const old = existing?.skills[candidate.id];
        const agents = candidate.installationAgentSlugs?.length
            ? [...new Set(candidate.installationAgentSlugs)].sort()
            : undefined;
        const policy = candidate.kind === "git" || candidate.kind === "skills-cli"
            ? { ...(agents ? { agents } : {}), distribution: "dependency" }
            : candidate.kind === "vendored"
                ? { ...(agents ? { agents } : {}), distribution: "vendored", origin: candidate.origin }
                : candidate.kind === "snapshot"
                    ? { ...(agents ? { agents } : {}), distribution: "snapshot", snapshot: candidate.origin }
                    : {
                        ...(agents ? { agents } : {}),
                        ...(candidate.forkedFrom
                            ? { forked_from: candidate.forkedFrom }
                            : old?.forked_from
                                ? { forked_from: old.forked_from }
                                : {}),
                        ...(old?.distribution === "vendored" ? { distribution: old.distribution, origin: old.origin } : {}),
                    };
        if (candidate.kind !== "git" && candidate.kind !== "skills-cli")
            return [[candidate.id, policy]];
        return (resolution.lock.resolved[candidate.id]?.skills ?? []).map((skill) => [skill.name, policy]);
    });
    const config = {
        schema_version: 1,
        defaults: { include: "all" },
        skills: Object.fromEntries(policies),
    };
    const files = {
        "skills.json": `${JSON.stringify(manifest, null, 2)}\n`,
        "skills.lock": `${JSON.stringify(resolution.lock, null, 2)}\n`,
        "dotagents.yaml": stringify(config, { lineWidth: 100 }),
        ".gitignore": "dotagents.local.yaml\n.dotagents/\n",
    };
    const payload = {
        kind: "canonical-library-publication",
        schemaVersion: 1,
        publish,
        manifest,
        lock: resolution.lock,
        sourcePolicy: resolution.sourcePolicy,
        portableFiles: files,
    };
    return { ...payload, planId: computePlanId(payload) };
}
//# sourceMappingURL=canonical-library.js.map