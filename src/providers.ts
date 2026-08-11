import { z } from "zod";
import { credentialFreeGitRemote } from "./git-workspace.js";
import { computePlanId } from "./plan.js";

export const providerKindSchema = z.enum(["github", "gitlab", "generic"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const remoteConnectionSchema = z
  .object({ provider: providerKindSchema, remote: z.string().min(1), label: z.string().trim().min(1).max(80) })
  .strict()
  .transform((value) => ({ ...value, remote: credentialFreeGitRemote(value.remote).remote }));
export type RemoteConnection = z.output<typeof remoteConnectionSchema>;

export type ProviderLibraryCreationPlan = {
  kind: "provider-library-create";
  schemaVersion: 1;
  planId: string;
  provider: Exclude<ProviderKind, "generic">;
  name: string;
  visibility: "private" | "public";
};

function providerLibraryName(provider: Exclude<ProviderKind, "generic">, value: string): string {
  const name = value.trim();
  const valid =
    provider === "github"
      ? /^(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]{1,100}$/.test(name)
      : /^[A-Za-z0-9._-]{1,100}(?:\/[A-Za-z0-9._-]{1,100}){0,19}$/.test(name);
  if (!valid || name.split("/").some((segment) => segment === "." || segment === ".."))
    throw new Error(
      provider === "github"
        ? "GitHub library name must be `name` or `owner/name`"
        : "GitLab library name must be `name` or `group[/subgroup]/name`",
    );
  return name;
}

/** A no-network, deterministic review of the exact remote repository to create. */
export function planProviderLibraryCreation(
  provider: Exclude<ProviderKind, "generic">,
  name: string,
  visibility: "private" | "public" = "private",
): ProviderLibraryCreationPlan {
  const payload = {
    kind: "provider-library-create" as const,
    schemaVersion: 1 as const,
    provider,
    name: providerLibraryName(provider, name),
    visibility,
  };
  return { ...payload, planId: computePlanId(payload) };
}

export type GitHubDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
};

export type GitHubDeviceToken = { accessToken: string; tokenType: string; scope: string };

export type GitLabDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresIn: number;
  interval: number;
};

export type GitLabDeviceToken = { accessToken: string; tokenType: string; scope: string };

type GitHubDeviceResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
};

/**
 * Starts GitHub's OAuth Device Flow without depending on `gh`. Persistence is
 * deliberately left to the host: a CLI can keep nothing, while a desktop app
 * must put the resulting token in its OS-protected credential store.
 */
export async function startGitHubDeviceAuthorization(
  clientId: string,
  signal?: AbortSignal,
): Promise<GitHubDeviceAuthorization> {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "repo" }),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as GitHubDeviceResponse;
  if (!response.ok || !body.device_code || !body.user_code || !body.verification_uri || !body.expires_in) {
    throw new ProviderOperationError("unavailable", "GitHub could not start authorization.");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete ?? null,
    expiresIn: body.expires_in,
    interval: Math.max(5, body.interval ?? 5),
  };
}

/** Polls the device grant until it is authorized, expires, or is cancelled. */
export async function finishGitHubDeviceAuthorization(
  clientId: string,
  deviceCode: string,
  intervalSeconds = 5,
  signal?: AbortSignal,
): Promise<GitHubDeviceToken> {
  let interval = Math.max(5, intervalSeconds);
  for (;;) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval * 1000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      ...(signal ? { signal } : {}),
    });
    const body = (await response.json()) as GitHubDeviceResponse;
    if (body.access_token)
      return { accessToken: body.access_token, tokenType: body.token_type ?? "bearer", scope: body.scope ?? "" };
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (body.error === "expired_token")
      throw new ProviderOperationError("authentication", "GitHub authorization expired. Start again.");
    if (body.error === "access_denied")
      throw new ProviderOperationError("authentication", "GitHub authorization was declined.");
    throw new ProviderOperationError("unavailable", "GitHub could not complete authorization.");
  }
}

type GitLabDeviceResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
};

/** GitLab's native device flow, with no `glab` dependency. */
export async function startGitLabDeviceAuthorization(
  clientId: string,
  signal?: AbortSignal,
): Promise<GitLabDeviceAuthorization> {
  const response = await fetch("https://gitlab.com/oauth/authorize_device", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "api write_repository" }),
    ...(signal ? { signal } : {}),
  });
  const body = (await response.json()) as GitLabDeviceResponse;
  if (!response.ok || !body.device_code || !body.user_code || !body.verification_uri || !body.expires_in)
    throw new ProviderOperationError("unavailable", "GitLab could not start authorization.");
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete ?? null,
    expiresIn: body.expires_in,
    interval: Math.max(5, body.interval ?? 5),
  };
}

