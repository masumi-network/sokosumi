import { describe, expect, it } from "vitest";

import { withNetworkQuery } from "./network-link.js";

describe("withNetworkQuery", () => {
  it("names Mainnet on a relative link", () => {
    expect(withNetworkQuery("/agents/agent-1", "mainnet")).toBe(
      "/agents/agent-1?network=mainnet",
    );
  });

  it("keeps the query and fragment of an absolute link", () => {
    expect(
      withNetworkQuery(
        "https://example.com/agents/agent-1?tab=jobs&filter=a%2Fb#results?limit=2",
        "preprod",
      ),
    ).toBe(
      "https://example.com/agents/agent-1?tab=jobs&filter=a%2Fb&network=preprod#results?limit=2",
    );
  });

  it("inserts the query before a fragment on a path-relative link", () => {
    expect(withNetworkQuery("../agents/agent-1#jobs#recent", "preprod")).toBe(
      "../agents/agent-1?network=preprod#jobs#recent",
    );
  });

  it("replaces existing Network values with one value", () => {
    expect(
      withNetworkQuery(
        "/agents/agent-1?network=mainnet&tab=jobs&network=preprod",
        "preprod",
      ),
    ).toBe("/agents/agent-1?network=preprod&tab=jobs");
  });

  it("preserves the exact link when the Network is absent", () => {
    const link = "/tasks?filter=a%20b#results";
    expect(withNetworkQuery(link)).toBe(link);
    expect(withNetworkQuery(link, null)).toBe(link);
  });

  it("rejects an unsupported Network", () => {
    expect(() => {
      // @ts-expect-error Exercise an invalid runtime value.
      withNetworkQuery("/agents/agent-1", "preview");
    }).toThrow(RangeError);
  });
});
