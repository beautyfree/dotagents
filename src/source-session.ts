import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverSkills, type DiscoveredSkill } from "./discovery.js";
import { applyGitFastForwardPlan, planGitFastForward } from "./git-fast-forward.js";
import { applyGitClonePlan, planGitCheckout, type WorkspaceGitPort } from "./git-workspace.js";
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
export class SkillSourceSession {
  readonly path: string;
  readonly skills: readonly DiscoveredSkill[];
  readonly #temporaryParent: string | null;

  private constructor(pathname: string, skills: readonly DiscoveredSkill[], temporaryParent: string | null) {
    this.path = pathname;
    this.skills = skills;
    this.#temporaryParent = temporaryParent;
  }

  static async open(options: SkillSourceSessionOptions): Promise<SkillSourceSession> {
    const execution = options.signal ? { signal: options.signal } : {};
    const cache = options.cacheDirectory ? path.resolve(options.cacheDirectory) : null;
    if (cache && existsSync(path.join(cache, ".git"))) {
      const plan = await planGitFastForward(cache, options.sourcePolicy, options.git, execution);
      await applyGitFastForwardPlan(plan, options.git);
      return SkillSourceSession.#fromCheckout(cache, null);
    }

    const temporaryParent = await mkdtemp(path.join(options.temporaryRoot ?? tmpdir(), "dotagents-source-"));
    const checkout = path.join(temporaryParent, "checkout");
    try {
      const plan = await planGitCheckout(
        options.repository,
        checkout,
        "HEAD",
        options.sourcePolicy,
        options.git,
        execution,
      );
      await applyGitClonePlan(plan, options.git, execution);
      return await SkillSourceSession.#fromCheckout(checkout, temporaryParent);
    } catch (error) {
      await rm(temporaryParent, { recursive: true, force: true });
      throw error;
    }
  }

  static async #fromCheckout(checkout: string, temporaryParent: string | null): Promise<SkillSourceSession> {
    const report = await discoverSkills([{ path: checkout, kind: "shared" }]);
    return new SkillSourceSession(checkout, report.skills, temporaryParent);
  }

  findSkill(skillId: string, skillPathHint?: string | null): string | undefined {
    const byDirectory = this.skills.find((skill) => path.basename(skill.sourcePath) === skillId);
    if (byDirectory) return byDirectory.sourcePath;
    const byName = this.skills.find((skill) => skill.name === skillId);
    if (byName) return byName.sourcePath;
    if (skillPathHint) {
      const byHint = this.skills.find((skill) => path.basename(skill.sourcePath) === skillPathHint);
      if (byHint) return byHint.sourcePath;
    }
    return undefined;
  }

  async dispose(): Promise<void> {
    if (this.#temporaryParent) await rm(this.#temporaryParent, { recursive: true, force: true });
  }
}
