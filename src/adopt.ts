import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { type SecretFinding, scanTextForSecrets } from "./audit.js";
import { loadLibrary } from "./library.js";
import {
  type ApplyLibraryUpdateResult,
  applyLibraryUpdatePlan,
  type LibraryUpdatePlan,
  planLibraryUpdate,
} from "./library-update.js";
import { normalizePortablePath } from "./paths.js";
import { computePlanId } from "./plan.js";
import { type ResourceDescriptor, type ResourceManifest, resourceManifestSchema } from "./resource-model.js";
import { SCOPE_DESCRIPTOR_FILE } from "./scope.js";

export const RESOURCE_MANIFEST_FILE = "resources.json";
const MAX_ADOPTED_FILE_BYTES = 1024 * 1024;
const RESERVED_ROOTS = new Set([
  ".dotagents",
  "dotagents.yaml",
  "dotagents.local.yaml",
  SCOPE_DESCRIPTOR_FILE,
  "skills.lock",
  "skills.json",
  RESOURCE_MANIFEST_FILE,
]);

export type AdoptVisibility = "private" | "team" | "public";

export interface AdoptResourceInput {
  libraryRoot: string;
  sourcePath: string;
  descriptor: ResourceDescriptor;
  visibility: AdoptVisibility;
}

export interface AdoptResourcePlan {
  kind: "resource-adopt";
  schemaVersion: 1;
  planId: string;
  library: string;
  source: {
    path: string;
    integrity: string;
    files: number;
    bytes: number;
  };
  resource: ResourceDescriptor;
  licenseReview: {
    visibility: AdoptVisibility;
    libraryLicense: string | null;
    status: "private-only" | "reviewed" | "blocked";
  };
  secretFindings: (SecretFinding & { relativePath: string })[];
  blockers: { code: "collision" | "license-review" | "secret" | "target-exists"; message: string }[];
  libraryUpdate: LibraryUpdatePlan;
}

function portableResourcePath(value: string): string {
  const normalized = normalizePortablePath(value);
  const root = normalized?.split("/")[0];
  if (!normalized || normalized !== value || value.includes("\\") || !root || RESERVED_ROOTS.has(root)) {
    throw new Error(`Adopt target must be a non-reserved portable library path: ${value}`);
  }
  return normalized;
}

