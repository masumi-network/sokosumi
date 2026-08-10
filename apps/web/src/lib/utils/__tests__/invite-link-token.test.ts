import { describe, expect, it } from "vitest";

import { parseOrganizationInviteToken } from "../invite-link-token";

const TOKEN = "TJtnWS1AM_0J7cIZUcHD_k63W955Mmna";

describe("parseOrganizationInviteToken", () => {
  it("reads the token out of a full invite URL", () => {
    expect(
      parseOrganizationInviteToken(`https://app.sokosumi.com/join/${TOKEN}`),
    ).toBe(TOKEN);
  });

  it("accepts the bare token", () => {
    expect(parseOrganizationInviteToken(TOKEN)).toBe(TOKEN);
  });

  it("tolerates the mess that comes with a real paste", () => {
    expect(
      parseOrganizationInviteToken(
        `  https://app.sokosumi.com/join/${TOKEN}/?utm_source=slack#top  `,
      ),
    ).toBe(TOKEN);
  });

  it("accepts links from preview and staging hosts", () => {
    // The token is the capability; which deployment minted it is irrelevant.
    expect(
      parseOrganizationInviteToken(
        `https://preprod.sokosumi.com/join/${TOKEN}`,
      ),
    ).toBe(TOKEN);
    expect(
      parseOrganizationInviteToken(`http://localhost:3000/join/${TOKEN}`),
    ).toBe(TOKEN);
  });

  it("accepts a pasted path fragment", () => {
    expect(parseOrganizationInviteToken(`/join/${TOKEN}`)).toBe(TOKEN);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parseOrganizationInviteToken("")).toBeNull();
    expect(parseOrganizationInviteToken("   ")).toBeNull();
  });

  it("rejects input that is not a token", () => {
    expect(
      parseOrganizationInviteToken("https://app.sokosumi.com/"),
    ).toBeNull();
    expect(parseOrganizationInviteToken("not a link at all")).toBeNull();
    expect(
      parseOrganizationInviteToken("https://example.com/join/"),
    ).toBeNull();
  });

  it("rejects a token carrying characters the format does not use", () => {
    expect(
      parseOrganizationInviteToken("https://app.sokosumi.com/join/tok en"),
    ).toBeNull();
    expect(parseOrganizationInviteToken("tok/../../etc")).toBeNull();
  });
});
