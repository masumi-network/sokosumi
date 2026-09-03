import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { conflict, notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountDeleteProjectSocialConnection from "./[connectionId]/delete.js";
import mountFinalizeProjectSocialConnection from "./finalize/post.js";
import mountListProjectSocialConnections from "./get.js";
import mountInitiateProjectSocialConnection from "./initiate/post.js";

const {
  disconnectProjectSocialConnectionMock,
  finalizeProjectSocialConnectionMock,
  initiateProjectSocialConnectionMock,
  listProjectSocialConnectionsMock,
} = vi.hoisted(() => ({
  disconnectProjectSocialConnectionMock: vi.fn(),
  finalizeProjectSocialConnectionMock: vi.fn(),
  initiateProjectSocialConnectionMock: vi.fn(),
  listProjectSocialConnectionsMock: vi.fn(),
}));

vi.mock("@/services/project-social-connections.service", () => ({
  disconnectProjectSocialConnection: disconnectProjectSocialConnectionMock,
  finalizeProjectSocialConnection: finalizeProjectSocialConnectionMock,
  initiateProjectSocialConnection: initiateProjectSocialConnectionMock,
  listProjectSocialConnections: listProjectSocialConnectionsMock,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const SOCIAL_CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "ca_123";
const USER_ID = "user_123";

const SESSION_AUTH: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const USER_API_KEY_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "api_key",
};

const OAUTH_TOKEN_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "oauth",
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "vendor_123",
  context: { userId: USER_ID, organizationId: null },
};

const SOKO_BOT_CONTEXT_AUTH: AuthenticationContext = {
  actor: "sokoBot",
  sokoBotId: "bot_123",
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  organizationId: null,
};

const WORKSPACE_CONTEXT: WorkspaceContext = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  organizationId: null,
};

const connection = {
  id: SOCIAL_CONNECTION_ID,
  provider: "x",
  externalHandle: "sokosumi",
  status: "active",
  connectedAt: new Date("2026-09-03T10:00:00.000Z"),
  disconnectedAt: null,
};

function createApp(
  authContext: AuthenticationContext = SESSION_AUTH,
  workspaceContext: WorkspaceContext | null = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    await next();
  });

  mountListProjectSocialConnections(app);
  mountInitiateProjectSocialConnection(app);
  mountFinalizeProjectSocialConnection(app);
  mountDeleteProjectSocialConnection(app);

  return app;
}

