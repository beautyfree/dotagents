#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { auditLibrary } from "./audit.js";
import { parseOwnedImportSpec, validateImportCandidates } from "./cli-import.js";
import { parseMaterializationTargetSpec } from "./cli-target.js";
import { applyConnectPlan, planConnect } from "./connect.js";
import { doctorLibrary } from "./doctor.js";
import { deviceProfilePath, loadDeviceProfile, providerFromRemote, saveDeviceProfile, selectDeviceProfile, } from "./device-profile.js";
import { GitDependencyResolver } from "./git-resolver.js";
import { applyLibraryClone, applyLibraryCommit, applyLibraryGitInitialization, applyLibraryPull, applyLibraryPush, credentialFreeGitRemote, NodeWorkspaceGitPort, getLibraryGitStatus, planLibraryClone, planLibraryCommit, planLibraryGitInitialization, planLibraryPull, planLibraryPush, } from "./git-workspace.js";
import { planImport } from "./import.js";
import { applyImportPlan, inspectImportRecovery, recoverImport } from "./import-apply.js";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "./init.js";
import { scanLibrary } from "./inventory.js";
import { planMaterialization } from "./materialize.js";
import { applyMaterializationPlan, inspectMaterializationRecovery, recoverMaterialization, } from "./materialize-apply.js";
import { computePlanId } from "./plan.js";
import { prepareMaterializationInventory } from "./prepared-library.js";
import { applyLibraryResolutionPlan, planLibraryResolution } from "./sources.js";
import { exactSourceSecurityPolicy, parseSourceSecurityPolicy } from "./source-policy.js";
import { existingTargetsForPlan, getMaterializationStatus } from "./status.js";
import { applySetupPlan, planSetup } from "./setup.js";
import { planProviderLibraryCreation, } from "./providers.js";
import { connectProvider, loadProviderSession, providerGitEnvironment, } from "./provider-session.js";
function existingSetupRemote(connection, connectionId, providerAccount) {
    return {
        ...connection,
        kind: "existing",
        ...(connectionId ? { connectionId } : {}),
        ...(providerAccount ? { providerAccount } : {}),
    };
}
function openInBrowser(url) {
    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.unref();
    }
    catch {
        // The printed URL remains a complete manual path when a desktop opener is unavailable.
    }
}
async function nativeProviderSession(provider, account) {
    const saved = await loadProviderSession(provider, account ?? "default");
    if (saved)
        return saved;
    return connectProvider(provider, {
        show: ({ provider: kind, userCode, verificationUri }) => {
            process.stdout.write(`\nConnect ${kind === "github" ? "GitHub" : "GitLab"} once in your browser. Enter this code if asked:\n\n  ${userCode}\n\n${verificationUri}\n\nWaiting for approval…\n`);
        },
        openBrowser: openInBrowser,
    });
}
async function emitPlan(plan, output, json, label) {
    if (output)
        await writeFile(path.resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (json || !output)
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    else
        process.stdout.write(`${label} plan ${plan.planId} written to ${path.resolve(output)}. Review it, then run apply with --yes.\n`);
}
function setupSummary(plan) {
    const { summary } = plan;
    const agentLabel = summary.agentsDetected === 1 ? "agent" : "agents";
    const skillLabel = summary.skillsFound === 1 ? "skill" : "skills";
    const lines = [
        "Your agent setup, in one library.",
        `Found ${summary.skillsFound} ${skillLabel} across ${summary.agentsDetected} ${agentLabel}.`,
        "",
        `${summary.owned} ${summary.owned === 1 ? "skill is" : "skills are"} ready to keep in your library.`,
    ];
    if (summary.sourceLinked)
        lines.push(`${summary.sourceLinked} ${summary.sourceLinked === 1 ? "skill stays" : "skills stay"} linked to their original source.`);
    if (summary.needsReview)
        lines.push(`${summary.needsReview} ${summary.needsReview === 1 ? "skill needs" : "skills need"} review and will stay untouched.`);
    if (summary.linkedAliases)
        lines.push(`${summary.linkedAliases} linked ${summary.linkedAliases === 1 ? "alias is" : "aliases are"} already available; nothing will be copied.`);
    lines.push("", "Nothing outside your library will be removed or overwritten. Compatible empty agent folders can be connected safely after you confirm.");
    return `${lines.join("\n")}\n`;
}
function connectSummary(plan) {
    const { summary } = plan;
    if (summary.agentsFound === 0)
        return "No compatible installed agents were found. Your library is still ready to carry with you.\n";
    const lines = [`Your library is ready for ${summary.agentsFound} ${summary.agentsFound === 1 ? "agent" : "agents"}.`];
    if (summary.sharedAgents.length)
        lines.push(`${summary.sharedAgents.join(", ")} already ${summary.sharedAgents.length === 1 ? "reads" : "read"} your shared library.`);
    if (summary.linksToCreate)
        lines.push(`${summary.linkedAgents.join(", ")} will get safe links to ${summary.linksToCreate} ${summary.linksToCreate === 1 ? "skill" : "skills"}.`);
    if (summary.needsReview)
        lines.push(`${summary.needsReview} ${summary.needsReview === 1 ? "existing skill needs" : "existing skills need"} review and will stay untouched.`);
    lines.push("No existing agent files will be replaced.");
    return `${lines.join("\n")}\n`;
}
function displayPath(value, home = process.env.HOME) {
    if (!home)
        return value;
    const resolvedHome = path.resolve(home);
    const resolvedValue = path.resolve(value);
    if (resolvedValue === resolvedHome)
        return "~";
    if (resolvedValue.startsWith(`${resolvedHome}${path.sep}`))
        return `~/${path.relative(resolvedHome, resolvedValue)}`;
    return value;
}
function defaultLibraryRoot(home = process.env.HOME ?? process.env.USERPROFILE) {
    if (!home)
        throw new Error("Could not determine your home directory; pass the library path explicitly.");
    return path.join(path.resolve(home), ".agents");
}
function remoteLabel(remote) {
    const identity = credentialFreeGitRemote(remote).identity;
    const parsed = new URL(identity);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length >= 2 ? segments.slice(-2).join("/") : parsed.hostname;
}
function statusSummary(status) {
    if (status.targets.length === 0)
        return "Your library is ready to connect to an agent. No agent folders are managed yet.\n";
    const byHealth = (health) => status.targets.filter((target) => target.health === health).length;
    const agents = new Set(status.targets.map((target) => target.agent)).size;
    const current = byHealth("current");
    const attention = status.targets.length - current;
    const lines = [
        `Your library is connected to ${agents} ${agents === 1 ? "agent" : "agents"}.`,
        `${current} ${current === 1 ? "skill is" : "skills are"} up to date.`,
    ];
    if (attention)
        lines.push(`${attention} ${attention === 1 ? "skill needs" : "skills need"} attention; run dotagents status --json for the exact paths.`);
    else
        lines.push("Nothing managed by dotagents needs attention.");
    return `${lines.join("\n")}\n`;
}
async function confirm(question) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return false;
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return /^(y|yes)$/i.test((await prompt.question(question)).trim());
    }
    finally {
        prompt.close();
    }
}
async function choose(question, values, label) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return null;
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
        process.stdout.write(`${question}\n${values.map((value, index) => `  ${index + 1}. ${label(value)}`).join("\n")}\n`);
        const chosen = Number((await prompt.question("Choose a number (or press Enter to skip): ")).trim());
        return Number.isInteger(chosen) && chosen >= 1 && chosen <= values.length ? (values[chosen - 1] ?? null) : null;
    }
    finally {
        prompt.close();
    }
}
async function ask(question) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return null;
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const value = (await prompt.question(question)).trim();
        return value || null;
    }
    finally {
        prompt.close();
    }
}
async function selectSetupRemote(options) {
    const profileFile = deviceProfilePath(process.env, options.home);
    if (options.connection) {
        const selected = await selectDeviceProfile(options.connection, profileFile);
        return existingSetupRemote(selected, selected.id, selected.provider_account);
    }
    if (options.remote) {
        return existingSetupRemote({
            remote: options.remote,
            provider: providerFromRemote(options.remote),
            label: remoteLabel(options.remote),
        });
    }
    if (options.provider === "generic") {
        if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new Error("Pass --remote when configuring another or self-hosted Git server non-interactively.");
        const remote = await ask("Git remote URL (press Enter to keep this library local for now): ");
        if (!remote)
            return null;
        const validated = credentialFreeGitRemote(remote);
        return existingSetupRemote({
            remote: validated.remote,
            provider: "generic",
            label: remoteLabel(validated.remote),
        });
    }
    if (options.provider === "github" || options.provider === "gitlab") {
        if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new Error(`Run dotagents setup interactively once to connect ${options.provider}; later dotagents sync needs no URL or provider CLI.`);
        const session = await nativeProviderSession(options.provider);
        const libraries = await session.adapter.listLibraries();
        const create = { provider: options.provider, label: "Create a new private library", remote: "" };
        const selected = await choose(`Your ${options.provider} repositories:`, [...libraries, create], (library) => library.label);
        if (!selected)
            return null;
        if (selected !== create)
            return existingSetupRemote(selected, undefined, session.account);
        const name = await ask(options.provider === "github"
            ? "New GitHub library name (name or owner/name): "
            : "New GitLab library name (name or group/subgroup/name): ");
        return name
            ? {
                kind: "create",
                provider: options.provider,
                plan: planProviderLibraryCreation(options.provider, name),
                session,
            }
            : null;
    }
    const active = await loadDeviceProfile(profileFile);
    if (active)
        return existingSetupRemote(active, active.id, active.provider_account);
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return null;
    const provider = await choose("Where should dotagents keep this library?", ["github", "gitlab", "generic"], (kind) => {
        if (kind === "github")
            return "GitHub — sign in and choose a repository";
        if (kind === "gitlab")
            return "GitLab — sign in and choose a repository";
        return "Another Git server — enter its Git URL once";
    });
    return provider ? selectSetupRemote({ provider, ...(options.home ? { home: options.home } : {}) }) : null;
}
async function main() {
    const [command = "help", ...args] = process.argv.slice(2);
    const valueOptions = new Set([
        "--name",
        "--out",
        "--target",
        "--owned",
        "--candidate-file",
        "--remote",
        "--message",
        "--plan-id",
        "--trust-source",
        "--trust-host",
        "--trust-github-org",
        "--minimum-release-age",
        "--minimum-release-age-exclude",
        "--home",
        "--provider",
        "--connection",
    ]);
    const optionValues = (name) => args.flatMap((argument, index) => {
        const value = args[index + 1];
        return argument === name && value ? [value] : [];
    });
    const optionValue = (name) => optionValues(name)[0];
    const sourcePolicy = () => {
        const minimumAge = Number(optionValue("--minimum-release-age") ?? "0");
        if (!Number.isInteger(minimumAge) || minimumAge < 0)
            throw new Error("--minimum-release-age must be a non-negative integer number of minutes");
        const repositories = optionValues("--trust-source");
        const hosts = optionValues("--trust-host");
        const organizations = optionValues("--trust-github-org");
        return parseSourceSecurityPolicy({
            trust: {
                mode: args.includes("--trust-all")
                    ? "allow-all"
                    : repositories.length > 0 || hosts.length > 0 || organizations.length > 0
                        ? "allowlist"
                        : "deny",
                repositories,
                hosts,
                github_organizations: organizations,
                allow_local: args.includes("--allow-local-sources"),
            },
            minimum_release_age_minutes: minimumAge,
            minimum_release_age_exclude: optionValues("--minimum-release-age-exclude"),
        });
    };
    const positional = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (!argument)
            continue;
        if (valueOptions.has(argument)) {
            index += 1;
            continue;
        }
        if (!argument.startsWith("--"))
            positional.push(argument);
    }
    const directory = positional[0] ?? ".";
    const json = args.includes("--json");
    if (command === "help" || command === "--help" || command === "-h") {
        process.stdout.write("Start here:\n  dotagents setup\n  dotagents sync\n  dotagents status\n\nSetup connects a personal library once. GitHub and GitLab use a one-time browser sign-in and the system credential vault; no provider CLI is required. Sync then uses the saved connection without paths or URLs. It asks before changing anything and stops for a real conflict.\n\nUseful options:\n  dotagents setup [library-directory] [--provider github|gitlab] [--remote git-url] [--connection id] [--dry-run] [--yes]\n  dotagents sync [library-directory] [--pull|--push] [--public|--team] [source-trust-options] [--out plan.json]\n  dotagents connect [library-directory] [--dry-run] [--yes]\n\nProvider sign-in and repository listing happen only during interactive setup. Network access is denied for advanced source resolution until an explicit trust policy is supplied; local Git sources additionally need --allow-local-sources.\n");
        return 0;
    }
    if (command === "setup") {
        const root = positional[0] ? path.resolve(positional[0]) : undefined;
        const name = optionValue("--name");
        const home = optionValue("--home");
        const providerOption = optionValue("--provider");
        if (providerOption && !["github", "gitlab", "generic"].includes(providerOption))
            throw new Error("--provider must be github, gitlab, or generic");
        const requestedRemote = optionValue("--remote");
        const requestedConnection = optionValue("--connection");
        let selected = await selectSetupRemote({
            ...(requestedRemote ? { remote: requestedRemote } : {}),
            ...(providerOption ? { provider: providerOption } : {}),
            ...(requestedConnection ? { connection: requestedConnection } : {}),
            ...(home ? { home } : {}),
        });
        let remote = selected?.kind === "existing" ? selected.remote : undefined;
        const targetRoot = root ?? defaultLibraryRoot(home);
        const existingLibrary = await getLibraryGitStatus(targetRoot).catch(() => null);
        if (selected?.kind === "existing" &&
            !existsSync(targetRoot) &&
            !args.includes("--dry-run") &&
            !optionValue("--out")) {
            const session = selected.provider === "generic"
                ? null
                : await nativeProviderSession(selected.provider, selected.providerAccount);
            const transport = session
                ? new NodeWorkspaceGitPort(providerGitEnvironment(session.provider, session.accessToken))
                : undefined;
            const clone = await planLibraryClone(selected.remote, targetRoot, exactSourceSecurityPolicy([selected.remote]), transport);
            if (!json)
                process.stdout.write(`dotagents found ${selected.label}. It will review and restore commit ${clone.resolvedCommit.slice(0, 12)} into ${displayPath(targetRoot, home)}.\n`);
            const confirmed = args.includes("--yes") || (await confirm("Use this library on this computer? [y/N] "));
            if (!confirmed) {
                if (!json)
                    process.stdout.write("Nothing changed.\n");
                return 0;
            }
            await applyLibraryClone(clone, transport);
            const connection = await planConnect({ root: targetRoot, ...(home ? { home } : {}) });
            const connected = connection.materialization.hasConflicts ? null : await applyConnectPlan(connection);
            const profile = await saveDeviceProfile({
                library: targetRoot,
                remote: selected.remote,
                provider: selected.provider,
                ...(session ? { provider_account: session.account } : {}),
                label: selected.label,
            }, deviceProfilePath(process.env, home));
            if (json)
                process.stdout.write(`${JSON.stringify({ ok: true, restored: true, root: targetRoot, connection, connected, profile }, null, 2)}\n`);
            else
                process.stdout.write(`Library ready at ${displayPath(targetRoot, home)}. Future syncs use ${profile.label}; no URL is needed.\n`);
            return connection.materialization.hasConflicts ? 1 : 0;
        }
        let plan = await planSetup({
            ...(root ? { root } : {}),
            ...(name ? { name } : {}),
            ...(home ? { home } : {}),
            ...(remote && !existingLibrary?.remoteIdentity ? { remote } : {}),
        });
        const output = optionValue("--out");
        const creation = selected?.kind === "create" ? selected : null;
        if (creation && output)
            throw new Error("Creating a remote library is an interactive reviewed action and cannot be written as an apply plan.");
        if (creation && args.includes("--dry-run")) {
            const review = { setup: plan, remote_creation: creation.plan };
            if (json)
                process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
            else {
                process.stdout.write(setupSummary(plan));
                process.stdout.write(`After confirmation, dotagents will create private ${creation.provider} library ${creation.plan.name}. No remote will be created during this preview.\n`);
            }
            return 0;
        }
        if (output)
            await writeFile(path.resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        if (args.includes("--dry-run") || output) {
            if (json)
                process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            else {
                process.stdout.write(setupSummary(plan));
                if (output)
                    process.stdout.write(`Setup plan written to ${path.resolve(output)}. Review it, then run dotagents apply ${path.resolve(output)} --yes.\n`);
            }
            return 0;
        }
        let creationConfirmed = false;
        if (creation) {
            if (!json)
                process.stdout.write(`After confirmation, dotagents will create private ${creation.provider} library ${creation.plan.name}, then prepare this local library.\n`);
            const confirmedCreation = await confirm(`Create private ${creation.provider} library ${creation.plan.name} and continue? [y/N] `);
            if (!confirmedCreation) {
                if (!json)
                    process.stdout.write("Nothing changed.\n");
                return 0;
            }
            const connection = await creation.session.adapter.createLibrary(creation.plan);
            selected = existingSetupRemote(connection, undefined, creation.session.account);
            remote = connection.remote;
            plan = await planSetup({
                ...(root ? { root } : {}),
                ...(name ? { name } : {}),
                ...(home ? { home } : {}),
                ...(remote && !existingLibrary?.remoteIdentity ? { remote } : {}),
            });
            creationConfirmed = true;
        }
        if (!json)
            process.stdout.write(setupSummary(plan));
        const confirmed = creationConfirmed || args.includes("--yes") || (await confirm("Create this library now? [y/N] "));
        if (!confirmed) {
            if (json)
                process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            else
                process.stdout.write("Nothing changed. Run dotagents setup again whenever you are ready.\n");
            return 0;
        }
        const result = await applySetupPlan(plan);
        const git = await getLibraryGitStatus(result.root).catch(() => null);
        if (git?.remoteIdentity)
            await saveDeviceProfile({
                library: result.root,
                remote: git.remoteIdentity,
                provider: selected?.kind === "existing" ? selected.provider : providerFromRemote(git.remoteIdentity),
                provider_account: selected?.kind === "existing" ? (selected.providerAccount ?? null) : null,
                label: selected?.kind === "existing" ? selected.label : git.remoteIdentity,
            }, deviceProfilePath(process.env, home));
        const connection = await planConnect({ root: result.root, ...(home ? { home } : {}) });
        const connected = !connection.materialization.hasConflicts && connection.summary.linksToCreate > 0
            ? await applyConnectPlan(connection)
            : null;
        if (json)
            process.stdout.write(`${JSON.stringify({ ok: true, plan, result, connection, connected, ...(creation ? { remoteCreation: creation.plan } : {}) }, null, 2)}\n`);
        else {
            process.stdout.write(`Your library is ready at ${displayPath(result.root)}: ${result.import.copied} copied, ${result.import.adopted} already there, and ${result.import.dependenciesRecorded} source-linked${result.gitInitialized ? "; Git is ready too" : ""}.\n`);
            if (result.gitInitialized && git?.remoteIdentity)
                process.stdout.write(`Nothing has been uploaded yet. Run dotagents sync when you are ready to send this reviewed library to ${selected?.kind === "existing" ? selected.label : remoteLabel(git.remoteIdentity)}.\n`);
            if (connection.materialization.hasConflicts)
                process.stdout.write(`\n${connectSummary(connection)}`);
            else {
                if (connection.summary.sharedAgents.length)
                    process.stdout.write(`${connection.summary.sharedAgents.join(", ")} can use your shared library now.\n`);
                if (connected)
                    process.stdout.write(`Connected ${connected.applied} ${connected.applied === 1 ? "skill" : "skills"} safely.\n`);
            }
        }
        return 0;
    }
    if (command === "connect") {
        const root = positional[0] ? path.resolve(positional[0]) : undefined;
        const home = optionValue("--home");
        const plan = await planConnect({ ...(root ? { root } : {}), ...(home ? { home } : {}) });
        const output = optionValue("--out");
        if (output)
            await writeFile(path.resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        if (args.includes("--dry-run") || output) {
            if (json)
                process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            else
                process.stdout.write(connectSummary(plan));
            return plan.materialization.hasConflicts ? 1 : 0;
        }
        if (!json)
            process.stdout.write(connectSummary(plan));
        if (plan.materialization.hasConflicts)
            return 1;
        const confirmed = args.includes("--yes") || (await confirm("Connect these agents now? [y/N] "));
        if (!confirmed) {
            if (json)
                process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            else
                process.stdout.write("Nothing changed. Run dotagents connect again whenever you are ready.\n");
            return 0;
        }
        const result = await applyConnectPlan(plan);
        if (json)
            process.stdout.write(`${JSON.stringify({ ok: true, plan, result }, null, 2)}\n`);
        else
            process.stdout.write(`Connected ${result.applied} ${result.applied === 1 ? "skill" : "skills"} safely.\n`);
        return 0;
    }
    if (command === "init") {
        const root = path.resolve(directory);
        const requestedName = optionValue("--name");
        const plan = planInitializeLibrary(root, requestedName);
        await emitPlan(plan, optionValue("--out"), json, "Initialize");
        return 0;
    }
    if (command === "resolve") {
        const root = path.resolve(directory);
        const plan = await planLibraryResolution(root, new GitDependencyResolver({
            cacheRoot: path.join(root, ".dotagents", "cache", "git"),
            sourcePolicy: sourcePolicy(),
        }));
        await emitPlan(plan, optionValue("--out"), json, "Dependency resolution");
        return 0;
    }
    if (command === "import") {
        const root = path.resolve(directory);
        const candidates = optionValues("--owned").map((spec) => parseOwnedImportSpec(spec));
        for (const candidateFile of optionValues("--candidate-file")) {
            const absoluteFile = path.resolve(candidateFile);
            const parsed = validateImportCandidates(JSON.parse(await readFile(absoluteFile, "utf8")));
            for (const candidate of parsed) {
                if ((candidate.kind === "owned" ||
                    candidate.kind === "vendored" ||
                    candidate.kind === "local-only" ||
                    candidate.kind === "excluded") &&
                    candidate.sourcePath) {
                    candidate.sourcePath = path.resolve(path.dirname(absoluteFile), candidate.sourcePath);
                }
                candidates.push(candidate);
            }
        }
        if (candidates.length === 0)
            throw new Error("Import requires at least one --owned skill=path or --candidate-file");
        const plan = await planImport(root, candidates);
        const output = optionValue("--out");
        if (output)
            await writeFile(path.resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        if (json || !output)
            process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else
            process.stdout.write(`Import plan ${plan.planId} written to ${path.resolve(output)}. Review it, then run apply with --yes.\n`);
        return plan.hasConflicts || plan.secretFindings.length > 0 ? 1 : 0;
    }
    if (command === "doctor") {
        const report = await doctorLibrary({ root: path.resolve(directory) });
        if (json)
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        else if (report.issues.length === 0)
            process.stdout.write(`Library ${report.library?.name ?? report.root} is healthy.\n`);
        else
            for (const entry of report.issues)
                process.stdout.write(`${entry.severity?.toUpperCase()}: ${entry.message}\nNext: ${entry.remediation}\n`);
        return report.ok ? 0 : 1;
    }
    if (command === "audit") {
        const report = await auditLibrary({
            root: path.resolve(directory),
            visibility: args.includes("--public") ? "public" : "private",
        });
        if (json)
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        else if (report.issues.length === 0)
            process.stdout.write("No structural or licensing issues found.\n");
        else
            for (const entry of report.issues)
                process.stdout.write(`${entry.severity?.toUpperCase()}: ${entry.message}\nNext: ${entry.remediation}\n`);
        return report.ok ? 0 : 1;
    }
    if (command === "git-init") {
        const root = path.resolve(directory);
        const plan = await planLibraryGitInitialization(root, optionValue("--remote"));
        await emitPlan(plan, optionValue("--out"), json, "Git initialize");
        return 0;
    }
    if (command === "clone") {
        const remote = positional[0];
        const target = positional[1];
        if (!remote || !target)
            throw new Error("Clone requires a Git URL and a new library directory");
        const plan = await planLibraryClone(remote, path.resolve(target), sourcePolicy());
        await emitPlan(plan, optionValue("--out"), json, "Clone");
        return 0;
    }
    if (command === "commit") {
        const message = optionValue("--message");
        if (!message)
            throw new Error("Commit preview requires --message");
        const visibility = args.includes("--public") ? "public" : args.includes("--team") ? "team" : "private";
        const commitPlan = await planLibraryCommit(path.resolve(directory), message, visibility);
        await emitPlan(commitPlan, optionValue("--out"), json, "Commit");
        return commitPlan.hasBlockers ? 1 : 0;
    }
    if (command === "sync") {
        const home = optionValue("--home");
        const profile = positional[0] ? null : await loadDeviceProfile(deviceProfilePath(process.env, home));
        const root = positional[0] ? path.resolve(positional[0]) : (profile?.library ?? defaultLibraryRoot(home));
        const provider = profile?.provider ?? null;
        const session = provider && provider !== "generic" ? await nativeProviderSession(provider, profile?.provider_account) : null;
        const transport = session
            ? new NodeWorkspaceGitPort(providerGitEnvironment(session.provider, session.accessToken))
            : undefined;
        if (args.includes("--pull") && args.includes("--push"))
            throw new Error("Choose either --pull or --push for one reviewed operation");
        if (args.includes("--pull")) {
            const visibility = args.includes("--public") ? "public" : args.includes("--team") ? "team" : "private";
            const pullPlan = await planLibraryPull(root, visibility, sourcePolicy(), transport);
            await emitPlan(pullPlan, optionValue("--out"), json, "Pull");
            return pullPlan.hasBlockers ? 1 : 0;
        }
        if (args.includes("--push")) {
            const pushPlan = await planLibraryPush(root, sourcePolicy(), transport);
            await emitPlan(pushPlan, optionValue("--out"), json, "Push");
            return 0;
        }
        let gitStatus = await getLibraryGitStatus(root);
        if (!gitStatus.remoteIdentity)
            throw new Error("This library is not connected yet. Run dotagents setup to choose where it lives.");
        if (profile && profile.remote !== gitStatus.remoteIdentity)
            throw new Error("The saved library profile no longer matches this Git remote. Run dotagents setup again to review the change.");
        if (gitStatus.ahead > 0 && gitStatus.behind > 0)
            throw new Error("Your library changed both here and remotely. Nothing was overwritten; use the advanced sync review to reconcile it.");
        if (!json)
            process.stdout.write(`dotagents will sync ${displayPath(root)} with ${gitStatus.remoteIdentity}. Local agent settings and secrets stay on this computer.\n`);
        const confirmed = args.includes("--yes") || (await confirm("Sync now? [y/N] "));
        if (!confirmed) {
            if (!json)
                process.stdout.write("Nothing changed.\n");
            return 0;
        }
        const policy = exactSourceSecurityPolicy([gitStatus.remoteIdentity]);
        if (gitStatus.changed) {
            const commit = await planLibraryCommit(root, "Update agent library", "private");
            if (commit.hasBlockers)
                throw new Error("Sync stopped because the library needs review. Run dotagents doctor for details.");
            await applyLibraryCommit(commit, transport);
            gitStatus = await getLibraryGitStatus(root);
        }
        if (gitStatus.behind > 0) {
            const pull = await planLibraryPull(root, "private", policy, transport);
            if (pull.hasBlockers)
                throw new Error("Sync stopped because the remote library needs review.");
            await applyLibraryPull(pull, transport);
            gitStatus = await getLibraryGitStatus(root);
        }
        if (gitStatus.ahead > 0 || (gitStatus.head && !gitStatus.hasUpstream)) {
            const push = await planLibraryPush(root, policy, transport);
            await applyLibraryPush(push, transport);
            gitStatus = await getLibraryGitStatus(root);
        }
        process.stdout.write(json
            ? `${JSON.stringify({ ok: true, ...gitStatus }, null, 2)}\n`
            : `Sync complete. ${gitStatus.branch} is up to date.\n`);
        return 0;
    }
    if (command === "status") {
        const home = optionValue("--home");
        const profile = positional[0] ? null : await loadDeviceProfile(deviceProfilePath(process.env, home));
        const root = positional[0] ? path.resolve(positional[0]) : (profile?.library ?? defaultLibraryRoot(home));
        const status = await getMaterializationStatus(root);
        if (json)
            process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        else
            process.stdout.write(statusSummary(status));
        return status.targets.some((target) => target.health === "invalid") ? 1 : 0;
    }
    if (command === "plan") {
        const root = path.resolve(directory);
        const inventory = await prepareMaterializationInventory({
            root,
            resolver: new GitDependencyResolver({
                cacheRoot: path.join(root, ".dotagents", "cache", "git"),
                sourcePolicy: sourcePolicy(),
            }),
        });
        const targetSpecs = optionValues("--target").map(parseMaterializationTargetSpec);
        if (targetSpecs.length === 0)
            throw new Error("At least one explicit --target slug=mode=path is required");
        const platform = process.platform;
        if (!["darwin", "linux", "win32"].includes(platform))
            throw new Error(`Unsupported platform: ${process.platform}`);
        const targets = await Promise.all(targetSpecs.map(async (spec) => {
            const root = spec.root;
            const delivery = spec.mode === "native"
                ? { kind: "native-shared" }
                : spec.mode === "copy"
                    ? { kind: "copy-only", roots: [root ?? ""] }
                    : { kind: "per-skill-link", roots: [root ?? ""] };
            const descriptor = {
                slug: spec.slug,
                displayName: spec.slug,
                platforms: [platform],
                detection: [],
                skills: [delivery],
            };
            return {
                descriptor,
                platform,
                detected: true,
                mode: spec.mode,
                ...(root ? { root: path.resolve(root) } : {}),
                existing: root
                    ? await existingTargetsForPlan(root, spec.slug, path.resolve(root), inventory.ownedSkills.map((skill) => skill.name))
                    : {},
            };
        }));
        const plan = planMaterialization(inventory, targets);
        const output = optionValue("--out");
        if (output)
            await writeFile(path.resolve(output), `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        if (json || !output)
            process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else
            process.stdout.write(`Plan ${plan.planId} written to ${path.resolve(output)} with ${plan.operations.length} operations.\n`);
        return plan.hasConflicts ? 1 : 0;
    }
    if (command === "apply") {
        if (!args.includes("--yes"))
            throw new Error("Refusing to apply without explicit --yes confirmation");
        const plan = JSON.parse(await readFile(path.resolve(directory), "utf8"));
        if (plan.kind === "initialize-library") {
            await applyInitializeLibraryPlan(plan);
            const result = {
                ok: true,
                root: plan.root,
                plan_id: plan.planId,
                created: plan.files.map((file) => file.path),
            };
            process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `Created the library at ${plan.root}.\n`);
        }
        else if (plan.kind === "resolve-library-dependencies") {
            await applyLibraryResolutionPlan(plan);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, root: plan.library, plan_id: plan.planId, changes: plan.changes }, null, 2)}\n`
                : `Wrote ${plan.lock.resolved ? Object.keys(plan.lock.resolved).length : 0} immutable dependencies to ${plan.library}.\n`);
        }
        else if (plan.kind === "import") {
            const result = await applyImportPlan(plan);
            process.stdout.write(json
                ? `${JSON.stringify(result, null, 2)}\n`
                : `Imported ${result.copied} owned skills and recorded ${result.dependenciesRecorded} dependencies from plan ${result.planId}.\n`);
        }
        else if (plan.kind === "materialize") {
            const result = await applyMaterializationPlan(plan);
            process.stdout.write(json
                ? `${JSON.stringify(result, null, 2)}\n`
                : `Applied ${result.applied} operations from plan ${result.planId}.\n`);
        }
        else if (plan.kind === "git-initialize") {
            await applyLibraryGitInitialization(plan);
            const status = await getLibraryGitStatus(plan.library);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, root: plan.library, plan_id: plan.planId, ...status }, null, 2)}\n`
                : `Git workspace initialized on ${status.branch}${status.remoteIdentity ? ` with ${status.remoteIdentity}` : ""}.\n`);
        }
        else if (plan.kind === "git-clone") {
            await applyLibraryClone(plan);
            const status = await getLibraryGitStatus(plan.destination);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, root: plan.destination, plan_id: plan.planId, ...status }, null, 2)}\n`
                : `Cloned the library to ${plan.destination}.\n`);
        }
        else if (plan.kind === "git-commit") {
            const head = await applyLibraryCommit(plan);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, head }, null, 2)}\n`
                : head
                    ? `Created commit ${head}.\n`
                    : "No portable changes to commit.\n");
        }
        else if (plan.kind === "git-pull") {
            const head = await applyLibraryPull(plan);
            process.stdout.write(json ? `${JSON.stringify({ ok: true, head }, null, 2)}\n` : `Fast-forwarded the library to ${head}.\n`);
        }
        else if (plan.kind === "git-push") {
            await applyLibraryPush(plan);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, head: plan.head }, null, 2)}\n`
                : `Pushed ${plan.head} to ${plan.remoteIdentity}.\n`);
        }
        else if (plan.kind === "setup") {
            const result = await applySetupPlan(plan);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`
                : `Your library is ready at ${displayPath(result.root)}: ${result.import.copied} copied, ${result.import.adopted} already there.\n`);
        }
        else if (plan.kind === "connect") {
            const result = await applyConnectPlan(plan);
            process.stdout.write(json
                ? `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`
                : `Connected ${result.applied} ${result.applied === 1 ? "skill" : "skills"} safely.\n`);
        }
        else {
            throw new Error("Unsupported plan kind");
        }
        return 0;
    }
    if (command === "recover") {
        const root = path.resolve(directory);
        const recoveryPayload = {
            kind: "recover",
            schemaVersion: 1,
            library: root,
            import: await inspectImportRecovery(root),
            materialization: await inspectMaterializationRecovery(root),
        };
        const recoveryPlan = { ...recoveryPayload, planId: computePlanId(recoveryPayload) };
        if (!args.includes("--yes")) {
            process.stdout.write(json
                ? `${JSON.stringify(recoveryPlan, null, 2)}\n`
                : recoveryPlan.import || recoveryPlan.materialization
                    ? `Recovery plan ${recoveryPlan.planId}: review interrupted operations, then rerun with --plan-id ${recoveryPlan.planId} --yes.\n`
                    : `Recovery plan ${recoveryPlan.planId}: no unfinished operation found.\n`);
            return 0;
        }
        const expectedPlanId = optionValue("--plan-id");
        if (!expectedPlanId || expectedPlanId !== recoveryPlan.planId)
            throw new Error("Recovery preview changed or --plan-id is missing; review recovery again before --yes");
        const imported = await recoverImport(root);
        const materialized = await recoverMaterialization(root);
        const recovered = imported !== "none" || materialized;
        const result = { recovered, import: imported, materialization: materialized };
        process.stdout.write(json
            ? `${JSON.stringify(result, null, 2)}\n`
            : recovered
                ? "Recovered unfinished dotagents operations.\n"
                : "No unfinished operation found.\n");
        return 0;
    }
    if (command !== "inspect") {
        process.stderr.write(`Unknown command: ${command}\nRun dotagents --help.\n`);
        return 2;
    }
    const root = path.resolve(directory);
    const result = await scanLibrary(root);
    if (!result.ok) {
        if (json)
            process.stdout.write(`${JSON.stringify({ ok: false, issues: result.issues }, null, 2)}\n`);
        else
            for (const issue of result.issues)
                process.stderr.write(`${issue.message}\nNext: ${issue.remediation}\n`);
        return 1;
    }
    const summary = {
        ok: true,
        root: result.value.root,
        name: result.value.name,
        version: result.value.version,
        owned_skills: result.value.ownedSkills.length,
        owned_files: result.value.ownedSkills.reduce((sum, skill) => sum + skill.fileCount, 0),
        owned_bytes: result.value.ownedSkills.reduce((sum, skill) => sum + skill.bytes, 0),
        dependencies: result.value.dependencyCount,
        lockfile: result.value.locked,
    };
    process.stdout.write(json
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `${summary.name}@${summary.version}: ${summary.owned_skills} owned skills, ${summary.dependencies} dependencies${summary.lockfile ? ", locked" : ", no lockfile"}\n`);
    return 0;
}
process.exitCode = await main();
//# sourceMappingURL=cli.js.map