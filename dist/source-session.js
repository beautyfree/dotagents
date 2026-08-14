import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverSkills } from "./discovery.js";
import { applyGitFastForwardPlan, planGitFastForward } from "./git-fast-forward.js";
import { applyGitClonePlan, planGitCheckout } from "./git-workspace.js";
/**
 * A neutral, disposable view of a reviewed skill source. The caller never
 * performs Git operations directly: dotagents resolves, checks out, refreshes,
 * discovers, and disposes the source.
 */
export class SkillSourceSession {
    path;
    skills;
    #temporaryParent;
    constructor(pathname, skills, temporaryParent) {
        this.path = pathname;
        this.skills = skills;
        this.#temporaryParent = temporaryParent;
    }
    static async open(options) {
        const execution = options.signal ? { signal: options.signal } : {};
        const cache = options.cacheDirectory ? path.resolve(options.cacheDirectory) : null;
        if (cache && existsSync(path.join(cache, ".git"))) {
            const plan = await planGitFastForward(cache, options.sourcePolicy, options.git, execution);
            await applyGitFastForwardPlan(plan, options.git, execution);
            return SkillSourceSession.#fromCheckout(cache, null);
        }
        // A caller-provided cache is application-owned. Populate it on the first
        // read so the next background check can fast-forward in place rather than
        // cloning the same remote into a disposable directory again.
        if (cache) {
            await rm(cache, { recursive: true, force: true });
            await mkdir(path.dirname(cache), { recursive: true });
            try {
                const plan = await planGitCheckout(options.repository, cache, "HEAD", options.sourcePolicy, options.git, execution);
                await applyGitClonePlan(plan, options.git, execution);
                return await SkillSourceSession.#fromCheckout(cache, null);
            }
            catch (error) {
                await rm(cache, { recursive: true, force: true });
                throw error;
            }
        }
        const temporaryParent = await mkdtemp(path.join(options.temporaryRoot ?? tmpdir(), "dotagents-source-"));
        const checkout = path.join(temporaryParent, "checkout");
        try {
            const plan = await planGitCheckout(options.repository, checkout, "HEAD", options.sourcePolicy, options.git, execution);
            await applyGitClonePlan(plan, options.git, execution);
            return await SkillSourceSession.#fromCheckout(checkout, temporaryParent);
        }
        catch (error) {
            await rm(temporaryParent, { recursive: true, force: true });
            throw error;
        }
    }
    static async #fromCheckout(checkout, temporaryParent) {
        const report = await discoverSkills([{ path: checkout, kind: "shared" }]);
        return new SkillSourceSession(checkout, report.skills, temporaryParent);
    }
    findSkill(skillId, skillPathHint) {
        if (skillPathHint?.trim()) {
            const normalizedHint = skillPathHint
                .replace(/\\/g, "/")
                .replace(/^\.\//, "")
                .replace(/\/SKILL\.md$/i, "");
            const checkout = realpathSync.native(this.path);
            const byHint = this.skills.find((skill) => {
                const relative = path.relative(checkout, skill.sourcePath).replaceAll(path.sep, "/");
                return relative === normalizedHint;
            });
            if (byHint)
                return byHint.sourcePath;
        }
        const byDirectory = this.skills.find((skill) => path.basename(skill.sourcePath) === skillId);
        if (byDirectory)
            return byDirectory.sourcePath;
        const byName = this.skills.find((skill) => skill.name === skillId);
        if (byName)
            return byName.sourcePath;
        return undefined;
    }
    async dispose() {
        if (this.#temporaryParent)
            await rm(this.#temporaryParent, { recursive: true, force: true });
    }
}
//# sourceMappingURL=source-session.js.map