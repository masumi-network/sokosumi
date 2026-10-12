import { describe, expect, it } from "vitest";

import {
  disconnectProjectSocialConnectionResponseSchema,
  finalizeProjectSocialConnectionRequestSchema,
  initiateProjectSocialConnectionRequestSchema,
  initiateProjectSocialConnectionResponseSchema,
  projectSocialConnectionParamsSchema,
  projectSocialConnectionSchema,
  projectSocialProviderSchema,
} from "./project-social-connection.schema";

const CONNECTION_ID = "bbbbbbbb-bbbb-4aaa-8aaa-bbbbbbbbbbbb";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const connection = {
  id: CONNECTION_ID,
  provider: "x",
  externalHandle: "sokosumi",
  displayName: "Sokosumi",
  avatarUrl: "https://example.com/avatar.jpg",
  status: "active",
  connectedAt: "2026-10-08T12:00:00.000Z",
  disconnectedAt: null,
};

describe("projectSocialProviderSchema", () => {
  it("accepts each project provider and rejects an unknown network", () => {
    expect(projectSocialProviderSchema.options.toSorted()).toEqual([
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "x",
      "youtube",
    ]);
    expect(() => projectSocialProviderSchema.parse("threads")).toThrow();
  });
});

describe("initiateProjectSocialConnectionRequestSchema", () => {
  it("accepts connect, reconnect, and replace", () => {
    expect(
      initiateProjectSocialConnectionRequestSchema.parse({
        action: "connect",
        provider: "linkedin",
      }),
    ).toEqual({ action: "connect", provider: "linkedin" });
    expect(
      initiateProjectSocialConnectionRequestSchema.parse({
        action: "reconnect",
        socialConnectionId: CONNECTION_ID,
      }),
    ).toEqual({ action: "reconnect", socialConnectionId: CONNECTION_ID });
    expect(
      initiateProjectSocialConnectionRequestSchema.parse({
        action: "replace",
        socialConnectionId: CONNECTION_ID,
      }),
    ).toEqual({ action: "replace", socialConnectionId: CONNECTION_ID });
  });

  it("rejects a connect without a provider and a reconnect without a uuid", () => {
    expect(() =>
      initiateProjectSocialConnectionRequestSchema.parse({ action: "connect" }),
    ).toThrow();
    expect(() =>
      initiateProjectSocialConnectionRequestSchema.parse({
        action: "reconnect",
        socialConnectionId: "not-a-uuid",
      }),
    ).toThrow();
    expect(() =>
      initiateProjectSocialConnectionRequestSchema.parse({
        action: "disconnect",
      }),
    ).toThrow();
  });
});

describe("initiateProjectSocialConnectionResponseSchema", () => {
  it("requires a connection id and an https redirect", () => {
    expect(
      initiateProjectSocialConnectionResponseSchema.parse({
        connectionId: "ca_123",
        redirectUrl: "https://connect.composio.dev/link-token",
      }),
    ).toMatchObject({ connectionId: "ca_123" });
    expect(() =>
      initiateProjectSocialConnectionResponseSchema.parse({
        connectionId: "",
        redirectUrl: "https://connect.composio.dev/link-token",
      }),
    ).toThrow();
    expect(() =>
      initiateProjectSocialConnectionResponseSchema.parse({
        connectionId: "ca_123",
        redirectUrl: "not-a-url",
      }),
    ).toThrow();
  });
});

describe("finalizeProjectSocialConnectionRequestSchema", () => {
  it("rejects a blank connection id", () => {
    expect(
      finalizeProjectSocialConnectionRequestSchema.parse({
        connectionId: "ca_123",
      }),
    ).toEqual({ connectionId: "ca_123" });
    expect(() =>
      finalizeProjectSocialConnectionRequestSchema.parse({ connectionId: "" }),
    ).toThrow();
  });
});

describe("projectSocialConnectionSchema", () => {
  it("accepts a stored account and rejects a bad status or avatar", () => {
    expect(projectSocialConnectionSchema.parse(connection).status).toBe(
      "active",
    );
    expect(() =>
      projectSocialConnectionSchema.parse({ ...connection, status: "ACTIVE" }),
    ).toThrow();
    expect(() =>
      projectSocialConnectionSchema.parse({
        ...connection,
        avatarUrl: "not-a-url",
      }),
    ).toThrow();
  });

  it("requires project and connection path ids to be uuids", () => {
    expect(
      projectSocialConnectionParamsSchema.parse({
        id: PROJECT_ID,
        connectionId: CONNECTION_ID,
      }),
    ).toEqual({ id: PROJECT_ID, connectionId: CONNECTION_ID });
    expect(() =>
      projectSocialConnectionParamsSchema.parse({
        id: "project",
        connectionId: CONNECTION_ID,
      }),
    ).toThrow();
  });
});

describe("disconnectProjectSocialConnectionResponseSchema", () => {
  it("requires a provider revocation outcome", () => {
    expect(
      disconnectProjectSocialConnectionResponseSchema.parse({
        ...connection,
        providerRevocation: "skipped",
      }).providerRevocation,
    ).toBe("skipped");
    expect(() =>
      disconnectProjectSocialConnectionResponseSchema.parse({
        ...connection,
        providerRevocation: "ok",
      }),
    ).toThrow();
  });
});
