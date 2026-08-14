export type Platform = "darwin" | "linux" | "win32";
export type DetectionRule = {
    kind: "command";
    command: string;
} | {
    kind: "marker";
    path: string;
    ignoreSkillsOnly?: boolean;
};
export type SkillDelivery = {
    kind: "native-shared";
} | {
    kind: "per-skill-link";
    roots: string[];
} | {
    kind: "copy-only";
    roots: string[];
};
export interface AgentDescriptor {
    slug: string;
    displayName: string;
    platforms: Platform[];
    detection: DetectionRule[];
    skills: SkillDelivery[];
}
export declare function validateAgentDescriptor(descriptor: AgentDescriptor): void;
//# sourceMappingURL=agents.d.ts.map