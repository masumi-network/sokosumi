import { AgentEntryType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changesPointerDiscoveryIdentity,
  evaluateRevisionExposureGuard,
} from "./agent-sync.revision-guard";

const captureMessageMock = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({
  captureMessage: captureMessageMock,
}));

function surface(
  overrides: Partial<{
    type: AgentEntryType;
    apiBaseUrl: string | null;
    x402ResourcesUrl: string | null;
    openApiSpecUrl: string | null;
  }> = {},
) {
  return {
    type: AgentEntryType.STANDARD,
    apiBaseUrl: "https://example.com",
    x402ResourcesUrl: null,
    openApiSpecUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  captureMessageMock.mockClear();
});

describe("changesPointerDiscoveryIdentity", () => {
  it("fires when an X402 pointer swaps its discovery URL", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({
          type: AgentEntryType.X402,
          apiBaseUrl: null,
          x402ResourcesUrl: "https://seller.example.com/x402",
        }),
        surface({
          type: AgentEntryType.X402,
          apiBaseUrl: null,
          x402ResourcesUrl: "https://attacker.example.com/x402",
        }),
      ),
    ).toBe(true);
  });

  it("fires when an OpenAPI pointer swaps its spec URL", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({
          type: AgentEntryType.OPEN_API,
          openApiSpecUrl: "https://seller.example.com/spec.yaml",
        }),
        surface({
          type: AgentEntryType.OPEN_API,
          openApiSpecUrl: "https://attacker.example.com/spec.yaml",
        }),
      ),
    ).toBe(true);
  });

  it("fires when the entry type flips between pointer surfaces", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({
          type: AgentEntryType.X402,
          x402ResourcesUrl: "https://example.com/x402",
        }),
        surface({
          type: AgentEntryType.OPEN_API,
          openApiSpecUrl: "https://example.com/spec.yaml",
        }),
      ),
    ).toBe(true);
  });

  it("fires when a standard agent becomes a pointer entry", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface(),
        surface({
          type: AgentEntryType.X402,
          x402ResourcesUrl: "https://example.com/x402",
        }),
      ),
    ).toBe(true);
  });

  it("fires when a pointer entry becomes a standard agent", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({
          type: AgentEntryType.X402,
          x402ResourcesUrl: "https://example.com/x402",
        }),
        surface(),
      ),
    ).toBe(true);
  });

  it("stays quiet when the discovery identity is unchanged", () => {
    const fields = surface({
      type: AgentEntryType.X402,
      apiBaseUrl: null,
      x402ResourcesUrl: "https://example.com/x402",
    });
    expect(changesPointerDiscoveryIdentity(fields, { ...fields })).toBe(false);
  });

  it("stays quiet when a pointer merely gains a discovery URL", () => {
    // Mirrors the endpoint guard's add-carve-out: with no valid URL the
    // catalogs never listed the row, so there was nothing curated to hijack.
    expect(
      changesPointerDiscoveryIdentity(
        surface({ type: AgentEntryType.X402, x402ResourcesUrl: null }),
        surface({
          type: AgentEntryType.X402,
          x402ResourcesUrl: "https://example.com/x402",
        }),
      ),
    ).toBe(false);
  });

  it("stays quiet on standard-to-standard changes", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({ apiBaseUrl: "https://a.example.com" }),
        surface({ apiBaseUrl: "https://b.example.com" }),
      ),
    ).toBe(false);
  });

  it("stays quiet when unknown flips to standard", () => {
    expect(
      changesPointerDiscoveryIdentity(
        surface({ type: AgentEntryType.UNKNOWN }),
        surface(),
      ),
    ).toBe(false);
  });
});

describe("evaluateRevisionExposureGuard", () => {
  function existingX402(
    overrides: Partial<Parameters<typeof surface>[0]> & {
      isShown?: boolean;
      registryVersion?: number;
    } = {},
  ) {
    const { isShown, registryVersion, ...fields } = overrides;
    return {
      id: "agent-1",
      registryVersion: registryVersion ?? 1,
      isShown: isShown ?? true,
      ...surface({
        type: AgentEntryType.X402,
        apiBaseUrl: null,
        x402ResourcesUrl: "https://seller.example.com/x402",
        ...fields,
      }),
    };
  }

  it("unpublishes and pages on a same-version discovery URL swap", () => {
    // No revision promotion involved: the projection rewrites discovery
    // fields on every sync update, so the guard must not wait for one.
    const unpublish = evaluateRevisionExposureGuard({
      existing: existingX402(),
      incomingFields: surface({
        type: AgentEntryType.X402,
        apiBaseUrl: null,
        x402ResourcesUrl: "https://attacker.example.com/x402",
      }),
      registryIdentity: "identity-1",
      incomingRegistryVersion: 1,
    });
    expect(unpublish).toBe(true);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Agent revision changed its discovery identity; unpublishing pending review",
      expect.objectContaining({
        level: "error",
        tags: { error_type: "agent_revision_discovery_changed" },
      }),
    );
  });

  it("skips the page but still unpublishes an already-hidden row", () => {
    const unpublish = evaluateRevisionExposureGuard({
      existing: existingX402({ isShown: false }),
      incomingFields: surface({
        type: AgentEntryType.X402,
        apiBaseUrl: null,
        x402ResourcesUrl: "https://attacker.example.com/x402",
      }),
      registryIdentity: "identity-1",
      incomingRegistryVersion: 1,
    });
    expect(unpublish).toBe(true);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("keeps the endpoint guard's promotion gate intact", () => {
    const unpublish = evaluateRevisionExposureGuard({
      existing: {
        id: "agent-1",
        registryVersion: 1,
        isShown: true,
        ...surface({ apiBaseUrl: "https://seller.example.com" }),
      },
      incomingFields: surface({ apiBaseUrl: "https://attacker.example.com" }),
      registryIdentity: "identity-1",
      incomingRegistryVersion: 2,
    });
    expect(unpublish).toBe(true);
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Agent revision promotion changed the API endpoint; unpublishing pending review",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("does not treat a same-version endpoint refresh as a promotion", () => {
    const unpublish = evaluateRevisionExposureGuard({
      existing: {
        id: "agent-1",
        registryVersion: 1,
        isShown: true,
        ...surface({ apiBaseUrl: "https://seller.example.com" }),
      },
      incomingFields: surface({ apiBaseUrl: "https://attacker.example.com" }),
      registryIdentity: "identity-1",
      incomingRegistryVersion: 1,
    });
    expect(unpublish).toBe(false);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
