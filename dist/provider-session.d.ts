import { GitHubTokenProviderAdapter, GitLabTokenProviderAdapter, type ProviderKind } from "./providers.js";
/** Public OAuth client identifiers. They identify the application, not a user. */
export declare const GITHUB_DEVICE_FLOW_CLIENT_ID = "Ov23libd9NpS8gZKtLbE";
export declare const GITLAB_DEVICE_FLOW_CLIENT_ID = "9dee80d3aa4a816814c1153a11fbd2dac53b3f1a80b6e16f09d43424e418f1a9";
export type OAuthProvider = Exclude<ProviderKind, "generic">;
export type ProviderTokenStore = {
    get(provider: OAuthProvider, account: string): Promise<string | null>;
    set(provider: OAuthProvider, account: string, token: string): Promise<void>;
    remove(provider: OAuthProvider, account: string): Promise<void>;
};
/**
 * Tokens live only in the operating system credential vault. Connection files
 * keep a public account label and remote, never an OAuth token.
 */
export declare class KeyringProviderTokenStore implements ProviderTokenStore {
    private entry;
    get(provider: OAuthProvider, account: string): Promise<string | null>;
    set(provider: OAuthProvider, account: string, token: string): Promise<void>;
    remove(provider: OAuthProvider, account: string): Promise<void>;
}
export type ProviderSession = {
    provider: OAuthProvider;
    account: string;
    accessToken: string;
    adapter: GitHubTokenProviderAdapter | GitLabTokenProviderAdapter;
};
export declare function loadProviderSession(provider: OAuthProvider, account?: string, store?: ProviderTokenStore): Promise<ProviderSession | null>;
export type DeviceAuthorizationPresenter = {
    show(input: {
        provider: OAuthProvider;
        userCode: string;
        verificationUri: string;
    }): void | Promise<void>;
    openBrowser?(url: string): void | Promise<void>;
};
/** Connect once through the provider's native Device Flow, then reuse Keychain. */
export declare function connectProvider(provider: OAuthProvider, presenter: DeviceAuthorizationPresenter, store?: ProviderTokenStore, signal?: AbortSignal): Promise<ProviderSession>;
/** One-process-only Git auth. Neither the remote nor Git config receives the token. */
export declare function providerGitEnvironment(provider: OAuthProvider, accessToken: string): NodeJS.ProcessEnv;
//# sourceMappingURL=provider-session.d.ts.map