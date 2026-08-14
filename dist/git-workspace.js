import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { auditLibrary, scanTextForSecrets } from "./audit.js";
import { normalizeGitIdentity } from "./git-identity.js";
import { loadLibrary } from "./library.js";
import { isMachineLocalMetadataPath, normalizePortablePath } from "./paths.js";
import { computePlanId } from "./plan.js";
import { parseSourceSecurityPolicy, requireMinimumReleaseAge, requireTrustedSource, } from "./source-policy.js";
const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = "main";
const GIT_NAME = "dotagents library";
const GIT_EMAIL = "library@dotagents.local";
export class NodeWorkspaceGitPort {
    environment;
    /**
     * Extra process environment for one host-controlled Git transport. It is
     * intentionally ephemeral: callers must never persist secrets in remotes or
     * repository config.
     */
    constructor(environment = {}) {
        this.environment = environment;
    }
    async run(args, cwd, options = {}) {
        const result = await execFileAsync("git", args, {
            cwd,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
            signal: options.signal,
            env: {
                ...process.env,
                ...this.environment,
                ...(options.nonInteractive ? { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" } : {}),
            },
        });
        // Porcelain `-z` records can legitimately start with a space (for example
        // " M file"). Trimming those records corrupts both the status and path.
        return options.raw ? result.stdout : result.stdout.trim();
    }
}
function withPlanId(payload) {
    return { ...payload, planId: computePlanId(payload) };
}
async function exists(filePath) {
    try {
        await lstat(filePath);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
}
async function ensureLibrary(root) {
    const resolved = path.resolve(root);
    const loaded = await loadLibrary(resolved);
    if (!loaded.ok)
        throw new Error(loaded.issues.map((issue) => issue.message).join("; "));
    return resolved;
}
async function gitHead(root, git) {
    try {
        return await git.run(["rev-parse", "--verify", "HEAD"], root);
    }
    catch {
        return null;
    }
}
async function gitBranch(root, git) {
    try {
        return await git.run(["symbolic-ref", "--short", "HEAD"], root);
    }
    catch {
        return DEFAULT_BRANCH;
    }
}
function parseChangedPaths(output) {
    if (!output)
        return [];
    const records = output.split("\0");
    const paths = new Set();
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (!record || record.length < 4)
            continue;
        const status = record.slice(0, 2);
        paths.add(record.slice(3).replaceAll("\\", "/"));
        const renamedPath = records[index + 1];
        if (/[RC]/.test(status) && renamedPath) {
            paths.add(renamedPath.replaceAll("\\", "/"));
            index += 1;
        }
    }
    return [...paths].sort((left, right) => left.localeCompare(right, "en"));
}
function parseNullPaths(output) {
    return output
        ? output
            .split("\0")
            .filter(Boolean)
            .map((entry) => entry.replaceAll("\\", "/"))
            .sort((left, right) => left.localeCompare(right, "en"))
        : [];
}
function isMachineLocalIgnoredPath(filePath) {
    const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
    return (isMachineLocalMetadataPath(normalized) ||
        normalized === "dotagents.local.yaml" ||
        normalized === ".dotagents" ||
        normalized.startsWith(".dotagents/"));
}
async function changedLibraryPaths(root, git) {
    const [status, ignored] = await Promise.all([
        git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root, {
            raw: true,
        }),
        git.run(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], root, { raw: true }),
    ]);
    return {
        // Device metadata and local configuration never form part of a portable
        // snapshot. Everything else is surfaced so a review cannot silently omit it.
        changed: parseChangedPaths(status).filter((filePath) => !isMachineLocalIgnoredPath(filePath)),
        ignored: parseNullPaths(ignored).filter((filePath) => !isMachineLocalIgnoredPath(filePath)),
    };
}
function portableGitPath(filePath) {
    const normalized = normalizePortablePath(filePath);
    if (!normalized)
        return null;
    const allowedFile = /^(?:skills\.json|skills\.lock|dotagents\.yaml|README(?:\.[^/]+)?|LICENSE(?:\.[^/]+)?|NOTICE(?:\.[^/]+)?|\.gitignore)$/i.test(normalized);
    const allowedTree = /^(?:skills|docs|assets|examples)\//.test(normalized);
    return allowedFile || allowedTree ? normalized : null;
}
function uniqueSecretFindings(findings) {
    return [
        ...new Map(findings.map((finding) => [`${finding.file}:${finding.rule}:${finding.line}:${finding.column}`, finding])).values(),
    ].sort((left, right) => `${left.file}:${left.line}:${left.column}`.localeCompare(`${right.file}:${right.line}:${right.column}`, "en"));
}
async function snapshotFiles(root, files) {
    const snapshots = [];
    const unsafePaths = [];
    const secretFindings = [];
    let totalBytes = 0;
    for (const input of files) {
        const portable = portableGitPath(input);
        if (!portable) {
            unsafePaths.push(input);
            continue;
        }
        const absolute = path.join(root, ...portable.split("/"));
        if (!(await exists(absolute))) {
            snapshots.push({ path: portable, hash: null });
            continue;
        }
        const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 10 * 1024 * 1024) {
            unsafePaths.push(portable);
            continue;
        }
        totalBytes += metadata.size;
        if (totalBytes > 100 * 1024 * 1024) {
            unsafePaths.push(portable);
            continue;
        }
        const content = await readFile(absolute);
        snapshots.push({
            path: portable,
            hash: createHash("sha256").update(content).digest("hex"),
        });
        if (!content.subarray(0, Math.min(content.length, 8_192)).includes(0)) {
            for (const finding of scanTextForSecrets(content.toString("utf8")))
                secretFindings.push({ file: portable, ...finding });
        }
    }
    return { snapshots, unsafePaths, secretFindings };
}
function auditErrors(report) {
    return report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => ({
        code: issue.code,
        message: issue.message,
        remediation: issue.remediation,
        ...(issue.field ? { field: issue.field } : {}),
    }));
}
function assertPlanId(plan) {
    const { planId, ...payload } = plan;
    if (computePlanId(payload) !== planId)
        throw new Error("Git plan is stale or modified");
}
/** Validates a portable Git remote without contacting it or reading credentials. */
export function credentialFreeGitRemote(remote) {
    const value = remote.trim();
    if (!value || /[\r\n\0]/.test(value))
        throw new Error("Git URL must be a single non-empty value");
    const identity = normalizeGitIdentity(value);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        const parsed = new URL(value.replace(/^git\+/, ""));
        if (parsed.search || parsed.hash)
            throw new Error("Git URL must not contain query parameters or fragments");
    }
    return { remote: value, identity };
}
function parseRemoteHead(output) {
    const lines = output.split(/\r?\n/).filter(Boolean);
    const symbolic = lines.find((line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"));
    const symbolicBranch = symbolic?.slice("ref: refs/heads/".length, -"\tHEAD".length);
    const advertised = new Map(lines.flatMap((line) => {
        const match = line.match(/^([a-f0-9]{40})\t(.+)$/i);
        const commit = match?.[1];
        const reference = match?.[2];
        return commit && reference ? [[reference, commit.toLowerCase()]] : [];
    }));
    const branch = symbolicBranch && (advertised.has("HEAD") || advertised.has(`refs/heads/${symbolicBranch}`))
        ? symbolicBranch
        : advertised.has("refs/heads/main")
            ? "main"
            : advertised.has("refs/heads/master")
                ? "master"
                : undefined;
    const commit = branch ? (advertised.get("HEAD") ?? advertised.get(`refs/heads/${branch}`)) : undefined;
    if (!branch || !commit)
        throw new Error("Git remote HEAD must advertise a default branch and immutable commit");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.endsWith("/")) {
        throw new Error("Git remote advertised an unsafe default branch");
    }
    return { branch, commit };
}
function validatedRequestedRef(input) {
    const requested = input.trim();
    if (!requested || /[\r\n\0]/.test(requested) || requested.startsWith("-")) {
        throw new Error("Git ref must be a safe non-empty branch, tag, or commit");
    }
    if (/^[a-f0-9]{40}$/i.test(requested))
        return requested.toLowerCase();
    if (requested.includes("..") ||
        requested.includes("@{") ||
        requested.includes("\\") ||
        requested.includes("//") ||
        requested.endsWith("/") ||
        requested.endsWith(".") ||
        /[\s~^:?*[\]]/.test(requested)) {
        throw new Error("Git ref contains unsafe or ambiguous characters");
    }
    const unqualified = requested.replace(/^refs\/(?:heads|tags)\//, "");
    if (!unqualified || unqualified.startsWith(".") || unqualified.endsWith(".lock")) {
        throw new Error("Git ref contains an unsafe branch or tag name");
    }
    if (requested.startsWith("refs/") && !/^refs\/(?:heads|tags)\//.test(requested)) {
        throw new Error("Only branch and tag refs can be reviewed for checkout");
    }
    return requested;
}
async function resolveRemoteCheckout(remote, requestedInput, git, signal) {
    const requestedRef = validatedRequestedRef(requestedInput);
    if (requestedRef === "HEAD") {
        const advertised = parseRemoteHead(await git.run(["ls-remote", "--symref", "--exit-code", "--", remote, "HEAD", "refs/heads/main", "refs/heads/master"], process.cwd(), { nonInteractive: true, raw: true, signal }));
        return {
            requestedRef,
            branch: advertised.branch,
            commit: advertised.commit,
        };
    }
    if (/^[a-f0-9]{40}$/.test(requestedRef)) {
        return { requestedRef, branch: null, commit: requestedRef };
    }
    const explicitBranch = requestedRef.startsWith("refs/heads/") ? requestedRef : null;
    const explicitTag = requestedRef.startsWith("refs/tags/") ? requestedRef : null;
    const branchRef = explicitBranch ?? (explicitTag ? null : `refs/heads/${requestedRef}`);
    const tagRef = explicitTag ?? (explicitBranch ? null : `refs/tags/${requestedRef}`);
    const patterns = [branchRef, tagRef, tagRef ? `${tagRef}^{}` : null].filter((value) => Boolean(value));
    const output = await git.run(["ls-remote", "--exit-code", "--", remote, ...patterns], process.cwd(), {
        nonInteractive: true,
        raw: true,
        signal,
    });
    const advertised = new Map(output.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([a-f0-9]{40})\t(.+)$/i);
        return match?.[1] && match[2] ? [[match[2], match[1].toLowerCase()]] : [];
    }));
    const branchCommit = branchRef ? advertised.get(branchRef) : undefined;
    const tagCommit = tagRef ? (advertised.get(`${tagRef}^{}`) ?? advertised.get(tagRef)) : undefined;
    if (branchCommit && tagCommit) {
        throw new Error(`Git ref ${requestedRef} is ambiguous because both a branch and tag exist`);
    }
    if (branchCommit && branchRef) {
        return {
            requestedRef,
            branch: branchRef.slice("refs/heads/".length),
            commit: branchCommit,
        };
    }
    if (tagCommit)
        return { requestedRef, branch: null, commit: tagCommit };
    throw new Error(`Git ref ${requestedRef} was not advertised by the reviewed remote`);
}
async function reviewedRemoteCommit(remoteIdentity, commit, cwd, sourcePolicy, git, signal) {
    const committedAt = await git.run(["show", "-s", "--format=%cI", commit], cwd, { signal });
    const decision = requireMinimumReleaseAge(remoteIdentity, committedAt, sourcePolicy);
    return {
        committedAt: decision.committedAt,
        minimumAgeMinutes: decision.minimumAgeMinutes,
        releaseAgeExcluded: decision.excluded,
    };
}
export async function initializeLibraryGit(root, remote, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    if (!(await exists(path.join(library, ".git")))) {
        await git.run(["init", "--initial-branch", DEFAULT_BRANCH], library);
        await git.run(["config", "user.name", GIT_NAME], library);
        await git.run(["config", "user.email", GIT_EMAIL], library);
    }
    if (remote)
        await setLibraryRemote(library, remote, git);
}
export async function setLibraryRemote(root, remote, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const validated = credentialFreeGitRemote(remote);
    try {
        await git.run(["remote", "get-url", "origin"], library);
        await git.run(["remote", "set-url", "origin", validated.remote], library);
    }
    catch {
        await git.run(["remote", "add", "origin", validated.remote], library);
    }
}
export async function planLibraryGitInitialization(root, remote, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const repositoryPresent = await exists(path.join(library, ".git"));
    let currentRemoteIdentity = null;
    if (repositoryPresent) {
        try {
            currentRemoteIdentity = normalizeGitIdentity(await git.run(["remote", "get-url", "origin"], library));
        }
        catch {
            /* no origin */
        }
    }
    const validated = remote ? credentialFreeGitRemote(remote) : null;
    return withPlanId({
        kind: "git-initialize",
        schemaVersion: 1,
        library,
        remote: validated?.remote ?? null,
        remoteIdentity: validated?.identity ?? null,
        repositoryPresent,
        currentRemoteIdentity,
    });
}
export async function applyLibraryGitInitialization(plan, git = new NodeWorkspaceGitPort()) {
    assertPlanId(plan);
    const current = await planLibraryGitInitialization(plan.library, plan.remote ?? undefined, git);
    if (current.planId !== plan.planId)
        throw new Error("Git repository or remote changed after the preview");
    await initializeLibraryGit(plan.library, plan.remote ?? undefined, git);
}
export async function cloneLibrary(remote, target, sourcePolicy = {}, git = new NodeWorkspaceGitPort()) {
    const plan = await planLibraryClone(remote, target, sourcePolicy, git);
    await applyLibraryClone(plan, git);
}
export async function planLibraryClone(remote, target, sourcePolicy = {}, git = new NodeWorkspaceGitPort(), options = {}) {
    return planGitCheckout(remote, target, "HEAD", sourcePolicy, git, options);
}
/**
 * Resolve a branch, tag, HEAD, or immutable SHA into an exact reviewed commit.
 * The plan may contact only a source already allowed by Device policy; apply
 * fetches that exact commit and rejects any changed timestamp or policy.
 */
