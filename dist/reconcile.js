import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { planSkillExport } from "./export-policy.js";
import { removeOperationHistory, writeOperationHistory } from "./history.js";
import { isMachineLocalMetadataPath, normalizePortablePath } from "./paths.js";
import { computePlanId } from "./plan.js";
/** Pure three-way classification. It never chooses an overwrite for unknown local state. */
export function classifyThreeWaySkill(id, baseSha256, localSha256, remoteSha256, keptRemoteSha256) {
    if (keptRemoteSha256 && localSha256 !== remoteSha256) {
        return {
            id,
            baseSha256,
            localSha256,
            remoteSha256,
            action: keptRemoteSha256 === remoteSha256 ? "kept-local" : "conflict",
        };
    }
    if (baseSha256 === null) {
        const action = localSha256 === null ? "take-remote" : localSha256 === remoteSha256 ? "unchanged" : "unmanaged";
        return { id, baseSha256, localSha256, remoteSha256, action };
    }
    const localChanged = localSha256 !== baseSha256;
    const remoteChanged = remoteSha256 !== baseSha256;
    let action;
    if (!localChanged && !remoteChanged)
        action = "unchanged";
    else if (!localChanged && remoteChanged)
        action = "take-remote";
    else if (localChanged && !remoteChanged)
        action = "publish-local";
    else if (localSha256 === remoteSha256)
        action = "unchanged";
    else
        action = "conflict";
    return { id, baseSha256, localSha256, remoteSha256, action };
}
export const LIBRARY_RECONCILIATION_JOURNAL_VERSION = 1;
function withinRoot(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
function assertPortableSkillPath(value) {
    const normalized = normalizePortablePath(value);
    if (!normalized || normalized !== value.replaceAll("\\", "/")) {
        throw new Error(`Reconciliation source path is not portable: ${value}`);
    }
    return normalized;
}
function sha256File(filePath) {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
/**
 * A skill may be represented by a normal directory whose SKILL.md or another
 * file is a local link.  Do not let an export error erase that distinction:
 * links are a deliberate device-local composition and must never be followed
 * or overwritten implicitly.
 */
function linkedPathsInSkill(root) {
    const links = [];
    const visit = (directory) => {
        for (const name of readdirSync(directory).sort()) {
            const entryPath = path.join(directory, name);
            const relativePath = path.relative(root, entryPath).replaceAll(path.sep, "/");
            if (isMachineLocalMetadataPath(relativePath) || name === ".git" || name === "node_modules")
                continue;
            const metadata = lstatSync(entryPath);
            if (metadata.isSymbolicLink()) {
                links.push(relativePath);
                continue;
            }
            if (metadata.isDirectory())
                visit(entryPath);
        }
    };
    visit(root);
    return links;
}
function targetSnapshot(skill, target) {
    if (!existsSync(target))
        return { kind: "absent" };
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink())
        return { kind: "symlink", linkTarget: readlinkSync(target) };
    if (metadata.isFile())
        return { kind: "file", sha256: sha256File(target) };
    if (!metadata.isDirectory())
        return { kind: "unsupported", description: "unsupported filesystem entry" };
    const linkedPaths = linkedPathsInSkill(target);
    if (linkedPaths.length > 0)
        return { kind: "linked-directory", linkedPaths };
    try {
        return { kind: "directory", integrity: planSkillExport(skill, target).sha256 };
    }
    catch (error) {
        return {
            kind: "unsupported",
            description: error instanceof Error ? error.message : "directory cannot be reviewed safely",
        };
    }
}
function classifyReconciliationOperation(skill, snapshot, remoteIntegrity, base) {
    if (snapshot.kind === "absent") {
        if (base?.baseIntegrity) {
            if (base.keptRemoteIntegrity === remoteIntegrity) {
                return {
                    action: "kept-local",
                    localIntegrity: null,
                    reason: "This skill is intentionally absent on this device",
                };
            }
            return {
                action: "conflict",
                localIntegrity: null,
                reason: "A previously managed local skill is missing; deletion is never published automatically",
            };
        }
        return { action: "take-remote", localIntegrity: null };
    }
    if (snapshot.kind !== "directory") {
        // A machine may intentionally materialize a shared skill through a link.
        // We must never follow or overwrite that link implicitly, but a library
        // revision that is unchanged since the recorded base needs no decision.
        // If the remote changes later, this still falls through to a conflict so
        // the user explicitly chooses whether to replace the link.
        if (snapshot.kind === "symlink" && base?.baseIntegrity === remoteIntegrity) {
            return {
                action: "unchanged",
                localIntegrity: null,
                reason: "This skill is linked locally; the saved library version has not changed",
            };
        }
        if (snapshot.kind === "linked-directory" && base?.baseIntegrity === remoteIntegrity) {
            return {
                action: "unchanged",
                localIntegrity: null,
                reason: "This skill has linked local files; the saved library version has not changed",
            };
        }
        if (base?.baseIntegrity && base.keptRemoteIntegrity === remoteIntegrity) {
            return {
                action: "kept-local",
                localIntegrity: null,
                reason: "This local item is intentionally left untouched on this device",
            };
        }
        return {
            action: "conflict",
            localIntegrity: null,
            reason: snapshot.kind === "unsupported"
                ? snapshot.description
                : snapshot.kind === "linked-directory"
                    ? `The local skill contains linked file${snapshot.linkedPaths.length === 1 ? "" : "s"}: ${snapshot.linkedPaths.join(", ")}`
                    : `The local target is a ${snapshot.kind}, not a reviewed skill directory`,
        };
    }
    const classified = classifyThreeWaySkill(skill, base?.baseIntegrity ?? null, snapshot.integrity, remoteIntegrity, base?.keptRemoteIntegrity);
    return { action: classified.action, localIntegrity: snapshot.integrity };
}
/**
 * Builds one deterministic, no-write three-way plan for a portable library and
 * a machine's canonical skills root. Sources are integrity checked and links
 * escaping the reviewed source root are rejected.
 */
export function planLibraryReconciliation(input) {
    const sourceRoot = realpathSync(input.sourceRoot);
    const targetRoot = path.resolve(input.targetRoot);
    const seen = new Set();
    const operations = [];
    const secretFindings = [];
    for (const skill of [...input.skills].sort((left, right) => left.id.localeCompare(right.id, "en"))) {
        if (seen.has(skill.id))
            throw new Error(`Duplicate reconciliation skill: ${skill.id}`);
        seen.add(skill.id);
        const portablePath = assertPortableSkillPath(skill.path);
        const candidate = path.resolve(sourceRoot, ...portablePath.split("/"));
        if (!withinRoot(sourceRoot, candidate))
            throw new Error(`Reconciliation source escapes its root: ${skill.path}`);
        const source = realpathSync(candidate);
        if (!withinRoot(sourceRoot, source))
            throw new Error(`Reconciliation source link escapes its root: ${skill.path}`);
        const remote = planSkillExport(skill.id, source);
        if (remote.sha256 !== skill.integrity)
            throw new Error(`Reconciliation source integrity mismatch: ${skill.id}`);
        secretFindings.push(...remote.secretFindings.map((finding) => ({ ...finding, skill: skill.id })));
        const target = path.join(targetRoot, skill.id);
        const expectedTarget = targetSnapshot(skill.id, target);
        const classified = classifyReconciliationOperation(skill.id, expectedTarget, remote.sha256, input.base?.[skill.id]);
        operations.push({
            skill: skill.id,
            source: remote.sourcePath,
            target,
            remoteIntegrity: remote.sha256,
            localIntegrity: classified.localIntegrity,
            baseIntegrity: input.base?.[skill.id]?.baseIntegrity ?? null,
            keptRemoteIntegrity: input.base?.[skill.id]?.keptRemoteIntegrity ?? null,
            expectedTarget,
            action: classified.action,
            ...(classified.reason ? { reason: classified.reason } : {}),
        });
    }
    const payload = {
        kind: "library-reconcile",
        schemaVersion: 1,
        sourceRoot,
        targetRoot,
        operations,
        secretFindings,
        hasConflicts: operations.some((operation) => operation.action === "conflict" || operation.action === "unmanaged"),
    };
    return { ...payload, planId: computePlanId(payload) };
}
function defaultJournalPath(plan) {
    return path.join(path.dirname(plan.targetRoot), ".dotagents", "reconcile-journal.json");
}
function writeJournal(filePath, journal) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, filePath);
}
function assertTargetSnapshot(operation) {
    const current = targetSnapshot(operation.skill, operation.target);
    if (JSON.stringify(current) !== JSON.stringify(operation.expectedTarget)) {
        throw new Error(`Local skill changed after review: ${operation.skill}`);
    }
}
function assertRemoteSource(operation) {
    const current = planSkillExport(operation.skill, operation.source);
    if (current.sha256 !== operation.remoteIntegrity) {
        throw new Error(`Remote skill changed after review: ${operation.skill}`);
    }
    if (current.secretFindings.length > 0) {
        throw new Error(`Remote skill now contains possible secrets: ${operation.skill}`);
    }
    return current;
}
function copyExportPlan(plan, destination) {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(path.dirname(destination), { recursive: true });
    mkdirSync(destination, { recursive: false });
    for (const file of plan.files) {
        const source = path.join(plan.sourcePath, ...file.relativePath.split("/"));
        const content = readFileSync(source);
        if (createHash("sha256").update(content).digest("hex") !== file.sha256) {
            throw new Error(`Remote file changed during reconciliation: ${plan.skill}/${file.relativePath}`);
        }
        const target = path.join(destination, ...file.relativePath.split("/"));
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content, { flag: "wx" });
    }
    if (planSkillExport(plan.skill, destination).sha256 !== plan.sha256) {
        throw new Error(`Staged reconciliation content changed: ${plan.skill}`);
    }
}
function targetMatchesRemote(entry) {
    try {
        return planSkillExport(entry.operation.skill, entry.operation.target).sha256 === entry.operation.remoteIntegrity;
    }
    catch {
        return false;
    }
}
function rollbackReconciliation(filePath, journal) {
    journal.phase = "rolling-back";
    writeJournal(filePath, journal);
    for (const entry of [...journal.entries].reverse()) {
        rmSync(entry.stagePath, { recursive: true, force: true });
        if (!["backing-up", "backed-up", "committing", "applied"].includes(entry.status))
            continue;
        if (entry.hadPrevious) {
            if (!existsSync(entry.backupPath)) {
                if (entry.status === "backing-up" && existsSync(entry.operation.target))
                    continue;
                throw new Error(`Reconciliation backup is missing: ${entry.operation.skill}`);
            }
            if (existsSync(entry.operation.target)) {
                if (!targetMatchesRemote(entry)) {
                    throw new Error(`Local skill changed after an interrupted reconciliation: ${entry.operation.skill}`);
                }
                rmSync(entry.operation.target, { recursive: true, force: true });
            }
            mkdirSync(path.dirname(entry.operation.target), { recursive: true });
            renameSync(entry.backupPath, entry.operation.target);
        }
        else if (existsSync(entry.operation.target)) {
            if (!targetMatchesRemote(entry)) {
                throw new Error(`Local skill changed after an interrupted reconciliation: ${entry.operation.skill}`);
            }
            rmSync(entry.operation.target, { recursive: true, force: true });
        }
    }
    if (journal.history)
        removeOperationHistory(journal.history.root, journal.history.id);
    rmSync(filePath, { force: true });
}
export function hasLibraryReconciliationRecovery(journalPath) {
    return existsSync(journalPath);
}
/** Rolls back an interrupted apply without deleting content changed after the interruption. */
export function recoverLibraryReconciliation(journalPath) {
    if (!existsSync(journalPath))
        return false;
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    if (journal.kind !== "library-reconcile" || journal.schemaVersion !== LIBRARY_RECONCILIATION_JOURNAL_VERSION) {
        throw new Error("Unsupported library reconciliation journal");
    }
    if (journal.phase === "completed") {
        for (const entry of journal.entries) {
            rmSync(entry.stagePath, { recursive: true, force: true });
            rmSync(entry.backupPath, { recursive: true, force: true });
        }
        rmSync(journalPath, { force: true });
        return true;
    }
    rollbackReconciliation(journalPath, journal);
    return true;
}
/**
 * Applies only explicit take-remote decisions. Conflicts and unmanaged local
 * targets therefore require a decision at the CLI/UI seam before this module
 * can replace them.
 */
