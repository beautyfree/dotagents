import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deviceProfilePath,
  loadDeviceProfile,
  loadDeviceProfileStore,
  saveDeviceProfile,
  selectDeviceProfile,
} from "../src/device-profile.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("device profile", () => {
  it("stores multiple local machine connections without credentials and remembers the selected one", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dotagents-profile-"));
    roots.push(root);
    const file = deviceProfilePath({ XDG_CONFIG_HOME: root }, root);
    const personal = await saveDeviceProfile(
      {
        library: path.join(root, "library"),
        remote: "git@github.com:team/library.git",
        provider: "github",
        provider_account: "alex",
        label: "Personal",
      },
      file,
    );
    const work = await saveDeviceProfile(
      {
        library: path.join(root, "work"),
        remote: "git@gitlab.example:team/library.git",
        provider: "gitlab",
        label: "Work",
      },
      file,
    );
    expect(existsSync(file)).toBe(true);
    await expect(loadDeviceProfile(file)).resolves.toMatchObject({
      id: work.id,
      library: path.join(root, "work"),
      provider: "gitlab",
      label: "Work",
      remote: "https://gitlab.example/team/library",
    });
    await selectDeviceProfile(personal.id, file);
    await expect(loadDeviceProfile(file)).resolves.toMatchObject({
      id: personal.id,
      library: path.join(root, "library"),
      provider: "github",
      provider_account: "alex",
      label: "Personal",
      remote: "https://github.com/team/library",
    });
    await expect(loadDeviceProfileStore(file)).resolves.toMatchObject({
      active_connection_id: personal.id,
      connections: [expect.anything(), expect.anything()],
    });
  });

  it("uses the appropriate native config location on every supported platform", () => {
    expect(deviceProfilePath({}, "/Users/alex", "darwin")).toBe(
      "/Users/alex/Library/Application Support/dotagents/connections.json",
    );
    expect(deviceProfilePath({ APPDATA: "C:\\Users\\Alex\\AppData\\Roaming" }, "C:\\Users\\Alex", "win32")).toBe(
      "C:\\Users\\Alex\\AppData\\Roaming\\dotagents\\connections.json",
    );
    expect(deviceProfilePath({}, "C:\\Users\\Alex", "win32")).toBe(
      "C:\\Users\\Alex\\AppData\\Roaming\\dotagents\\connections.json",
    );
    expect(deviceProfilePath({}, "/home/alex", "linux")).toBe("/home/alex/.config/dotagents/connections.json");
  });
});
