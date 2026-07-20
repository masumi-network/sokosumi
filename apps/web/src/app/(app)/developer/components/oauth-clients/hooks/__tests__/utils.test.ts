import { describe, expect, it } from "vitest";

import {
  formatRedirectUrisSummary,
  parseRedirectUris,
  redirectUrisToTextareaValue,
} from "@/app/developer/components/oauth-clients/utils";

describe("oauth-clients utils", () => {
  it("parseRedirectUris trims and filters blank lines", () => {
    expect(
      parseRedirectUris(
        " https://example.com/callback \n\nhttps://example.com/auth \n ",
      ),
    ).toEqual(["https://example.com/callback", "https://example.com/auth"]);
  });

  it("redirectUrisToTextareaValue joins URIs with newlines", () => {
    expect(
      redirectUrisToTextareaValue([
        "https://example.com/callback",
        "https://example.com/auth",
      ]),
    ).toBe("https://example.com/callback\nhttps://example.com/auth");
  });

  it("formatRedirectUrisSummary returns dash for empty URIs", () => {
    expect(formatRedirectUrisSummary([], (count) => `(+${count} more)`)).toBe(
      "—",
    );
  });

  it("formatRedirectUrisSummary returns single URI unchanged", () => {
    expect(
      formatRedirectUrisSummary(["https://example.com/callback"], () => ""),
    ).toBe("https://example.com/callback");
  });

  it("formatRedirectUrisSummary appends more label for multiple URIs", () => {
    expect(
      formatRedirectUrisSummary(
        [
          "https://example.com/callback",
          "https://example.com/auth",
          "https://example.com/other",
        ],
        (count) => `(+${count} more)`,
      ),
    ).toBe("https://example.com/callback (+2 more)");
  });
});
