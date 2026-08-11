import { z } from "zod";
export declare const DOTAGENTS_CONFIG_VERSION: 1;
export declare const DOTAGENTS_CONFIG_FILE = "dotagents.yaml";
export declare const DOTAGENTS_LOCAL_CONFIG_FILE = "dotagents.local.yaml";
declare const vendoredOriginSchema: z.ZodEffects<z.ZodObject<{
    url: z.ZodString;
    commit: z.ZodString;
    skill_path: z.ZodString;
    integrity: z.ZodString;
    license: z.ZodString;
}, "strict", z.ZodTypeAny, {
    url: string;
    license: string;
    commit: string;
    integrity: string;
    skill_path: string;
}, {
    url: string;
    license: string;
    commit: string;
    integrity: string;
    skill_path: string;
}>, {
    url: string;
    license: string;
    commit: string;
    integrity: string;
    skill_path: string;
}, {
    url: string;
    license: string;
    commit: string;
    integrity: string;
    skill_path: string;
}>;
declare const snapshotOriginSchema: z.ZodEffects<z.ZodObject<{
    url: z.ZodString;
    requested_ref: z.ZodString;
    skill_path: z.ZodString;
    integrity: z.ZodString;
    resolved_commit: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    url: string;
    requested_ref: string;
    integrity: string;
    skill_path: string;
    resolved_commit?: string | undefined;
}, {
    url: string;
    requested_ref: string;
    integrity: string;
    skill_path: string;
    resolved_commit?: string | undefined;
}>, {
    url: string;
    requested_ref: string;
    integrity: string;
    skill_path: string;
    resolved_commit?: string | undefined;
}, {
    url: string;
    requested_ref: string;
    integrity: string;
    skill_path: string;
    resolved_commit?: string | undefined;
}>;
/** The public upstream of an independently editable fork. Never includes a local path or credentials. */
declare const forkOriginSchema: z.ZodEffects<z.ZodObject<{
    url: z.ZodString;
    ref: z.ZodOptional<z.ZodString>;
    skill_path: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    url: string;
    ref?: string | undefined;
    skill_path?: string | undefined;
}, {
    url: string;
    ref?: string | undefined;
    skill_path?: string | undefined;
}>, {
    url: string;
    ref?: string | undefined;
    skill_path?: string | undefined;
}, {
    url: string;
    ref?: string | undefined;
    skill_path?: string | undefined;
}>;
export declare const portableConfigSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    minimum_dotagents_version: z.ZodOptional<z.ZodString>;
    defaults: z.ZodDefault<z.ZodObject<{
        include: z.ZodDefault<z.ZodEnum<["all", "owned", "selected"]>>;
    }, "strict", z.ZodTypeAny, {
        include: "owned" | "all" | "selected";
    }, {
        include?: "owned" | "all" | "selected" | undefined;
    }>>;
    skills: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodEffects<z.ZodObject<{
        include: z.ZodOptional<z.ZodBoolean>;
        agents: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        distribution: z.ZodOptional<z.ZodEnum<["dependency", "vendored", "snapshot"]>>;
        origin: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            url: z.ZodString;
            commit: z.ZodString;
            skill_path: z.ZodString;
            integrity: z.ZodString;
            license: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        }, {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        }>, {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        }, {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        }>>;
        snapshot: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            url: z.ZodString;
            requested_ref: z.ZodString;
            skill_path: z.ZodString;
            integrity: z.ZodString;
            resolved_commit: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        }, {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        }>, {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        }, {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        }>>;
        forked_from: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            url: z.ZodString;
            ref: z.ZodOptional<z.ZodString>;
            skill_path: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        }, {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        }>, {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        }, {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }>, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }>>>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    skills: Record<string, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }>;
    defaults: {
        include: "owned" | "all" | "selected";
    };
    minimum_dotagents_version?: string | undefined;
}, {
    schema_version: 1;
    skills?: Record<string, {
        include?: boolean | undefined;
        snapshot?: {
            url: string;
            requested_ref: string;
            integrity: string;
            skill_path: string;
            resolved_commit?: string | undefined;
        } | undefined;
        agents?: string[] | undefined;
        distribution?: "dependency" | "snapshot" | "vendored" | undefined;
        origin?: {
            url: string;
            license: string;
            commit: string;
            integrity: string;
            skill_path: string;
        } | undefined;
        forked_from?: {
            url: string;
            ref?: string | undefined;
            skill_path?: string | undefined;
        } | undefined;
    }> | undefined;
    minimum_dotagents_version?: string | undefined;
    defaults?: {
        include?: "owned" | "all" | "selected" | undefined;
    } | undefined;
}>;
export declare const localConfigSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<1>;
    agents: z.ZodOptional<z.ZodObject<{
        selected: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        roots: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strict", z.ZodTypeAny, {
        selected?: string[] | undefined;
        roots?: Record<string, string> | undefined;
    }, {
        selected?: string[] | undefined;
        roots?: Record<string, string> | undefined;
    }>>;
    materialization: z.ZodOptional<z.ZodEnum<["auto", "native", "symlink", "junction", "copy"]>>;
    exclusions: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    environment: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    source_security: z.ZodOptional<z.ZodObject<{
        trust: z.ZodDefault<z.ZodObject<{
            mode: z.ZodDefault<z.ZodEnum<["deny", "allowlist", "allow-all"]>>;
            repositories: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            hosts: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            github_organizations: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            allow_local: z.ZodDefault<z.ZodBoolean>;
        }, "strict", z.ZodTypeAny, {
            mode: "deny" | "allowlist" | "allow-all";
            repositories: string[];
            hosts: string[];
            github_organizations: string[];
            allow_local: boolean;
        }, {
            mode?: "deny" | "allowlist" | "allow-all" | undefined;
            repositories?: string[] | undefined;
            hosts?: string[] | undefined;
            github_organizations?: string[] | undefined;
            allow_local?: boolean | undefined;
        }>>;
        minimum_release_age_minutes: z.ZodDefault<z.ZodNumber>;
        minimum_release_age_exclude: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        trust: {
            mode: "deny" | "allowlist" | "allow-all";
            repositories: string[];
            hosts: string[];
            github_organizations: string[];
            allow_local: boolean;
        };
        minimum_release_age_minutes: number;
        minimum_release_age_exclude: string[];
    }, {
        trust?: {
            mode?: "deny" | "allowlist" | "allow-all" | undefined;
            repositories?: string[] | undefined;
            hosts?: string[] | undefined;
            github_organizations?: string[] | undefined;
            allow_local?: boolean | undefined;
        } | undefined;
        minimum_release_age_minutes?: number | undefined;
        minimum_release_age_exclude?: string[] | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: 1;
    exclusions: string[];
    environment: Record<string, string>;
    agents?: {
        selected?: string[] | undefined;
        roots?: Record<string, string> | undefined;
    } | undefined;
    materialization?: "symlink" | "native" | "auto" | "junction" | "copy" | undefined;
    source_security?: {
        trust: {
            mode: "deny" | "allowlist" | "allow-all";
            repositories: string[];
            hosts: string[];
            github_organizations: string[];
            allow_local: boolean;
        };
        minimum_release_age_minutes: number;
        minimum_release_age_exclude: string[];
    } | undefined;
}, {
    schema_version: 1;
    agents?: {
        selected?: string[] | undefined;
        roots?: Record<string, string> | undefined;
    } | undefined;
    materialization?: "symlink" | "native" | "auto" | "junction" | "copy" | undefined;
    exclusions?: string[] | undefined;
    environment?: Record<string, string> | undefined;
    source_security?: {
        trust?: {
            mode?: "deny" | "allowlist" | "allow-all" | undefined;
            repositories?: string[] | undefined;
            hosts?: string[] | undefined;
            github_organizations?: string[] | undefined;
            allow_local?: boolean | undefined;
        } | undefined;
        minimum_release_age_minutes?: number | undefined;
        minimum_release_age_exclude?: string[] | undefined;
    } | undefined;
}>;
export type PortableConfig = z.infer<typeof portableConfigSchema>;
export type VendoredOrigin = z.infer<typeof vendoredOriginSchema>;
export type SnapshotOrigin = z.infer<typeof snapshotOriginSchema>;
export type ForkOrigin = z.infer<typeof forkOriginSchema>;
export type LocalConfig = z.infer<typeof localConfigSchema>;
export type ConfigProvenance = "portable" | "local";
export interface EffectiveConfig {
    defaults: PortableConfig["defaults"];
    skills: PortableConfig["skills"];
    agents: NonNullable<LocalConfig["agents"]>;
    materialization: NonNullable<LocalConfig["materialization"]>;
    exclusions: string[];
    environment: Record<string, string>;
    sourceSecurity: NonNullable<LocalConfig["source_security"]>;
    provenance: Record<string, ConfigProvenance>;
}
export interface SkillAgentSelection {
    skill: string;
    agents: string[];
    portableFilter: string[] | null;
    localFilter: string[] | null;
}
export declare function parsePortableConfig(input: string): PortableConfig;
export declare function parseLocalConfig(input: string): LocalConfig;
/** Local values are explicit overlays; provenance lets a UI explain every effective field. */
export declare function mergeConfig(portable: PortableConfig, local?: LocalConfig | null): EffectiveConfig;
/**
 * Resolve agent slugs without inventing machine routes. Portable per-skill
 * routing and the private local selection are both allowlists; detection is
 * the final capability boundary.
 */
export declare function resolveSkillAgentSelection(config: EffectiveConfig, skill: string, detectedAgents: Iterable<string>): SkillAgentSelection;
export {};
//# sourceMappingURL=config.d.ts.map