export function applyLibraryReconciliationPlan(plan, decisions, options = {}) {
    const { planId, ...payload } = plan;
    if (computePlanId(payload) !== planId)
        throw new Error("Library reconciliation plan is stale or modified");
    if (plan.secretFindings.length > 0) {
        throw new Error(`Library reconciliation is blocked by ${plan.secretFindings.length} possible secret finding(s)`);
    }
    const bySkill = new Map(plan.operations.map((operation) => [operation.skill, operation]));
    const selected = new Set();
    for (const decision of decisions) {
        if (decision.action !== "take-remote")
            throw new Error(`Unsupported reconciliation decision for ${decision.skill}`);
        if (selected.has(decision.skill))
            throw new Error(`Duplicate reconciliation decision: ${decision.skill}`);
        selected.add(decision.skill);
        const operation = bySkill.get(decision.skill);
        if (!operation)
            throw new Error(`Skill is not present in the reconciliation plan: ${decision.skill}`);
        if (operation.action === "unchanged") {
            throw new Error(`Remote skill does not need applying: ${decision.skill}`);
        }
        if (operation.expectedTarget.kind === "unsupported" || operation.expectedTarget.kind === "linked-directory") {
            throw new Error(`Local target cannot be replaced safely: ${decision.skill}. ${operation.expectedTarget.kind === "linked-directory" ? `It contains linked file${operation.expectedTarget.linkedPaths.length === 1 ? "" : "s"}: ${operation.expectedTarget.linkedPaths.join(", ")}` : operation.expectedTarget.description}`);
        }
    }
    const operations = plan.operations.filter((operation) => selected.has(operation.skill));
    if (operations.length === 0)
        return { planId, restored: [] };
    const journalPath = options.journalPath ?? defaultJournalPath(plan);
    if (existsSync(journalPath))
        throw new Error("An unfinished library reconciliation requires recovery first");
    for (const operation of operations) {
        assertRemoteSource(operation);
        assertTargetSnapshot(operation);
    }
    const nonce = randomUUID();
    const journal = {
        kind: "library-reconcile",
        schemaVersion: LIBRARY_RECONCILIATION_JOURNAL_VERSION,
        planId,
        phase: "applying",
        entries: operations.map((operation) => ({
            operation,
            stagePath: `${operation.target}.dotagents-stage-${nonce}`,
            backupPath: `${operation.target}.dotagents-backup-${nonce}`,
            hadPrevious: operation.expectedTarget.kind !== "absent",
            status: "pending",
        })),
    };
    writeJournal(journalPath, journal);
    try {
        for (const [index, entry] of journal.entries.entries()) {
            options.beforeOperation?.(entry.operation, index);
            copyExportPlan(assertRemoteSource(entry.operation), entry.stagePath);
            entry.status = "staged";
            writeJournal(journalPath, journal);
            assertTargetSnapshot(entry.operation);
            mkdirSync(path.dirname(entry.operation.target), { recursive: true });
            if (entry.hadPrevious) {
                entry.status = "backing-up";
                writeJournal(journalPath, journal);
                renameSync(entry.operation.target, entry.backupPath);
                entry.status = "backed-up";
                writeJournal(journalPath, journal);
            }
            entry.status = "committing";
            writeJournal(journalPath, journal);
            renameSync(entry.stagePath, entry.operation.target);
            entry.status = "applied";
            writeJournal(journalPath, journal);
        }
        let historyId;
        if (options.historyRoot) {
            historyId = `reconcile-${nonce}`;
            journal.history = { root: path.resolve(options.historyRoot), id: historyId };
            writeJournal(journalPath, journal);
            writeOperationHistory(journal.history.root, {
                operation: options.historyOperation ?? "restore-library-skills",
                sourcePlanId: planId,
                recordId: historyId,
                targetRoot: plan.targetRoot,
                changes: journal.entries.map((entry) => ({
                    path: entry.operation.skill,
                    itemKind: "skill",
                    skill: entry.operation.skill,
                    postcondition: { kind: "directory", integrity: entry.operation.remoteIntegrity },
                    ...(entry.hadPrevious && entry.operation.expectedTarget.kind === "directory"
                        ? { previousPath: entry.backupPath }
                        : entry.hadPrevious
                            ? { previousUnavailableReason: "unsupported-previous-target" }
                            : {}),
                })),
            });
        }
        journal.phase = "completed";
        writeJournal(journalPath, journal);
        for (const entry of journal.entries) {
            rmSync(entry.stagePath, { recursive: true, force: true });
            rmSync(entry.backupPath, { recursive: true, force: true });
        }
        rmSync(journalPath, { force: true });
        return { planId, restored: operations.map((operation) => operation.skill), ...(historyId ? { historyId } : {}) };
    }
    catch (error) {
        rollbackReconciliation(journalPath, journal);
        throw error;
    }
}
//# sourceMappingURL=reconcile.js.map