/** Polls GitLab's Device Authorization Grant until completion or cancellation. */
export async function finishGitLabDeviceAuthorization(
  clientId: string,
  deviceCode: string,
  intervalSeconds = 5,
  signal?: AbortSignal,
): Promise<GitLabDeviceToken> {
  let interval = Math.max(5, intervalSeconds);
  for (;;) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval * 1000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
    const response = await fetch("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      ...(signal ? { signal } : {}),
    });
    const body = (await response.json()) as GitLabDeviceResponse;
    if (body.access_token)
      return { accessToken: body.access_token, tokenType: body.token_type ?? "bearer", scope: body.scope ?? "" };
    if (body.error === "authorization_pending") continue;
    if (body.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (body.error === "expired_token")
      throw new ProviderOperationError("authentication", "GitLab authorization expired. Start again.");
    if (body.error === "access_denied")
      throw new ProviderOperationError("authentication", "GitLab authorization was declined.");
    throw new ProviderOperationError("unavailable", "GitLab could not complete authorization.");
  }
}

export type ProviderFailureKind =
  | "authentication"
  | "unavailable"
  | "conflict"
  | "permission"
  | "created-unresolved"
  | "unknown";

export class ProviderOperationError extends Error {
  readonly name = "ProviderOperationError";
  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
  ) {
    super(message);
  }
}

/** Classify provider failures without forwarding CLI output or credentials. */
export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  if (error instanceof ProviderOperationError) return error.kind;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/\b(already exists|name (?:is )?already taken|has already been taken|repository exists)\b/.test(message))
    return "conflict";
  if (
    /\b(not logged in|not authenticated|no authenticated|authentication required|unauthorized|auth login|401)\b/.test(
      message,
    )
  )
    return "authentication";
  if (/\b(forbidden|permission denied|insufficient scope|not allowed|403)\b/.test(message)) return "permission";
  if (
    /\b(timed? out|timeout|could not resolve|connection refused|network|unable to connect|failed to connect|service unavailable|502|503|504)\b/.test(
      message,
    )
  )
    return "unavailable";
  return "unknown";
}

type GithubRepository = {
  full_name?: string;
  ssh_url?: string;
  clone_url?: string;
  archived?: boolean;
  disabled?: boolean;
  permissions?: { push?: boolean };
};

export type GitHubRepositoryPreflight = {
  status: "available" | "conflict";
  owner: string;
  repository: string;
  account: string;
};

type GitHubUser = { login?: string };
type GitHubOrganizationMembership = { state?: string };

/**
 * GitHub's HTTP API counterpart to the CLI adapter.  The host owns the token
 * lifecycle; this class deliberately neither persists nor exposes it.
 */
