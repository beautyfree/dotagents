import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { parsePortableConfig, portableConfigSchema } from "./config.js";
import { computePlanId } from "./plan.js";
import { libraryManifestSchema } from "./schema.js";
/**
 * Plans removal of one bundled skill from a canonical dotagents library.
 *
 * It intentionally does not touch the user's local installation: removing a
 * skill from a portable library is a Git-backed publication decision, not an
 * uninstall. The caller applies the returned portable files and removed path
 * transactionally, then commits and pushes them using its own transport.
 */
export function planCanonicalLibraryRemoval(root, skillId) {
    const id = skillId.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
        throw new Error("Invalid skill id");
    const manifestPath = path.join(root, "skills.json");
    const parsed = libraryManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (!parsed.success)
        throw new Error("Canonical library manifest is invalid");
    const removedPath = parsed.data.skills.find((candidate) => path.posix.basename(candidate) === id);
    if (!removedPath)
        throw new Error("This skill is no longer in the library. Refresh and try again.");
    const configPath = path.join(root, "dotagents.yaml");
    const config = existsSync(configPath)
        ? parsePortableConfig(readFileSync(configPath, "utf8"))
        : portableConfigSchema.parse({ schema_version: 1 });
    const nextConfig = {
        ...config,
        skills: Object.fromEntries(Object.entries(config.skills).filter(([name]) => name !== id)),
    };
    const manifest = libraryManifestSchema.parse({
        ...parsed.data,
        skills: parsed.data.skills.filter((candidate) => candidate !== removedPath),
    });
    const portableFiles = {
        "skills.json": `${JSON.stringify(manifest, null, 2)}\n`,
        "dotagents.yaml": stringify(portableConfigSchema.parse(nextConfig), { lineWidth: 100 }),
    };
    const payload = {
        kind: "canonical-library-removal",
        schemaVersion: 1,
        skillId: id,
        removedPath,
        manifest,
        portableFiles,
    };
    return { ...payload, planId: computePlanId(payload) };
}
//# sourceMappingURL=library-removal.js.map