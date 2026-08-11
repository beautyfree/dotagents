import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeGitIdentity } from "./git-identity.js";
import { providerKindSchema } from "./providers.js";
const connectionSchema = z
    .object({
    id: z.string().uuid(),
    label: z.string().trim().min(1).max(80),
    provider: providerKindSchema,
    provider_account: z.string().trim().min(1).max(200).nullable().default(null),
    remote: z.string().min(1),
    library: z.string().min(1),
    created_at: z.string().datetime(),
    last_used_at: z.string().datetime(),
})
    .strict();
const storeSchema = z
    .object({
    schema_version: z.literal(1),
    active_connection_id: z.string().uuid().nullable(),
    connections: z.array(connectionSchema),
})
    .strict()
    .superRefine((value, context) => {
    const ids = new Set(value.connections.map((connection) => connection.id));
    if (ids.size !== value.connections.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Connection IDs must be unique" });
    if (value.active_connection_id && !ids.has(value.active_connection_id))
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Active connection must exist" });
});
export function deviceProfilePath(environment = process.env, home = homedir(), platform = process.platform) {
    // `platform` is injectable for cross-platform callers and tests. Do not let
    // the host running the code rewrite a Windows or POSIX configuration path.
    const paths = platform === "win32" ? path.win32 : path.posix;
    if (environment.DOTAGENTS_CONFIG_HOME)
        return paths.join(environment.DOTAGENTS_CONFIG_HOME, "connections.json");
    if (environment.XDG_CONFIG_HOME)
        return paths.join(environment.XDG_CONFIG_HOME, "dotagents", "connections.json");
    if (platform === "win32")
        return paths.join(environment.APPDATA ?? paths.join(home, "AppData", "Roaming"), "dotagents", "connections.json");
    if (platform === "darwin")
        return paths.join(home, "Library", "Application Support", "dotagents", "connections.json");
    return paths.join(home, ".config", "dotagents", "connections.json");
}
function cleanConnection(value) {
    const now = new Date().toISOString();
    return connectionSchema.parse({
        ...value,
        id: value.id ?? randomUUID(),
        library: path.resolve(value.library),
        remote: normalizeGitIdentity(value.remote),
        created_at: value.created_at ?? now,
        last_used_at: value.last_used_at ?? now,
    });
}
export async function loadDeviceProfileStore(file = deviceProfilePath()) {
    try {
        return storeSchema.parse(JSON.parse(await readFile(file, "utf8")));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { schema_version: 1, active_connection_id: null, connections: [] };
        throw error;
    }
}
async function saveStore(store, file = deviceProfilePath()) {
    const checked = storeSchema.parse(store);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, file);
}
/** Adds or updates a local machine connection. Credentials are never stored here. */
export async function saveDeviceProfile(profile, file = deviceProfilePath()) {
    const store = await loadDeviceProfileStore(file);
    const next = cleanConnection(profile);
    const matching = store.connections.findIndex((connection) => connection.remote === next.remote && connection.library === next.library);
    const existing = matching >= 0 ? store.connections[matching] : undefined;
    const connection = existing
        ? cleanConnection({
            ...next,
            id: existing.id,
            created_at: existing.created_at,
            last_used_at: new Date().toISOString(),
        })
        : next;
    const connections = existing
        ? store.connections.map((entry) => (entry.id === connection.id ? connection : entry))
        : [...store.connections, connection];
    await saveStore({ schema_version: 1, active_connection_id: connection.id, connections }, file);
    return connection;
}
export async function loadDeviceProfile(file = deviceProfilePath()) {
    const store = await loadDeviceProfileStore(file);
    return store.connections.find((connection) => connection.id === store.active_connection_id) ?? null;
}
export async function selectDeviceProfile(id, file = deviceProfilePath()) {
    const store = await loadDeviceProfileStore(file);
    const selected = store.connections.find((connection) => connection.id === id);
    if (!selected)
        throw new Error("Saved dotagents library was not found");
    const connection = cleanConnection({ ...selected, last_used_at: new Date().toISOString() });
    await saveStore({
        ...store,
        active_connection_id: connection.id,
        connections: store.connections.map((entry) => (entry.id === connection.id ? connection : entry)),
    }, file);
    return connection;
}
export function providerFromRemote(remote) {
    const identity = normalizeGitIdentity(remote);
    const host = new URL(identity).hostname;
    if (host === "github.com")
        return "github";
    if (host === "gitlab.com")
        return "gitlab";
    return "generic";
}
//# sourceMappingURL=device-profile.js.map