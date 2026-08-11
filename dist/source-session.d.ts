import { type DiscoveredSkill } from "./discovery.js";
import { type WorkspaceGitPort } from "./git-workspace.js";
import type { SourceSecurityPolicyInput } from "./source-policy.js";
export interface SkillSourceSessionOptions {
    repository: string;
    sourcePolicy: SourceSecurityPolicyInput;
    /** Optional reusable checkout owned by the calling application. */
    cacheDirectory?: string;
    /** Test or host override for disposable checkouts. Defaults to the OS temp directory. */
    temporaryRoot?: string;
    git?: WorkspaceGitPort;
    signal?: AbortSignal;
}
/**
 * A neutral, disposable view of a reviewed skill source. The caller never
 * performs Git operations directly: dotagents resolves, checks out, refreshes,
 * discovers, and disposes the source.
 */
export declare class SkillSourceSession {
    #private;
    readonly path: string;
    readonly skills: readonly DiscoveredSkill[];
    private constructor();
    static open(options: SkillSourceSessionOptions): Promise<SkillSourceSession>;
    findSkill(skillId: string, skillPathHint?: string | null): string | undefined;
    dispose(): Promise<void>;
}
//# sourceMappingURL=source-session.d.ts.map