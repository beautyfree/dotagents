import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { libraryLockSchema, libraryManifestSchema } from "../dist/schema.js";
import { portableConfigSchema } from "../dist/config.js";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputDirectory = path.join(root, "schemas");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") throw new Error("Use --write or --check");

const contracts = [
  ["skills.schema.json", libraryManifestSchema, "DotagentsSkillsManifest"],
  ["skills-lock.schema.json", libraryLockSchema, "DotagentsSkillsLock"],
  ["dotagents.schema.json", portableConfigSchema, "DotagentsPortableConfig"],
];

await mkdir(outputDirectory, { recursive: true });
for (const [filename, schema, name] of contracts) {
  const jsonSchema = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "root",
    errorMessages: true,
  });
  const content = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  const destination = path.join(outputDirectory, filename);
  if (mode === "--write") {
    await writeFile(destination, content, "utf8");
    continue;
  }
  let current = "";
  try {
    current = await readFile(destination, "utf8");
  } catch {
    throw new Error(`${filename} is missing; run bun run schema:generate`);
  }
  if (current !== content) throw new Error(`${filename} is stale; run bun run schema:generate`);
}

process.stdout.write(`${mode === "--write" ? "Generated" : "Verified"} ${contracts.length} JSON Schemas.\n`);
