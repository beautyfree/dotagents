import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import { computePlanId } from "./plan.js";
function packageName(input) {
    const normalized = input
        .trim()
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    if (!normalized || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized))
        throw new Error("Library name must contain letters or numbers");
    return normalized;
}
export function planInitializeLibrary(root, requestedName = path.basename(root)) {
    const absoluteRoot = path.resolve(root);
    const name = packageName(requestedName);
    const files = [
        {
            path: "skills.json",
            content: `${JSON.stringify({ schema_version: 1, name, version: "0.1.0", skills: [], dependencies: {} }, null, 2)}\n`,
        },
        {
            path: "dotagents.yaml",
            content: "schema_version: 1\ndefaults:\n  include: all\nskills: {}\n",
        },
        {
            path: ".gitignore",
            content: "dotagents.local.yaml\n.dotagents/\n.DS_Store\nThumbs.db\ndesktop.ini\n",
        },
        {
            path: "README.md",
            content: `# ${name}\n\nA portable agent skill library managed by [beautyfree/dotagents](https://github.com/beautyfree/dotagents).\n`,
        },
    ];
    const payload = { kind: "initialize-library", schemaVersion: 1, root: absoluteRoot, files };
    return { ...payload, planId: computePlanId(payload) };
}
async function exists(filePath) {
    try {
        await stat(filePath);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
}
/** Applies only the exact reviewed plan and refuses to overwrite any target file. */
export async function applyInitializeLibraryPlan(plan) {
    const { planId, ...payload } = plan;
    if (computePlanId(payload) !== planId)
        throw new Error("Initialize plan is stale or modified");
    for (const file of plan.files) {
        if (await exists(path.join(plan.root, file.path)))
            throw new Error(`Refusing to overwrite ${file.path}`);
    }
    await mkdir(path.join(plan.root, "skills"), { recursive: true });
    await mkdir(path.join(plan.root, ".dotagents"), { recursive: true });
    for (const file of plan.files) {
        const destination = path.join(plan.root, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        const handle = await open(destination, "wx");
        try {
            await handle.writeFile(file.content, "utf8");
        }
        finally {
            await handle.close();
        }
    }
}
//# sourceMappingURL=init.js.map