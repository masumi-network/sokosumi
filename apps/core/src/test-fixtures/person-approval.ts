import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { expect } from "vitest";

import type {
  AuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";

/**
 * Every credential an agent holds, for the person behind `person`. None of
 * them approves, publishes or sends (ADR 0077); only a browser session does.
 */
export function agentCredentials(
  person: UserAuthenticationContext,
): Array<[string, AuthenticationContext]> {
  return [
    ["an API key", { ...person, authenticationMethod: "api_key" }],
    [
      "a third-party OAuth token",
      { ...person, authenticationMethod: "oauth", oauthClientId: "client_x" },
    ],
    [
      "the MCP server's OAuth token",
      { ...person, authenticationMethod: "oauth", oauthClientId: "mcp_client" },
    ],
    [
      "a first-party OAuth token",
      { ...person, authenticationMethod: "oauth", firstPartyClient: true },
    ],
    [
      "a Coworker key",
      {
        actor: "coworker",
        coworkerId: "coworker_1",
        vendorId: "vendor_1",
        context: {
          userId: person.userId,
          organizationId: person.organizationId,
        },
      },
    ],
    [
      "a personal Soko Bot",
      {
        actor: "sokoBot",
        sokoBotId: "soko_bot_1",
        workspaceId: "workspace_1",
        scope: "personal",
        userId: person.userId,
        organizationId: person.organizationId,
      },
    ],
  ];
}

/** The 403 that sends an agent's user to the item in Sokosumi. */
export async function expectPersonApprovalRequired(
  response: Response,
  webUrl: string,
): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    message: "A person approves this in Sokosumi",
    kind: CORE_API_ERROR_KINDS.PERSON_APPROVAL_REQUIRED,
    webUrl,
  });
}
