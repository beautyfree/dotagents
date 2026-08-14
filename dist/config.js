import { parse } from "yaml";
import { z } from "zod";
import { normalizeGitIdentity } from "./git-identity.js";
import { normalizeSkillPath } from "./paths.js";
import { DENY_ALL_SOURCE_SECURITY_POLICY, sourceSecurityPolicySchema } from "./source-policy.js";
export const DOTAGENTS_CONFIG_VERSION = 1;
export const DOTAGENTS_CONFIG_FILE = "dotagents.yaml";
export const DOTAGENTS_LOCAL_CONFIG_FILE = "dotagents.local.yaml";
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);
const vendoredOriginSchema = z
    .object({
    url: z.string().min(1).max(2_048),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    skill_path: z.string().min(1).max(2_048),
    integrity: z.string().regex(/^sha256-[A-Za-z0-9+/]+={0,2}$/),
    license: z.string().min(1).max(128),
})
    .strict()
    .superRefine((origin, context) => {
    try {
        normalizeGitIdentity(origin.url);
    }
    catch (error) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: error instanceof Error ? error.message : "Invalid Git identity",
        });
    }
    if (origin.skill_path !== "." && !normalizeSkillPath(origin.skill_path)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["skill_path"],
            message: "Vendored skill path must be '.' or stay inside the source repository",
        });
    }
});
const snapshotOriginSchema = z
    .object({
    url: z.string().min(1).max(2_048),
    requested_ref: z.string().min(1).max(256),
    skill_path: z.string().min(1).max(2_048),
    integrity: z.string().regex(/^sha256-[A-Za-z0-9+/]+={0,2}$/),
    resolved_commit: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .optional(),
})
    .strict()
    .superRefine((origin, context) => {
    try {
        normalizeGitIdentity(origin.url);
    }
    catch (error) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: error instanceof Error ? error.message : "Invalid Git identity",
        });
    }
    if (origin.skill_path !== "." && !normalizeSkillPath(origin.skill_path)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["skill_path"],
            message: "Snapshot skill path must be '.' or stay inside the source repository",
        });
    }
});
/** The public upstream of an independently editable fork. Never includes a local path or credentials. */
const forkOriginSchema = z
    .object({
    url: z.string().min(1).max(2_048),
    ref: z.string().min(1).max(256).optional(),
    skill_path: z.string().min(1).max(2_048).optional(),
})
    .strict()
    .superRefine((origin, context) => {
    try {
        normalizeGitIdentity(origin.url);
    }
    catch (error) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["url"],
            message: error instanceof Error ? error.message : "Invalid Git identity",
        });
    }
    if (origin.skill_path && origin.skill_path !== "." && !normalizeSkillPath(origin.skill_path)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["skill_path"],
            message: "Fork skill path must be '.' or stay inside the source repository",
        });
    }
});
const portableSkillPolicySchema = z
    .object({
    include: z.boolean().optional(),
    agents: z.array(slug).min(1).optional(),
    distribution: z.enum(["dependency", "vendored", "snapshot"]).optional(),
    origin: vendoredOriginSchema.optional(),
    snapshot: snapshotOriginSchema.optional(),
    forked_from: forkOriginSchema.optional(),
})
    .strict()
    .superRefine((policy, context) => {
    if (policy.distribution === "vendored" && !policy.origin) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["origin"],
            message: "Vendored skills require immutable origin, integrity, and license metadata",
        });
    }
    if (policy.origin && policy.distribution !== "vendored") {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["origin"],
            message: "Origin metadata is allowed only for an explicitly vendored skill",
        });
    }
    if (policy.distribution === "snapshot" && !policy.snapshot) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["snapshot"],
            message: "Snapshot skills require source, requested ref, path, and integrity metadata",
        });
    }
    if (policy.snapshot && policy.distribution !== "snapshot") {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["snapshot"],
            message: "Snapshot metadata is allowed only for an explicitly snapshotted skill",
        });
    }
});
export const portableConfigSchema = z
    .object({
    schema_version: z.literal(DOTAGENTS_CONFIG_VERSION),
    minimum_dotagents_version: z.string().min(1).max(128).optional(),
    defaults: z
        .object({
        include: z.enum(["all", "owned", "selected"]).default("all"),
    })
        .strict()
        .default({ include: "all" }),
    skills: z.record(slug, portableSkillPolicySchema).default({}),
})
    .strict();