describe("Project social connection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listProjectSocialConnectionsMock.mockResolvedValue([connection]);
    initiateProjectSocialConnectionMock.mockResolvedValue({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
    });
    finalizeProjectSocialConnectionMock.mockResolvedValue(connection);
    disconnectProjectSocialConnectionMock.mockResolvedValue({
      connection: { ...connection, status: "disconnected" },
      providerRevocation: "revoked",
    });
  });

  it("lists credential-free active connections for the current workspace", async () => {
    listProjectSocialConnectionsMock.mockResolvedValue([
      {
        ...connection,
        accessToken: "access_token",
        composioConnectedAccountId: "ca_internal",
      },
    ]);
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          id: SOCIAL_CONNECTION_ID,
          provider: "x",
          externalHandle: "sokosumi",
          status: "active",
          connectedAt: "2026-09-03T10:00:00.000Z",
          disconnectedAt: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("access_token");
    expect(JSON.stringify(body)).not.toContain("ca_internal");
    expect(listProjectSocialConnectionsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("uses only the session user and workspace when initiating a connection", async () => {
    initiateProjectSocialConnectionMock.mockResolvedValue({
      connectionId: CONNECTION_ID,
      redirectUrl: "https://connect.composio.dev/link-token",
      sessionUri: "https://composio.dev/session-secret",
    });
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections/initiate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          provider: "x",
          userId: "attacker",
          workspaceId: "44444444-4444-4444-8444-444444444444",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        connectionId: CONNECTION_ID,
        redirectUrl: "https://connect.composio.dev/link-token",
      },
    });
    expect(JSON.stringify(body)).not.toContain("session-secret");
    expect(initiateProjectSocialConnectionMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      action: "connect",
      provider: "x",
    });
  });

  it.each(["reconnect", "replace"] as const)(
    "passes a %s target without browser-supplied authority",
    async (action) => {
      const response = await createApp().request(
        `http://localhost/${PROJECT_ID}/social-connections/initiate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            socialConnectionId: SOCIAL_CONNECTION_ID,
            provider: "other",
            userId: "attacker",
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(initiateProjectSocialConnectionMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        action,
        provider: "x",
        socialConnectionId: SOCIAL_CONNECTION_ID,
      });
    },
  );

  it("finalizes only the opaque connection id after callback redemption", async () => {
    finalizeProjectSocialConnectionMock.mockResolvedValue({
      ...connection,
      accessToken: "access_token",
      authConfigId: "ac_internal",
      composioConnectedAccountId: "ca_internal",
      connectorUserId: "connector_internal",
      externalAccountId: "external_internal",
      sessionUri: "https://composio.dev/session-secret",
    });
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: CONNECTION_ID,
          sessionUri: "https://composio.dev/session-secret",
          userId: "attacker",
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: SOCIAL_CONNECTION_ID,
        provider: "x",
        externalHandle: "sokosumi",
        status: "active",
      },
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain("access_token");
    expect(serializedBody).not.toContain("ac_internal");
    expect(serializedBody).not.toContain("ca_internal");
    expect(serializedBody).not.toContain("connector_internal");
    expect(serializedBody).not.toContain("external_internal");
    expect(serializedBody).not.toContain("session-secret");
    expect(finalizeProjectSocialConnectionMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
  });

  it("returns a disconnected credential-free connection when provider revocation fails", async () => {
    disconnectProjectSocialConnectionMock.mockResolvedValue({
      connection: {
        ...connection,
        status: "disconnected",
        accessToken: "access_token",
        authConfigId: "ac_internal",
        composioConnectedAccountId: "ca_internal",
        connectorUserId: "connector_internal",
        externalAccountId: "external_internal",
        sessionUri: "https://composio.dev/session-secret",
      },
      providerRevocation: "failed",
    });
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections/${SOCIAL_CONNECTION_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: SOCIAL_CONNECTION_ID,
        provider: "x",
        status: "disconnected",
      },
    });
    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain("access_token");
    expect(serializedBody).not.toContain("ac_internal");
    expect(serializedBody).not.toContain("ca_internal");
    expect(serializedBody).not.toContain("connector_internal");
    expect(serializedBody).not.toContain("external_internal");
    expect(serializedBody).not.toContain("providerRevocation");
    expect(serializedBody).not.toContain("session-secret");
    expect(disconnectProjectSocialConnectionMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      socialConnectionId: SOCIAL_CONNECTION_ID,
    });
  });

  it.each([
    ["coworker", COWORKER_CONTEXT_AUTH],
    ["Soko Bot", SOKO_BOT_CONTEXT_AUTH],
    ["user API key", USER_API_KEY_AUTH],
    ["OAuth token", OAUTH_TOKEN_AUTH],
  ] as const)(
    "rejects %s before every social-connection operation",
    async (_name, auth) => {
      const app = createApp(auth);
      const requests = [
        app.request(`http://localhost/${PROJECT_ID}/social-connections`),
        app.request(
          `http://localhost/${PROJECT_ID}/social-connections/initiate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "connect", provider: "x" }),
          },
        ),
        app.request(
          `http://localhost/${PROJECT_ID}/social-connections/finalize`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connectionId: CONNECTION_ID }),
          },
        ),
        app.request(
          `http://localhost/${PROJECT_ID}/social-connections/${SOCIAL_CONNECTION_ID}`,
          { method: "DELETE" },
        ),
      ];

      const responses = await Promise.all(requests);
      expect(responses.map((response) => response.status)).toEqual([
        403, 403, 403, 403,
      ]);
      expect(listProjectSocialConnectionsMock).not.toHaveBeenCalled();
      expect(initiateProjectSocialConnectionMock).not.toHaveBeenCalled();
      expect(finalizeProjectSocialConnectionMock).not.toHaveBeenCalled();
      expect(disconnectProjectSocialConnectionMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing workspace and malformed route ids", async () => {
    const missingWorkspace = await createApp(SESSION_AUTH, null).request(
      `http://localhost/${PROJECT_ID}/social-connections`,
    );
    const malformedProject = await createApp().request(
      "http://localhost/not-a-uuid/social-connections",
    );
    const malformedConnection = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections/not-a-uuid`,
      { method: "DELETE" },
    );
    const unsupportedProvider = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections/initiate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", provider: "twitter" }),
      },
    );

    expect(missingWorkspace.status).toBe(403);
    expect(malformedProject.status).toBe(422);
    expect(malformedConnection.status).toBe(422);
    expect(unsupportedProvider.status).toBe(422);
    expect(initiateProjectSocialConnectionMock).not.toHaveBeenCalled();
  });

  it("returns not found when the Project is outside the current workspace", async () => {
    listProjectSocialConnectionsMock.mockRejectedValue(
      notFound("Project not found"),
    );
    const response = await createApp().request(
      `http://localhost/${PROJECT_ID}/social-connections`,
    );

    expect(response.status).toBe(404);
    expect(listProjectSocialConnectionsMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
  });

  it("returns lifecycle conflicts and unknown callback intents without leaking provider details", async () => {
    finalizeProjectSocialConnectionMock
      .mockRejectedValueOnce(notFound("Unknown or expired connection"))
      .mockRejectedValueOnce(
        conflict("This X account is already connected to the Project"),
      )
      .mockRejectedValueOnce(
        new ComposioApiError(
          500,
          { access_token: "provider-secret" },
          "provider-secret",
        ),
      );
    const app = createApp();
    const expired = await app.request(
      `http://localhost/${PROJECT_ID}/social-connections/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: CONNECTION_ID }),
      },
    );
    const duplicate = await app.request(
      `http://localhost/${PROJECT_ID}/social-connections/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: CONNECTION_ID }),
      },
    );
    const unavailable = await app.request(
      `http://localhost/${PROJECT_ID}/social-connections/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: CONNECTION_ID }),
      },
    );

    expect(expired.status).toBe(404);
    expect(duplicate.status).toBe(409);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("provider-secret");
  });
});