export class GitHubTokenProviderAdapter {
  readonly kind = "github" as const;

  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async api(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.accessToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...init.headers,
        },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ProviderOperationError("unavailable", "GitHub could not be reached.");
    }
    return response;
  }

  private static async errorKind(response: Response): Promise<ProviderFailureKind> {
    if (response.status === 401) return "authentication";
    if (response.status === 403) return "permission";
    if (response.status === 404) return "permission";
    if (response.status === 409 || response.status === 422) return "conflict";
    if (response.status >= 500) return "unavailable";
    return "unknown";
  }

  private async require(response: Response, message: string): Promise<Response> {
    if (response.ok) return response;
    throw new ProviderOperationError(await GitHubTokenProviderAdapter.errorKind(response), message);
  }

  async checkConnection(signal?: AbortSignal): Promise<{ account: string }> {
    const response = await this.require(await this.api("/user", {}, signal), "GitHub could not verify this account.");
    const body = (await response.json()) as GitHubUser;
    return { account: providerAccount(body.login ?? "") };
  }

  private async resolveOwner(
    name: string,
    signal?: AbortSignal,
  ): Promise<{ account: string; owner: string; repository: string }> {
    const account = (await this.checkConnection(signal)).account;
    const segments = name.split("/");
    const repository = segments.at(-1);
    if (!repository) throw new ProviderOperationError("unknown", "GitHub repository name could not be resolved.");
    const explicitOwner = segments.length === 2 ? segments[0] : null;
    return { account, owner: explicitOwner ?? account, repository };
  }

  async preflightLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<GitHubRepositoryPreflight> {
    const current = planProviderLibraryCreation("github", plan.name, plan.visibility);
    if (plan.provider !== "github" || current.planId !== plan.planId)
      throw new Error("GitHub library name or visibility changed after review. Review it again.");
    const resolved = await this.resolveOwner(current.name, signal);
    if (resolved.owner !== resolved.account) {
      const membership = await this.api(`/user/memberships/orgs/${encodeURIComponent(resolved.owner)}`, {}, signal);
      const membershipBody = membership.ok ? ((await membership.json()) as GitHubOrganizationMembership) : null;
      if (!membership.ok || membershipBody?.state !== "active") {
        throw new ProviderOperationError(
          membership.status === 401 ? "authentication" : "permission",
          "The connected GitHub account cannot create repositories in this organization.",
        );
      }
    }
    const response = await this.api(
      `/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repository)}`,
      {},
      signal,
    );
    if (response.status === 404) return { status: "available", ...resolved };
    if (response.ok) return { status: "conflict", ...resolved };
    throw new ProviderOperationError(
      await GitHubTokenProviderAdapter.errorKind(response),
      "GitHub could not check this repository name.",
    );
  }

  async listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]> {
    const libraries: RemoteConnection[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.require(
        await this.api(
          `/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`,
          {},
          signal,
        ),
        "GitHub could not list your repositories.",
      );
      const batch = (await response.json()) as GithubRepository[];
      if (!Array.isArray(batch))
        throw new ProviderOperationError("unknown", "GitHub returned an invalid repository list.");
      for (const entry of batch) {
        const remote = entry.ssh_url ?? entry.clone_url;
        if (entry.archived || entry.disabled || !entry.permissions?.push || !remote || !entry.full_name) continue;
        libraries.push(validateRemoteConnection({ provider: "github", label: entry.full_name, remote }));
      }
      if (batch.length < 100) break;
    }
    return libraries;
  }

  async createLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<RemoteConnection> {
    const preflight = await this.preflightLibrary(plan, signal);
    if (preflight.status === "conflict")
      throw new ProviderOperationError("conflict", "This GitHub repository name is already in use.");
    const path =
      preflight.owner === preflight.account ? "/user/repos" : `/orgs/${encodeURIComponent(preflight.owner)}/repos`;
    const response = await this.require(
      await this.api(
        path,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: preflight.repository, private: plan.visibility === "private", has_wiki: false }),
        },
        signal,
      ),
      "GitHub could not create this repository.",
    );
    const created = (await response.json()) as GithubRepository;
    // OAuth can authenticate HTTPS Git without placing a token in the remote.
    // Prefer it over SSH so a fresh machine does not also need an SSH key.
    const remote = created.clone_url ?? created.ssh_url;
    if (!remote || !created.full_name)
      throw new ProviderOperationError(
        "created-unresolved",
        "The GitHub repository was created, but its address could not be confirmed.",
      );
    return validateRemoteConnection({ provider: "github", label: created.full_name, remote });
  }
}

type GitLabUser = { username?: string };
type GitLabProject = {
  id?: number;
  path_with_namespace?: string;
  http_url_to_repo?: string;
  archived?: boolean;
};
type GitLabNamespace = { id?: number; full_path?: string };

export type GitLabProjectPreflight = {
  status: "available" | "conflict";
  account: string;
  namespace: string | null;
  project: string;
  namespaceId: number | null;
};

/** Token-backed GitLab adapter for native desktop OAuth clients. */
export class GitLabTokenProviderAdapter {
  readonly kind = "gitlab" as const;
  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async api(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`https://gitlab.com/api/v4${path}`, {
        ...init,
        headers: { Accept: "application/json", Authorization: `Bearer ${this.accessToken}`, ...init.headers },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ProviderOperationError("unavailable", "GitLab could not be reached.");
    }
    return response;
  }

  private static async errorKind(response: Response): Promise<ProviderFailureKind> {
    if (response.status === 401) return "authentication";
    if (response.status === 403) return "permission";
    if (response.status === 409 || response.status === 422) return "conflict";
    if (response.status >= 500) return "unavailable";
    return "unknown";
  }

  private async require(response: Response, message: string): Promise<Response> {
    if (response.ok) return response;
    throw new ProviderOperationError(await GitLabTokenProviderAdapter.errorKind(response), message);
  }

  async checkConnection(signal?: AbortSignal): Promise<{ account: string }> {
    const response = await this.require(await this.api("/user", {}, signal), "GitLab could not verify this account.");
    const body = (await response.json()) as GitLabUser;
    return { account: providerAccount(body.username ?? "") };
  }

