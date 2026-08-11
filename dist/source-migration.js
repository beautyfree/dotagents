import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { DOTAGENTS_CONFIG_FILE, parsePortableConfig } from "./config.js";
import { scanOwnedSkill } from "./inventory.js";
import { loadLibrary } from "./library.js";
import { computePlanId } from "./plan.js";
function hashText(value) {
    return createHash("sha256").update(value).digest("hex");
}
function configText(config) {
    return `${stringify(config, { lineWidth: 0 })}`;
}
/**
 * Adds Git source metadata to already-bundled skills without changing their
 * files or turning them into dependencies. Only byte-identical local sources
 * are linked, so an old app-sidecar can never overwrite a user's library.
 */
export async function planGitSourceMigration(libraryRoot, discovered) {
    const library = path.resolve(libraryRoot);
    const loaded = await loadLibrary(library);
    if (!loaded.ok)
        throw new Error(loaded.issues.map((entry) => entry.message).join("; "));
    const currentText = await readFile(path.join(library, DOTAGENTS_CONFIG_FILE), "utf8");
    const config = structuredClone(parsePortableConfig(currentText));
    const entries = [];
    const localByName = new Map(discovered.map((skill) => [skill.name.toLocaleLowerCase("en-US"), skill]));
    for (const skillPath of loaded.value.manifest.skills) {
        const skill = path.posix.basename(skillPath);
        const local = localByName.get(skill.toLocaleLowerCase("en-US"));
        const source = local?.gitSource;
        if (!source) {
            entries.push({ skill, source: "", action: "skipped", reason: "No portable Git source was found locally" });
            continue;
        }
        const existing = config.skills[skill];
        if (existing?.distribution || existing?.snapshot || existing?.origin) {
            entries.push({
                skill,
                source: source.url,
                action: "unchanged",
                reason: "The library already records its distribution",
            });
            continue;
        }
        const bundled = await scanOwnedSkill(library, skillPath);
        if (!bundled.ok || bundled.value.exportHash !== local.exportHash) {
            entries.push({
                skill,
                source: source.url,
                action: "skipped",
                reason: "The saved copy differs from the local Git source",
            });
            continue;
        }
        config.skills[skill] = {
            ...(existing ?? {}),
            distribution: "snapshot",
            snapshot: {
                url: source.url,
                requested_ref: source.ref,
                skill_path: source.skillPath,
                integrity: local.integrity,
                ...(source.ref.length === 40 ? { resolved_commit: source.ref } : {}),
            },
        };
        entries.push({ skill, source: source.url, action: "linked" });
    }
    const nextConfigText = configText(parsePortableConfig(configText(config)));
    const payload = {
        kind: "git-source-migration",
        schemaVersion: 1,
        library,
        baseConfigHash: hashText(currentText),
        nextConfigText,
        entries,
    };
    return { ...payload, planId: computePlanId(payload) };
}
/** Writes only the exact reviewed migration and refuses a concurrently changed config. */
export async function applyGitSourceMigration(plan) {
    const { planId, ...payload } = plan;
    if (computePlanId(payload) !== planId)
        throw new Error("Git source migration plan is stale or modified");
    const destination = path.join(plan.library, DOTAGENTS_CONFIG_FILE);
    const currentText = await readFile(destination, "utf8");
    if (hashText(currentText) !== plan.baseConfigHash)
        throw new Error("dotagents.yaml changed after this source migration was reviewed");
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, plan.nextConfigText, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
}
//# sourceMappingURL=source-migration.js.map