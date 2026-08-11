import { z } from "zod";
export declare const providerKindSchema: z.ZodEnum<["github", "gitlab", "generic"]>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export declare const remoteConnectionSchema: z.ZodEffects<z.ZodObject<{
    provider: z.ZodEnum<["github", "gitlab", "generic"]>;
    remote: z.ZodString;
    label: z.ZodString;
}, "strict", z.ZodTypeAny, {
    remote: string;
    provider: "github" | "gitlab" | "generic";
    label: string;
}, {
    remote: string;
    provider: "github" | "gitlab" | "generic";
    label: string;
}>, {
    remote: string;
    provider: "github" | "gitlab" | "generic";
    label: string;
}, {
    remote: string;
    provider: "github" | "gitlab" | "generic";
    label: string;
}>;
export type RemoteConnection = z.output<typeof remoteConnectionSchema>;
export type ProviderLibraryCreationPlan = {
    kind: "provider-library-create";
    schemaVersion: 1;
    planId: string;
    provider: Exclude<ProviderKind, "generic">;
    name: string;
    visibility: "private" | "public";
};
/** A no-network, deterministic review of the exact remote repository to create. */
export declare function planProviderLibraryCreation(provider: Exclude<ProviderKind, "generic">, name: string, visibility?: "private" | "public"): ProviderLibraryCreationPlan;
export type GitHubDeviceAuthorization = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string | null;
    expiresIn: number;
    interval: number;
};
export type GitHubDeviceToken = {
    accessToken: string;
    tokenType: string;
    scope: string;
};
export type GitLabDeviceAuthorization = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string | null;
    expiresIn: number;
    interval: number;
};
export type GitLabDeviceToken = {
    accessToken: string;
    tokenType: string;
    scope: string;
};
/**
 * Starts GitHub's OAuth Device Flow without depending on `gh`. Persistence is
 * deliberately left to the host: a CLI can keep nothing, while a desktop app
 * must put the resulting token in its OS-protected credential store.
 */
export declare function startGitHubDeviceAuthorization(clientId: string, signal?: AbortSignal): Promise<GitHubDeviceAuthorization>;
/** Polls the device grant until it is authorized, expires, or is cancelled. */
export declare function finishGitHubDeviceAuthorization(clientId: string, deviceCode: string, intervalSeconds?: number, signal?: AbortSignal): Promise<GitHubDeviceToken>;
/** GitLab's native device flow, with no `glab` dependency. */
export declare function startGitLabDeviceAuthorization(clientId: string, signal?: AbortSignal): Promise<GitLabDeviceAuthorization>;
/** Polls GitLab's Device Authorization Grant until completion or cancellation. */
export declare function finishGitLabDeviceAuthorization(clientId: string, deviceCode: string, intervalSeconds?: number, signal?: AbortSignal): Promise<GitLabDeviceToken>;
export type ProviderFailureKind = "authentication" | "unavailable" | "conflict" | "permission" | "created-unresolved" | "unknown";
export declare class ProviderOperationError extends Error {
    readonly kind: ProviderFailureKind;
    readonly name = "ProviderOperationError";
    constructor(kind: ProviderFailureKind, message: string);
}
/** Classify provider failures without forwarding CLI output or credentials. */
export declare function classifyProviderFailure(error: unknown): ProviderFailureKind;
export type GitHubRepositoryPreflight = {
    status: "available" | "conflict";
    owner: string;
    repository: string;
    account: string;
};
/**
 * GitHub's HTTP API counterpart to the CLI adapter.  The host owns the token
 * lifecycle; this class deliberately neither persists nor exposes it.
 */
export declare class GitHubTokenProviderAdapter {
    private readonly accessToken;
    private readonly request;
    readonly kind: "github";
    constructor(accessToken: string, request?: typeof fetch);
    private api;
    private static errorKind;
    private require;
    checkConnection(signal?: AbortSignal): Promise<{
        account: string;
    }>;
    private resolveOwner;
    preflightLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<GitHubRepositoryPreflight>;
    listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]>;
    createLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<RemoteConnection>;
}
export type GitLabProjectPreflight = {
    status: "available" | "conflict";
    account: string;
    namespace: string | null;
    project: string;
    namespaceId: number | null;
};
/** Token-backed GitLab adapter for native desktop OAuth clients. */
export declare class GitLabTokenProviderAdapter {
    private readonly accessToken;
    private readonly request;
    readonly kind: "gitlab";
    constructor(accessToken: string, request?: typeof fetch);
    private api;
    private static errorKind;
    private require;
    checkConnection(signal?: AbortSignal): Promise<{
        account: string;
    }>;
    preflightLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<GitLabProjectPreflight>;
    listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]>;
    createLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<RemoteConnection>;
}
export declare function validateRemoteConnection(value: unknown): RemoteConnection;
//# sourceMappingURL=providers.d.ts.map