const envReference = z.string().regex(/^\$\{[A-Z_][A-Z0-9_]*\}$/);
export const localConfigSchema = z
    .object({
    schema_version: z.literal(DOTAGENTS_CONFIG_VERSION),
    agents: z
        .object({
        selected: z.array(slug).optional(),
        roots: z.record(slug, z.string().min(1).max(2_048)).optional(),
    })
        .strict()
        .optional(),
    materialization: z.enum(["auto", "native", "symlink", "junction", "copy"]).optional(),
    exclusions: z.array(slug).default([]),
    /**
     * Per-device choices for skills that intentionally stay outside one
     * canonical library.  This file is gitignored, so a choice on one
     * computer never hides a skill from another person's review queue.
     */
    library_exclusions: z.record(slug, z.object({ integrity: contentHash }).strict()).default({}),
    /** Skills recently added to this library on this device, keyed by add time. */
    library_recently_added: z.record(slug, z.string().datetime()).default({}),
    environment: z.record(slug, envReference).default({}),
    source_security: sourceSecurityPolicySchema.optional(),
})
    .strict();
function parseYamlSchema(input, schema, filename) {
    let value;
    try {
        value = parse(input);
    }
    catch (error) {
        throw new Error(`Invalid ${filename}: ${error instanceof Error ? error.message : "YAML parse failed"}`);
    }
    const result = schema.safeParse(value);
    if (!result.success) {
        const first = result.error.issues[0];
        const at = first?.path.length ? ` at ${first.path.join(".")}` : "";
        throw new Error(`Invalid ${filename}${at}: ${first?.message ?? "schema validation failed"}`);
    }
    return result.data;
}
export function parsePortableConfig(input) {
    return parseYamlSchema(input, portableConfigSchema, DOTAGENTS_CONFIG_FILE);
}
export function parseLocalConfig(input) {
    return parseYamlSchema(input, localConfigSchema, DOTAGENTS_LOCAL_CONFIG_FILE);
}
/** Local values are explicit overlays; provenance lets a UI explain every effective field. */
export function mergeConfig(portable, local) {
    const provenance = {
        defaults: "portable",
        skills: "portable",
        agents: "local",
        materialization: "local",
        exclusions: "local",
        libraryExclusions: "local",
        environment: "local",
        sourceSecurity: "local",
    };
    return {
        defaults: portable.defaults,
        skills: portable.skills,
        agents: local?.agents ?? {},
        materialization: local?.materialization ?? "auto",
        exclusions: [...(local?.exclusions ?? [])].sort(),
        libraryExclusions: { ...(local?.library_exclusions ?? {}) },
        environment: Object.fromEntries(Object.entries(local?.environment ?? {}).sort(([a], [b]) => a.localeCompare(b))),
        sourceSecurity: local?.source_security ?? DENY_ALL_SOURCE_SECURITY_POLICY,
        provenance,
    };
}
/**
 * Resolve agent slugs without inventing machine routes. Portable per-skill
 * routing and the private local selection are both allowlists; detection is
 * the final capability boundary.
 */
export function resolveSkillAgentSelection(config, skill, detectedAgents) {
    const detected = [...new Set(detectedAgents)].sort();
    const portableFilter = config.skills[skill]?.agents ? [...config.skills[skill].agents].sort() : null;
    const localFilter = config.agents.selected ? [...config.agents.selected].sort() : null;
    const portable = portableFilter ? new Set(portableFilter) : null;
    const local = localFilter ? new Set(localFilter) : null;
    return {
        skill,
        agents: detected.filter((agent) => (!portable || portable.has(agent)) && (!local || local.has(agent))),
        portableFilter,
        localFilter,
    };
}
//# sourceMappingURL=config.js.map