function readResourceManifest(library: string): ResourceManifest {
  const manifestPath = path.join(library, RESOURCE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return { schema_version: 2, resources: [] };
  const metadata = lstatSync(manifestPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_ADOPTED_FILE_BYTES) {
    throw new Error("The resource manifest must be a bounded regular file");
  }
  return resourceManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
}

function inspectFile(sourcePath: string): {
  content: string;
  integrity: string;
  files: number;
  bytes: number;
  findings: (SecretFinding & { relativePath: string })[];
} {
  const metadata = lstatSync(sourcePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("Adopt source must be a regular file");
  if (metadata.size > MAX_ADOPTED_FILE_BYTES) throw new Error("Adopt source exceeds the safe file size limit");
  const bytes = readFileSync(sourcePath);
  if (bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) {
    throw new Error("Adopt source must be a textual resource");
  }
  const content = bytes.toString("utf8");
  return {
    content,
    integrity: createHash("sha256").update(bytes).digest("hex"),
    files: 1,
    bytes: bytes.length,
    findings: scanTextForSecrets(content).map((finding) => ({ ...finding, relativePath: path.basename(sourcePath) })),
  };
}

/**
 * Reviews one explicitly selected unmanaged native resource before copying it
 * into the canonical library. This function never writes or executes content.
 */
export async function planResourceAdoption(input: AdoptResourceInput): Promise<AdoptResourcePlan> {
  const library = path.resolve(input.libraryRoot);
  const sourcePath = path.resolve(input.sourcePath);
  const descriptor = resourceManifestSchema.parse({
    schema_version: 2,
    resources: [{ ...input.descriptor, path: portableResourcePath(input.descriptor.path) }],
  }).resources[0];
  if (!descriptor) throw new Error("Adopt requires exactly one resource descriptor");
  const loaded = await loadLibrary(library);
  if (!loaded.ok) throw new Error("Cannot adopt into an invalid dotagents library");
  const current = readResourceManifest(library);
  const key = `${descriptor.kind}:${descriptor.id}`;
  const collides = current.resources.some(
    (entry) => `${entry.kind}:${entry.id}` === key || entry.path === descriptor.path,
  );
  const next = resourceManifestSchema.parse({
    schema_version: 2,
    resources: collides
      ? current.resources
      : [...current.resources, descriptor].sort((left, right) =>
          `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`, "en"),
        ),
  });
  const resourceManifestText = `${JSON.stringify(next, null, 2)}\n`;
  let source: AdoptResourcePlan["source"];
  let secretFindings: AdoptResourcePlan["secretFindings"];
  let portableFiles: Record<string, string>;
  let skills: Parameters<typeof planLibraryUpdate>[0]["skills"];
  if (descriptor.kind === "skill") {
    const update = planLibraryUpdate({
      root: library,
      skills: [{ skill: descriptor.id, path: descriptor.path, sourcePath }],
      portableFiles: { [RESOURCE_MANIFEST_FILE]: resourceManifestText },
    });
    const skillOperation = update.operations.find((operation) => operation.kind === "skill");
    if (skillOperation?.kind !== "skill") throw new Error("Skill adoption could not be reviewed");
    source = {
      path: sourcePath,
      integrity: skillOperation.sourcePlan.sha256,
      files: skillOperation.sourcePlan.files.length,
      bytes: skillOperation.sourcePlan.files.reduce((sum, file) => sum + file.size, 0),
    };
    secretFindings = skillOperation.sourcePlan.secretFindings;
    portableFiles = { [RESOURCE_MANIFEST_FILE]: resourceManifestText };
    skills = [{ skill: descriptor.id, path: descriptor.path, sourcePath, integrity: skillOperation.sourcePlan.sha256 }];
  } else {
    const inspected = inspectFile(sourcePath);
    source = { path: sourcePath, integrity: inspected.integrity, files: inspected.files, bytes: inspected.bytes };
    secretFindings = inspected.findings;
    portableFiles = { [descriptor.path]: inspected.content, [RESOURCE_MANIFEST_FILE]: resourceManifestText };
    skills = [];
  }
  const libraryUpdate = planLibraryUpdate({ root: library, skills, portableFiles });
  const targetOperation = libraryUpdate.operations.find((operation) => operation.path === descriptor.path);
  const libraryLicense = loaded.value.manifest.license ?? null;
  const licenseReview = {
    visibility: input.visibility,
    libraryLicense,
    status: input.visibility === "private" ? "private-only" : libraryLicense ? "reviewed" : "blocked",
  } as const;
  const blockers: AdoptResourcePlan["blockers"] = [];
  if (collides)
    blockers.push({ code: "collision", message: `${key} or its portable path already exists in the library` });
  if (targetOperation?.expectedTarget.kind !== "absent") {
    blockers.push({ code: "target-exists", message: "The canonical target already contains content" });
  }
  if (licenseReview.status === "blocked") {
    blockers.push({ code: "license-review", message: "Choose a library license before adopting content for sharing" });
  }
  if (secretFindings.length > 0) {
    blockers.push({
      code: "secret",
      message: `Remove ${secretFindings.length} possible secret finding(s) before adoption`,
    });
  }
  const payload = {
    kind: "resource-adopt" as const,
    schemaVersion: 1 as const,
    library,
    source,
    resource: descriptor,
    licenseReview,
    secretFindings,
    blockers,
    libraryUpdate,
  };
  return { ...payload, planId: computePlanId(payload) };
}

/** Applies only an unchanged, blocker-free adoption as one library transaction. */
export async function applyResourceAdoption(
  plan: AdoptResourcePlan,
  expectedPlanId: string,
): Promise<ApplyLibraryUpdateResult> {
  const { planId, ...payload } = plan;
  if (expectedPlanId !== planId || computePlanId(payload) !== planId) {
    throw new Error("Resource adoption plan is stale or modified");
  }
  if (plan.blockers.length > 0) throw new Error("Resource adoption plan contains blockers");
  const refreshed = await planResourceAdoption({
    libraryRoot: plan.library,
    sourcePath: plan.source.path,
    descriptor: plan.resource,
    visibility: plan.licenseReview.visibility,
  });
  if (refreshed.planId !== plan.planId) throw new Error("Resource adoption input changed after review");
  const portableFiles: Record<string, string> = {
    [RESOURCE_MANIFEST_FILE]: `${JSON.stringify(
      resourceManifestSchema.parse({
        schema_version: 2,
        resources: [...readResourceManifest(plan.library).resources, plan.resource].sort((left, right) =>
          `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`, "en"),
        ),
      }),
      null,
      2,
    )}\n`,
  };
  if (plan.resource.kind !== "skill") portableFiles[plan.resource.path] = inspectFile(plan.source.path).content;
  return applyLibraryUpdatePlan(plan.libraryUpdate, { portableFiles, historyOperation: "resource-adopt" });
}