export async function planGitCheckout(remote, target, requestedRef = "HEAD", sourcePolicy = {}, git = new NodeWorkspaceGitPort(), options = {}) {
    const validated = credentialFreeGitRemote(remote);
    const policy = parseSourceSecurityPolicy(sourcePolicy);
    const trust = requireTrustedSource(validated.remote, policy);
    const destination = path.resolve(target);
    if (await exists(destination))
        throw new Error("Clone destination must not already exist");
    const advertised = await resolveRemoteCheckout(validated.remote, requestedRef, git, options.signal);
    const reviewRoot = await mkdtemp(path.join(tmpdir(), "dotagents-clone-review-"));
    let age;
    try {
        await git.run(["init", "--bare"], reviewRoot, { signal: options.signal });
        await git.run(["remote", "add", "origin", validated.remote], reviewRoot, { signal: options.signal });
        await git.run(["fetch", "--no-tags", "--depth=1", "origin", advertised.commit], reviewRoot, {
            nonInteractive: true,
            signal: options.signal,
        });
        const fetched = (await git.run(["rev-parse", "FETCH_HEAD"], reviewRoot, { signal: options.signal })).toLowerCase();
        if (fetched !== advertised.commit)
            throw new Error("Git remote returned a different commit than the reviewed HEAD");
        age = await reviewedRemoteCommit(validated.identity, fetched, reviewRoot, policy, git, options.signal);
    }
    finally {
        await rm(reviewRoot, { recursive: true, force: true });
    }
    return withPlanId({
        kind: "git-clone",
        schemaVersion: 4,
        remote: validated.remote,
        remoteIdentity: validated.identity,
        destination,
        requestedRef: advertised.requestedRef,
        branch: advertised.branch,
        resolvedCommit: advertised.commit,
        ...age,
        sourcePolicy: policy,
        trust,
    });
}
async function applyReviewedGitClone(plan, git, validateLibrary, options = {}) {
    assertPlanId(plan);
    const validated = credentialFreeGitRemote(plan.remote);
    if (validated.identity !== plan.remoteIdentity)
        throw new Error("Clone remote changed after the preview");
    requireTrustedSource(validated.remote, plan.sourcePolicy);
    requireMinimumReleaseAge(plan.remoteIdentity, plan.committedAt, plan.sourcePolicy);
    const destination = plan.destination;
    if (await exists(destination))
        throw new Error("Clone destination must not already exist");
    await mkdir(path.dirname(destination), { recursive: true });
    const staging = await mkdtemp(path.join(path.dirname(destination), `.${path.basename(destination)}.dotagents-clone-`));
    try {
        await git.run(["init", `--initial-branch=${plan.branch ?? DEFAULT_BRANCH}`], staging, { signal: options.signal });
        // A portable library is byte-addressed by reviewed hashes. Git's Windows
        // line-ending conversion would silently change those bytes on checkout.
        await git.run(["config", "core.autocrlf", "false"], staging, { signal: options.signal });
        await git.run(["remote", "add", "origin", plan.remote], staging, { signal: options.signal });
        await git.run(["fetch", "--no-tags", "--depth=1", "origin", plan.resolvedCommit], staging, {
            nonInteractive: true,
            signal: options.signal,
        });
        const fetched = (await git.run(["rev-parse", "FETCH_HEAD"], staging, { signal: options.signal })).toLowerCase();
        if (fetched !== plan.resolvedCommit)
            throw new Error("Git remote did not return the reviewed immutable commit");
        const age = await reviewedRemoteCommit(plan.remoteIdentity, fetched, staging, plan.sourcePolicy, git, options.signal);
        if (age.committedAt !== plan.committedAt ||
            age.minimumAgeMinutes !== plan.minimumAgeMinutes ||
            age.releaseAgeExcluded !== plan.releaseAgeExcluded) {
            throw new Error("Remote commit or release-age policy changed after the preview");
        }
        if (plan.branch) {
            await git.run(["checkout", "-B", plan.branch, plan.resolvedCommit], staging, { signal: options.signal });
            await git.run(["config", `branch.${plan.branch}.remote`, "origin"], staging, { signal: options.signal });
            await git.run(["config", `branch.${plan.branch}.merge`, `refs/heads/${plan.branch}`], staging, {
                signal: options.signal,
            });
        }
        else {
            await git.run(["checkout", "--detach", plan.resolvedCommit], staging, { signal: options.signal });
        }
        if (validateLibrary)
            await ensureLibrary(staging);
        await git.run(["config", "user.name", GIT_NAME], staging, { signal: options.signal });
        await git.run(["config", "user.email", GIT_EMAIL], staging, { signal: options.signal });
        if (await exists(destination))
            throw new Error("Clone destination appeared after the preview");
        await rename(staging, destination);
    }
    catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
    }
}
/** Apply the exact reviewed commit without assuming a particular library manifest. */
export async function applyGitClonePlan(plan, git = new NodeWorkspaceGitPort(), options = {}) {
    await applyReviewedGitClone(plan, git, false, options);
}
export async function applyLibraryClone(plan, git = new NodeWorkspaceGitPort(), options = {}) {
    await applyReviewedGitClone(plan, git, true, options);
}
export async function getLibraryGitStatus(root, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const [branch, head, paths] = await Promise.all([
        gitBranch(library, git),
        gitHead(library, git),
        changedLibraryPaths(library, git),
    ]);
    let remoteIdentity = null;
    try {
        remoteIdentity = normalizeGitIdentity(await git.run(["remote", "get-url", "origin"], library));
    }
    catch {
        /* no remote */
    }
    let ahead = 0;
    let behind = 0;
    let hasUpstream = false;
    try {
        const counts = (await git.run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], library))
            .split(/\s+/)
            .map(Number);
        ahead = counts[0] ?? 0;
        behind = counts[1] ?? 0;
        hasUpstream = true;
    }
    catch {
        /* no upstream yet */
    }
    return {
        branch,
        changed: paths.changed.length > 0 || paths.ignored.length > 0,
        ahead,
        behind,
        hasUpstream,
        remoteIdentity,
        head,
    };
}
export async function planLibraryCommit(root, message, visibility = "private", git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const commitMessage = message.trim();
    if (!commitMessage || commitMessage.length > 200 || /[\r\n\0]/.test(commitMessage))
        throw new Error("Commit message must be one line between 1 and 200 characters");
    const paths = await changedLibraryPaths(library, git);
    const [snapshot, report, baseHead] = await Promise.all([
        snapshotFiles(library, paths.changed),
        auditLibrary({ root: library, visibility }),
        gitHead(library, git),
    ]);
    const errors = auditErrors(report);
    const secretFindings = uniqueSecretFindings(snapshot.secretFindings);
    const unsafePaths = [...new Set([...snapshot.unsafePaths, ...paths.ignored])].sort();
    const payload = {
        kind: "git-commit",
        schemaVersion: 1,
        library,
        visibility,
        message: commitMessage,
        baseHead,
        files: snapshot.snapshots,
        secretFindings,
        unsafePaths,
        auditErrors: errors,
        hasBlockers: secretFindings.length > 0 || unsafePaths.length > 0 || errors.length > 0,
    };
    return withPlanId(payload);
}
export async function applyLibraryCommit(plan, git = new NodeWorkspaceGitPort(), options = {}) {
    assertPlanId(plan);
    const current = await planLibraryCommit(plan.library, plan.message, plan.visibility, git);
    if (current.planId !== plan.planId)
        throw new Error("Library changed after the commit preview");
    const unacknowledgedSecretFindings = plan.secretFindings.filter((finding) => !(options.acknowledgedSecretFindings ?? []).some((acknowledgement) => acknowledgement.file === finding.file &&
        acknowledgement.rule === finding.rule &&
        acknowledgement.line === finding.line &&
        acknowledgement.column === finding.column));
    if (unacknowledgedSecretFindings.length > 0 || plan.unsafePaths.length > 0 || plan.auditErrors.length > 0) {
        throw new Error("Commit plan contains security or portability blockers");
    }
    if (plan.files.length === 0)
        return null;
    await git.run(["add", "-A", "--", ...plan.files.map((file) => file.path)], plan.library);
    await git.run(["commit", "-m", plan.message], plan.library);
    return gitHead(plan.library, git);
}
async function reviewedWorkspaceRemote(library, sourcePolicy, git) {
    const remote = await git.run(["remote", "get-url", "origin"], library);
    const policy = parseSourceSecurityPolicy(sourcePolicy);
    const trust = requireTrustedSource(remote, policy);
    return {
        remoteIdentity: normalizeGitIdentity(remote),
        sourcePolicy: policy,
        trust,
    };
}
export async function fetchLibrary(root, sourcePolicy = {}, git = new NodeWorkspaceGitPort(), options = {}) {
    const library = await ensureLibrary(root);
    await reviewedWorkspaceRemote(library, sourcePolicy, git);
    await git.run(["-c", "credential.interactive=false", "fetch", "origin", "--prune", "--no-tags"], library, {
        nonInteractive: true,
        signal: options.signal,
    });
}
export async function planLibraryPull(root, visibility = "private", sourcePolicy = {}, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const reviewedRemote = await reviewedWorkspaceRemote(library, sourcePolicy, git);
    const before = await getLibraryGitStatus(library, git);
    if (before.changed)
        throw new Error("Library has uncommitted changes; commit or discard them before pull review");
    if (!before.head)
        throw new Error("Library has no local commit to fast-forward");
    await fetchLibrary(library, reviewedRemote.sourcePolicy, git);
    const branch = before.branch || DEFAULT_BRANCH;
    const remoteHead = await git.run(["rev-parse", `refs/remotes/origin/${branch}`], library);
    const age = await reviewedRemoteCommit(reviewedRemote.remoteIdentity, remoteHead, library, reviewedRemote.sourcePolicy, git);
    const ancestry = await git.run(["merge-base", "--is-ancestor", before.head, remoteHead], library).then(() => true, () => false);
    if (!ancestry)
        throw new Error("Remote history is not a fast-forward; reconcile it explicitly");
    const files = before.head === remoteHead
        ? []
        : parseNullPaths(await git.run(["diff", "--name-only", "-z", `${before.head}..${remoteHead}`], library, { raw: true }));
    const worktreeParent = await mkdtemp(path.join(tmpdir(), "dotagents-pull-review-"));
    const worktree = path.join(worktreeParent, "checkout");
    let snapshot = {
        snapshots: [],
        unsafePaths: [],
        secretFindings: [],
    };
    let errors = [];
    try {
        await git.run(["worktree", "add", "--detach", worktree, remoteHead], library);
        snapshot = await snapshotFiles(worktree, files);
        errors = auditErrors(await auditLibrary({ root: worktree, visibility }));
    }
    finally {
        try {
            await git.run(["worktree", "remove", "--force", worktree], library);
        }
        catch {
            await rm(worktree, { recursive: true, force: true });
        }
        await rm(worktreeParent, { recursive: true, force: true });
    }
    const payload = {
        kind: "git-pull",
        schemaVersion: 3,
        library,
        visibility,
        branch,
        baseHead: before.head,
        remoteHead,
        files,
        secretFindings: uniqueSecretFindings(snapshot.secretFindings),
        unsafePaths: snapshot.unsafePaths,
        auditErrors: errors,
        hasBlockers: snapshot.secretFindings.length > 0 || snapshot.unsafePaths.length > 0 || errors.length > 0,
        remoteIdentity: reviewedRemote.remoteIdentity,
        ...age,
        sourcePolicy: reviewedRemote.sourcePolicy,
        trust: reviewedRemote.trust,
    };
    return withPlanId(payload);
}
export async function applyLibraryPull(plan, git = new NodeWorkspaceGitPort()) {
    assertPlanId(plan);
    const current = await planLibraryPull(plan.library, plan.visibility, plan.sourcePolicy, git);
    if (current.planId !== plan.planId)
        throw new Error("Remote or local library changed after the pull preview");
    if (plan.hasBlockers)
        throw new Error("Pull plan contains security or portability blockers");
    if (plan.baseHead !== plan.remoteHead)
        await git.run(["merge", "--ff-only", plan.remoteHead], plan.library);
    const head = await gitHead(plan.library, git);
    if (!head)
        throw new Error("Pull completed without a readable Git HEAD");
    return head;
}
export async function planLibraryPush(root, sourcePolicy = {}, git = new NodeWorkspaceGitPort()) {
    const library = await ensureLibrary(root);
    const reviewedRemote = await reviewedWorkspaceRemote(library, sourcePolicy, git);
    const status = await getLibraryGitStatus(library, git);
    if (status.changed)
        throw new Error("Library has uncommitted changes; review and commit them before push");
    if (!status.head)
        throw new Error("Library has no commit to push");
    if (!status.remoteIdentity)
        throw new Error("Library has no origin remote");
    const payload = {
        kind: "git-push",
        schemaVersion: 2,
        library,
        branch: status.branch || DEFAULT_BRANCH,
        head: status.head,
        remoteIdentity: status.remoteIdentity,
        ahead: status.ahead,
        sourcePolicy: reviewedRemote.sourcePolicy,
        trust: reviewedRemote.trust,
    };
    return withPlanId(payload);
}
export async function applyLibraryPush(plan, git = new NodeWorkspaceGitPort()) {
    assertPlanId(plan);
    const current = await planLibraryPush(plan.library, plan.sourcePolicy, git);
    if (current.planId !== plan.planId)
        throw new Error("Library changed after the push preview");
    await git.run(["push", "-u", "origin", `HEAD:${plan.branch}`], plan.library);
}
//# sourceMappingURL=git-workspace.js.map