  async preflightLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<GitLabProjectPreflight> {
    const current = planProviderLibraryCreation("gitlab", plan.name, plan.visibility);
    if (plan.provider !== "gitlab" || current.planId !== plan.planId)
      throw new Error("GitLab project name or visibility changed after review. Review it again.");
    const account = (await this.checkConnection(signal)).account;
    const segments = current.name.split("/");
    const project = segments.at(-1);
    if (!project) throw new ProviderOperationError("unknown", "GitLab needs a repository name.");
    const namespace = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    let namespaceId: number | null = null;
    if (namespace) {
      const response = await this.require(
        await this.api(`/namespaces?search=${encodeURIComponent(namespace)}`, {}, signal),
        "GitLab could not check this group.",
      );
      const matches = (await response.json()) as GitLabNamespace[];
      const match = matches.find((entry) => entry.full_path === namespace);
      if (!match?.id)
        throw new ProviderOperationError(
          "permission",
          "The connected GitLab account cannot create projects in this group.",
        );
      namespaceId = match.id;
    }
    const existing = await this.api(`/projects/${encodeURIComponent(current.name)}`, {}, signal);
    if (existing.ok) return { status: "conflict", account, namespace, project, namespaceId };
    if (existing.status !== 404)
      throw new ProviderOperationError(
        await GitLabTokenProviderAdapter.errorKind(existing),
        "GitLab could not check this project name.",
      );
    return { status: "available", account, namespace, project, namespaceId };
  }

  async listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]> {
    const libraries: RemoteConnection[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.require(
        await this.api(`/projects?membership=true&per_page=100&page=${page}`, {}, signal),
        "GitLab could not list your projects.",
      );
      const batch = (await response.json()) as GitLabProject[];
      if (!Array.isArray(batch))
        throw new ProviderOperationError("unknown", "GitLab returned an invalid project list.");
      for (const entry of batch) {
        if (entry.archived || !entry.http_url_to_repo || !entry.path_with_namespace) continue;
        libraries.push(
          validateRemoteConnection({
            provider: "gitlab",
            label: entry.path_with_namespace,
            remote: entry.http_url_to_repo,
          }),
        );
      }
      if (batch.length < 100) break;
    }
    return libraries;
  }

  async createLibrary(plan: ProviderLibraryCreationPlan, signal?: AbortSignal): Promise<RemoteConnection> {
    const preflight = await this.preflightLibrary(plan, signal);
    if (preflight.status === "conflict")
      throw new ProviderOperationError("conflict", "This GitLab project name is already in use.");
    const response = await this.require(
      await this.api(
        "/projects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: preflight.project,
            visibility: plan.visibility,
            ...(preflight.namespaceId ? { namespace_id: preflight.namespaceId } : {}),
          }),
        },
        signal,
      ),
      "GitLab could not create this project.",
    );
    const created = (await response.json()) as GitLabProject;
    if (!created.http_url_to_repo || !created.path_with_namespace)
      throw new ProviderOperationError(
        "created-unresolved",
        "The GitLab project was created, but its address could not be confirmed.",
      );
    return validateRemoteConnection({
      provider: "gitlab",
      label: created.path_with_namespace,
      remote: created.http_url_to_repo,
    });
  }
}
function providerAccount(input: string): string {
  const account = input.trim();
  const hasControlCharacter = [...account].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!account || account.length > 200 || hasControlCharacter)
    throw new ProviderOperationError("unknown", "The connected provider account could not be identified.");
  return account;
}

