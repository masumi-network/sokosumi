import { describe, expect, it } from "vitest";
import { getAgentLegal } from "@/lib/helpers/agent";

import { createMockCoreAgent } from "./fixtures/core-agent";

describe("getAgentLegal", () => {
  it("returns legal data when DPA is the only legal link", () => {
    const legal = getAgentLegal(
      createMockCoreAgent({
        legal: {
          privacyPolicy: null,
          terms: null,
          dpa: "https://example.com/dpa.pdf",
          other: null,
        },
      }),
    );

    expect(legal).toEqual({
      privacyPolicy: null,
      terms: null,
      dpa: "https://example.com/dpa.pdf",
      other: null,
    });
  });

  it("keeps existing legal behavior when DPA is absent", () => {
    const legal = getAgentLegal(
      createMockCoreAgent({
        legal: {
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: null,
          other: "https://example.com/legal",
        },
      }),
    );

    expect(legal).toEqual({
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
      dpa: null,
      other: "https://example.com/legal",
    });
  });
});
