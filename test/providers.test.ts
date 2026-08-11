import { describe, expect, it } from "bun:test";
import {
  GitHubTokenProviderAdapter,
  GitLabTokenProviderAdapter,
  planProviderLibraryCreation,
  validateRemoteConnection,
} from "../src/providers.js";
import { providerGitEnvironment } from "../src/provider-session.js";

describe("provider connections", () => {
  it("accepts credential-free remotes only", () => {
    expect(
      validateRemoteConnection({ provider: "gitlab", label: "Work", remote: "git@gitlab.example:team/library.git" }),
    ).toEqual({ provider: "gitlab", label: "Work", remote: "git@gitlab.example:team/library.git" });
    expect(() =>
      validateRemoteConnection({
        provider: "generic",
        label: "Unsafe",
        remote: "https://user:token@example.com/library.git",
      }),
    ).toThrow("credentials");
  });

  it("passes an OAuth token to Git only through a one-process HTTP header", () => {
    const environment = providerGitEnvironment("github", "token-value");
    expect(environment.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(environment.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${Buffer.from("x-access-token:token-value", "utf8").toString("base64")}`,
    );
  });

  it("preflights a GitHub name with the connected account before creating anything", async () => {
    const request = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return Response.json({ login: "octocat" });
      if (url.includes("/memberships/orgs/team")) return Response.json({ state: "active" });
      if (url.endsWith("/repos/team/agent-library")) return new Response(null, { status: 404 });
      return new Response(null, { status: 500 });
    }) as typeof fetch;
    await expect(
      new GitHubTokenProviderAdapter("test-token", request).preflightLibrary(
        planProviderLibraryCreation("github", "team/agent-library"),
      ),
    ).resolves.toMatchObject({ status: "available", account: "octocat", owner: "team", repository: "agent-library" });
  });

  it("preflights a GitLab group project with the OAuth token before creating anything", async () => {
    const request = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return Response.json({ username: "alex" });
      if (url.includes("/namespaces?search=team")) return Response.json([{ id: 7, full_path: "team" }]);
      if (url.endsWith("/projects/team%2Fagent-library")) return new Response(null, { status: 404 });
      return new Response(null, { status: 500 });
    }) as typeof fetch;
    await expect(
      new GitLabTokenProviderAdapter("test-token", request).preflightLibrary(
        planProviderLibraryCreation("gitlab", "team/agent-library"),
      ),
    ).resolves.toMatchObject({ status: "available", account: "alex", namespace: "team", project: "agent-library" });
  });
});