/* Removed legacy gh/glab command adapters. Native Device Flow is the only provider path. */
/*
type GitlabRepository = {
  path_with_namespace?: string;
  ssh_url_to_repo?: string;
  http_url_to_repo?: string;
  archived?: boolean;
};

function jsonArray(input: string): unknown[] {
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("Provider returned an invalid repository list");
  return parsed.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

function providerAccount(input: string): string {
  const account = input.trim();
  const hasControlCharacter = [...account].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!account || account.length > 200 || hasControlCharacter) {
    throw new ProviderOperationError("unknown", "The connected provider account could not be identified.");
  }
  return account;
}

export class GitHubProviderAdapter implements RemoteProviderAdapter {
  readonly kind = "github" as const;
  constructor(private readonly command: CommandPort = new NodeCommandPort()) {}
  async checkConnection(signal?: AbortSignal): Promise<{ account: string }> {
    const account = await this.command.run("gh", ["api", "user", "--jq", ".login"], signal ? { signal } : undefined);
    return { account: providerAccount(account) };
  }
  async signIn(signal?: AbortSignal): Promise<void> {
    await this.command.run(
      "gh",
      ["auth", "login", "--web", "--git-protocol", "https", "--skip-ssh-key"],
      signal ? { signal } : undefined,
    );
  }
  async listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]> {
    // This endpoint includes repositories the user owns, collaborates on, or
    // can access through an organization. Do not use `gh repo list @me`: it
    // omits much of the last two groups.
    const output = await this.command.run(
      "gh",
      ["api", "--paginate", "--slurp", "/user/repos?affiliation=owner,collaborator,organization_member&per_page=100"],
      signal ? { signal } : undefined,
    );
    return jsonArray(output)
      .map((entry) => entry as GithubRepository)
      .flatMap((entry) => {
        const remote = entry.ssh_url ?? entry.clone_url;
        if (entry.archived || entry.disabled || !entry.permissions?.push || !remote || !entry.full_name) return [];
        return [validateRemoteConnection({ provider: "github", label: entry.full_name, remote })];
      });
  }
  async createLibrary(plan: ProviderLibraryCreationPlan): Promise<RemoteConnection> {
    const current = planProviderLibraryCreation("github", plan.name, plan.visibility);
    if (plan.provider !== "github" || current.planId !== plan.planId)
      throw new Error("GitHub library name or visibility changed after review. Review it again.");
    await this.command.run("gh", ["repo", "create", current.name, `--${current.visibility}`, "--disable-wiki"]);
    let remote: string;
    try {
      remote = await this.command.run("gh", ["repo", "view", current.name, "--json", "sshUrl", "--jq", ".sshUrl"]);
    } catch {
      throw new ProviderOperationError(
        "created-unresolved",
        "The GitHub repository was created, but its address could not be confirmed.",
      );
    }
    return validateRemoteConnection({ provider: "github", label: current.name, remote: remote.trim() });
  }
}

export class GitLabProviderAdapter implements RemoteProviderAdapter {
  readonly kind = "gitlab" as const;
  constructor(private readonly command: CommandPort = new NodeCommandPort()) {}
  async checkConnection(signal?: AbortSignal): Promise<{ account: string }> {
    const account = await this.command.run(
      "glab",
      ["api", "user", "--jq", ".username"],
      signal ? { signal } : undefined,
    );
    return { account: providerAccount(account) };
  }
  async signIn(signal?: AbortSignal): Promise<void> {
    await this.command.run("glab", ["auth", "login", "--web"], signal ? { signal } : undefined);
  }
  async listLibraries(signal?: AbortSignal): Promise<RemoteConnection[]> {
    // `glab repo list` explicitly paginates. Keep asking until the final short
    // page so saved connections are discoverable even for large organizations.
    const repositories: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const output = await this.command.run(
        "glab",
        ["repo", "list", "--member", "--output", "json", "--per-page", "100", "--page", String(page)],
        signal ? { signal } : undefined,
      );
      const batch = jsonArray(output);
      repositories.push(...batch);
      if (batch.length < 100) break;
    }
    const seen = new Set<string>();
    return repositories
      .map((entry) => entry as GitlabRepository)
      .flatMap((entry) => {
        const remote = entry.ssh_url_to_repo ?? entry.http_url_to_repo;
        if (entry.archived || !remote || !entry.path_with_namespace) return [];
        const connection = validateRemoteConnection({ provider: "gitlab", label: entry.path_with_namespace, remote });
        if (seen.has(connection.remote)) return [];
        seen.add(connection.remote);
        return [connection];
      });
  }
  async createLibrary(plan: ProviderLibraryCreationPlan): Promise<RemoteConnection> {
    const current = planProviderLibraryCreation("gitlab", plan.name, plan.visibility);
    if (plan.provider !== "gitlab" || current.planId !== plan.planId)
      throw new Error("GitLab library name or visibility changed after review. Review it again.");
    await this.command.run("glab", ["repo", "create", current.name, `--${current.visibility}`, "--skipGitInit"]);
    let remote: string;
    try {
      remote = await this.command.run("glab", [
        "repo",
        "view",
        current.name,
        "--output",
        "json",
        "--jq",
        ".ssh_url_to_repo",
      ]);
    } catch {
      throw new ProviderOperationError(
        "created-unresolved",
        "The GitLab project was created, but its address could not be confirmed.",
      );
    }
    return validateRemoteConnection({ provider: "gitlab", label: current.name, remote: remote.trim() });
  }
}

export function createProviderAdapter(
  kind: Exclude<ProviderKind, "generic">,
  command?: CommandPort,
): RemoteProviderAdapter {
  return kind === "github" ? new GitHubProviderAdapter(command) : new GitLabProviderAdapter(command);
}

*/

export function validateRemoteConnection(value: unknown): RemoteConnection {
  return remoteConnectionSchema.parse(value);
}
