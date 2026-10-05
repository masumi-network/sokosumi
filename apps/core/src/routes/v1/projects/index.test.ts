import { describe, expect, it } from "vitest";

import projectsRouter from "./index.js";

const PROJECTS_BASE_PATH = "/v1/projects";

const SOCIAL_CONNECTION_OPERATIONS = [
  {
    path: `${PROJECTS_BASE_PATH}/{id}/social-connections`,
    method: "get",
    responseStatuses: ["200", "401", "403", "404", "409", "422", "500", "503"],
  },
  {
    path: `${PROJECTS_BASE_PATH}/{id}/social-connections/initiate`,
    method: "post",
    responseStatuses: [
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "422",
      "500",
      "503",
    ],
  },
  {
    path: `${PROJECTS_BASE_PATH}/{id}/social-connections/finalize`,
    method: "post",
    responseStatuses: [
      "201",
      "400",
      "401",
      "403",
      "404",
      "409",
      "422",
      "500",
      "503",
    ],
  },
  {
    path: `${PROJECTS_BASE_PATH}/{id}/social-connections/{connectionId}`,
    method: "delete",
    responseStatuses: ["200", "401", "403", "404", "409", "422", "500", "503"],
  },
] as const;

const AD_OPERATIONS = [
  ["get", "/ads/accounts", ["200", "401", "403", "404"]],
  ["post", "/ads/accounts", ["200", "400", "403", "404", "502", "503"]],
  ["delete", "/ads/accounts/{accountId}", ["204", "403", "404", "502"]],
  [
    "get",
    "/ads/accounts/{accountId}/campaigns",
    ["200", "403", "404", "409", "502"],
  ],
  [
    "patch",
    "/ads/accounts/{accountId}/campaigns/{campaignId}",
    ["204", "403", "404", "409", "422", "502"],
  ],
  [
    "post",
    "/ads/accounts/{accountId}/campaigns",
    ["201", "403", "404", "409", "422", "502"],
  ],
  ["post", "/ads/connections/initiate", ["201", "403", "404", "502", "503"]],
  ["post", "/ads/connections/finalize", ["200", "403", "404", "502", "503"]],
] as const;

const FORBIDDEN_CONTRACT_FIELDS = [
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "sessionUri",
  "session_uri",
  "sessionToken",
  "session_token",
  "composioConnectedAccountId",
  "externalAccountId",
  "connectorUserId",
  "authConfigId",
  "rawProvider",
  "rawProviderResponse",
];

function expandSchemaReferences(
  value: unknown,
  schemas: Record<string, unknown>,
  seenReferences = new Set<string>(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      expandSchemaReferences(item, schemas, seenReferences),
    );
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const reference = record.$ref;
  if (
    typeof reference === "string" &&
    reference.startsWith("#/components/schemas/") &&
    !seenReferences.has(reference)
  ) {
    seenReferences.add(reference);
    const schemaName = reference.slice("#/components/schemas/".length);
    return {
      ...record,
      resolvedSchema: expandSchemaReferences(
        schemas[schemaName],
        schemas,
        seenReferences,
      ),
    };
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      expandSchemaReferences(item, schemas, seenReferences),
    ]),
  );
}

describe("projects routes OpenAPI contract", () => {
  it("mounts credential-free Project social connection operations", () => {
    const document = projectsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Projects API", version: "1.0.0" },
    });
    const schemas: Record<string, unknown> = document.components?.schemas ?? {};

    for (const operationContract of SOCIAL_CONNECTION_OPERATIONS) {
      const documentPath = operationContract.path.replace(
        PROJECTS_BASE_PATH,
        "",
      );
      const operation =
        document.paths?.[documentPath]?.[operationContract.method];

      expect(
        operation,
        `${operationContract.method.toUpperCase()} ${operationContract.path} is mounted`,
      ).toBeDefined();
      expect(operation?.responses).toEqual(
        expect.objectContaining(
          Object.fromEntries(
            operationContract.responseStatuses.map((status) => [
              status,
              expect.anything(),
            ]),
          ),
        ),
      );

      const serializedContract = JSON.stringify(
        expandSchemaReferences(operation, schemas),
      );
      for (const field of FORBIDDEN_CONTRACT_FIELDS) {
        expect(serializedContract).not.toContain(`"${field}"`);
      }
    }
  });

  it("mounts the Project ad account operations", () => {
    const document = projectsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Projects API", version: "1.0.0" },
    });
    for (const [method, path, statuses] of AD_OPERATIONS) {
      const operation = document.paths?.[`/{id}${path}`]?.[method];
      expect(
        operation,
        `${method.toUpperCase()} ${path} is mounted`,
      ).toBeDefined();
      expect(operation?.responses).toEqual(
        expect.objectContaining(
          Object.fromEntries(statuses.map((s) => [s, expect.anything()])),
        ),
      );
    }
  });
});
