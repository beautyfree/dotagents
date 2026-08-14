import { z } from "zod";
export declare const IMPORT_DISPOSITIONS: readonly ["suggested", "owned", "dependency", "vendored", "local-only", "excluded"];
export type ImportDisposition = (typeof IMPORT_DISPOSITIONS)[number];
export declare const importDecisionSchema: z.ZodEffects<z.ZodObject<{
    candidateKey: z.ZodString;
    disposition: z.ZodEnum<["suggested", "owned", "dependency", "vendored", "local-only", "excluded"]>;
    license: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    candidateKey: string;
    disposition: "excluded" | "dependency" | "vendored" | "owned" | "local-only" | "suggested";
    reason?: string | undefined;
    license?: string | undefined;
}, {
    candidateKey: string;
    disposition: "excluded" | "dependency" | "vendored" | "owned" | "local-only" | "suggested";
    reason?: string | undefined;
    license?: string | undefined;
}>, {
    candidateKey: string;
    disposition: "excluded" | "dependency" | "vendored" | "owned" | "local-only" | "suggested";
    reason?: string | undefined;
    license?: string | undefined;
}, {
    candidateKey: string;
    disposition: "excluded" | "dependency" | "vendored" | "owned" | "local-only" | "suggested";
    reason?: string | undefined;
    license?: string | undefined;
}>;
export type ImportDecision = z.infer<typeof importDecisionSchema>;
/** Parses a renderer/CLI decision set and rejects duplicate candidate keys. */
export declare function parseImportDecisions(input: unknown): ImportDecision[];
//# sourceMappingURL=decisions.d.ts.map