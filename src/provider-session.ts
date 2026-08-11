import { Entry } from "@napi-rs/keyring";
import {
  finishGitHubDeviceAuthorization,
  finishGitLabDeviceAuthorization,
  GitHubTokenProviderAdapter,
  GitLabTokenProviderAdapter,
  ProviderOperationError,
  startGitHubDeviceAuthorization,
  startGitLabDeviceAuthorization,
  type ProviderKind,
} from "./providers.js";

/** Public OAuth client identifiers. They identify the application, not a user. */
export const GITHUB_DEVICE_FLOW_CLIENT_ID = "Ov23libd9NpS8gZKtLbE";
export const GITLAB_DEVICE_FLOW_CLIENT_ID = "9dee80d3aa4a816814c1153a11fbd2dac53b3f1a80b6e16f09d43424e418f1a9";

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
export class KeyringProviderTokenStore implements ProviderTokenStore {
  private entry(provider: OAuthProvider, account: string): Entry {
    return new Entry(`dotagents:${provider}`, account);
  }

  async get(provider: OAuthProvider, account: string): Promise<string | null> {
    try {
      return this.entry(provider, account).getPassword() ?? null;
    } catch {
      return null;
    }
  }

  async set(provider: OAuthProvider, account: string, token: string): Promise<void> {
    try {
      this.entry(provider, account).setPassword(token);
    } catch (error) {
      throw new Error(
        `dotagents could not save the ${provider} connection in this system's credential store. ${error instanceof Error ? error.message : ""}`.trim(),
      );
    }
  }

  async remove(provider: OAuthProvider, account: string): Promise<void> {
    try {
      this.entry(provider, account).deletePassword();
    } catch {
      // A missing keychain entry is already the desired result.
    }
  }
}

export type ProviderSession = {
  provider: OAuthProvider;
  account: string;
  accessToken: string;
  adapter: GitHubTokenProviderAdapter | GitLabTokenProviderAdapter;
};

function adapterFor(provider: OAuthProvider, accessToken: string): ProviderSession["adapter"] {
  return provider === "github"
    ? new GitHubTokenProviderAdapter(accessToken)
    : new GitLabTokenProviderAdapter(accessToken);
}

export async function loadProviderSession(
  provider: OAuthProvider,
  account = "default",
  store: ProviderTokenStore = new KeyringProviderTokenStore(),
): Promise<ProviderSession | null> {
  for (const candidate of [...new Set([account, "default"])]) {
    const accessToken = await store.get(provider, candidate);
    if (!accessToken) continue;
    const adapter = adapterFor(provider, accessToken);
    try {
      const connected = await adapter.checkConnection();
      return { provider, account: connected.account, accessToken, adapter };
    } catch (error) {
      if (error instanceof ProviderOperationError && error.kind === "authentication") {
        await store.remove(provider, candidate);
        continue;
      }
      throw error;
    }
  }
  return null;
}

export type DeviceAuthorizationPresenter = {
  show(input: { provider: OAuthProvider; userCode: string; verificationUri: string }): void | Promise<void>;
  openBrowser?(url: string): void | Promise<void>;
};

/** Connect once through the provider's native Device Flow, then reuse Keychain. */
export async function connectProvider(
  provider: OAuthProvider,
  presenter: DeviceAuthorizationPresenter,
  store: ProviderTokenStore = new KeyringProviderTokenStore(),
  signal?: AbortSignal,
): Promise<ProviderSession> {
  const known = await loadProviderSession(provider, "default", store);
  if (known) return known;
  const authorization =
    provider === "github"
      ? await startGitHubDeviceAuthorization(GITHUB_DEVICE_FLOW_CLIENT_ID, signal)
      : await startGitLabDeviceAuthorization(GITLAB_DEVICE_FLOW_CLIENT_ID, signal);
  const verificationUri = authorization.verificationUriComplete ?? authorization.verificationUri;
  await presenter.show({ provider, userCode: authorization.userCode, verificationUri });
  await presenter.openBrowser?.(verificationUri);
  const token =
    provider === "github"
      ? await finishGitHubDeviceAuthorization(
          GITHUB_DEVICE_FLOW_CLIENT_ID,
          authorization.deviceCode,
          authorization.interval,
          signal,
        )
      : await finishGitLabDeviceAuthorization(
          GITLAB_DEVICE_FLOW_CLIENT_ID,
          authorization.deviceCode,
          authorization.interval,
          signal,
        );
  const adapter = adapterFor(provider, token.accessToken);
  const connected = await adapter.checkConnection(signal);
  await store.set(provider, "default", token.accessToken);
  await store.set(provider, connected.account, token.accessToken);
  return { provider, account: connected.account, accessToken: token.accessToken, adapter };
}

/** One-process-only Git auth. Neither the remote nor Git config receives the token. */
export function providerGitEnvironment(provider: OAuthProvider, accessToken: string): NodeJS.ProcessEnv {
  const host = provider === "github" ? "github.com" : "gitlab.com";
  const username = provider === "github" ? "x-access-token" : "oauth2";
  const basic = Buffer.from(`${username}:${accessToken}`, "utf8").toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    // Keep Git's canonical lower-case spelling. Git treats configuration keys
    // case-insensitively, but a stable form avoids two transport contracts for
    // the CLI and desktop app.
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}
