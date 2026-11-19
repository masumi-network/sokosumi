import { beforeEach, describe, expect, it, vi } from "vitest";

const zernioRequest = vi.hoisted(() => vi.fn());
vi.mock("@/clients/zernio.client", () => ({ zernioRequest }));

import { socialAccountChoiceId } from "@/helpers/social-account-choice";
import { connectZernioLinkedInAccount } from "./zernio-linkedin-connection.service";

const PROFILE = "0123456789abcdef01234567";
const person = {
  id: "member-1",
  username: "Alice Doe",
  displayName: "Alice Doe",
};
const acme = {
  id: "42",
  urn: "urn:li:organization:42",
  name: "Acme",
  vanityName: "acme",
};
const signIn = {
  profileId: PROFILE,
  pendingDataToken: "pending-token",
  connectToken: "connect-token",
};
const choiceOf = (externalAccountId: string) =>
  socialAccountChoiceId(`zernio:${PROFILE}`, externalAccountId);

function pending(organizations: unknown[]) {
  return {
    platform: "linkedin",
    profileId: PROFILE,
    tempToken: "temp-token",
    userProfile: person,
    selectionType: "organizations",
    organizations,
  };
}

describe("connectZernioLinkedInAccount", () => {
  beforeEach(() => zernioRequest.mockReset());

  it("asks which account when the person administers a Page, Pages first", async () => {
    zernioRequest.mockResolvedValueOnce(pending([acme]));
    await expect(
      connectZernioLinkedInAccount({ ...signIn, pick: { offerChoice: true } }),
    ).rejects.toMatchObject({
      name: "SocialAccountChoiceRequiredError",
      choices: [
        {
          id: choiceOf("urn:li:organization:42"),
          name: "Acme",
          handle: "acme",
          kind: "page",
        },
        {
          id: choiceOf("member-1"),
          name: "Alice Doe",
          handle: "Alice Doe",
          kind: "profile",
        },
      ],
    });
    // Nothing is connected until the owner picked.
    expect(zernioRequest).toHaveBeenCalledTimes(1);
    expect(zernioRequest).toHaveBeenCalledWith(
      "/connect/pending-data?token=pending-token",
    );
  });

  it("connects the picked Page as an organization account", async () => {
    zernioRequest.mockResolvedValueOnce(pending([acme])).mockResolvedValueOnce({
      account: {
        accountId: "abcdef0123456789abcdef01",
        username: "acme",
        displayName: "Acme",
        profilePicture: "https://media.licdn.com/logo.png",
        accountType: "organization",
      },
    });
    await expect(
      connectZernioLinkedInAccount({
        ...signIn,
        pick: { choiceId: choiceOf(acme.urn), offerChoice: true },
      }),
    ).resolves.toEqual({
      connectedAccountId: "zernio:abcdef0123456789abcdef01",
      identity: {
        id: "urn:li:organization:42",
        handle: "acme",
        displayName: "Acme",
        avatarUrl: "https://media.licdn.com/logo.png",
        subscriptionType: null,
      },
    });
    expect(zernioRequest).toHaveBeenLastCalledWith(
      "/connect/linkedin/select-organization",
      {
        method: "POST",
        headers: { "X-Connect-Token": "connect-token" },
        body: {
          profileId: PROFILE,
          tempToken: "temp-token",
          userProfile: person,
          accountType: "organization",
          selectedOrganization: acme,
        },
      },
    );
  });

  it("connects the profile at once when the person administers no Page", async () => {
    zernioRequest.mockResolvedValueOnce(pending([])).mockResolvedValueOnce({
      account: {
        accountId: "abcdef0123456789abcdef01",
        accountType: "personal",
      },
    });
    const { identity } = await connectZernioLinkedInAccount({
      ...signIn,
      pick: { offerChoice: true },
    });
    expect(identity).toMatchObject({
      id: "member-1",
      displayName: "Alice Doe",
    });
    expect(zernioRequest.mock.calls[1][1].body).toMatchObject({
      accountType: "personal",
    });
    expect(zernioRequest.mock.calls[1][1].body).not.toHaveProperty(
      "selectedOrganization",
    );
  });

  it("refuses a pick the sign-in does not reach, and a sign-in of another profile", async () => {
    zernioRequest.mockResolvedValueOnce(pending([acme]));
    await expect(
      connectZernioLinkedInAccount({
        ...signIn,
        pick: { choiceId: choiceOf("urn:li:organization:999") },
      }),
    ).rejects.toMatchObject({ status: 409 });
    zernioRequest.mockResolvedValueOnce({
      ...pending([acme]),
      profileId: "ffffffffffffffffffffffff",
    });
    await expect(
      connectZernioLinkedInAccount({
        ...signIn,
        pick: { choiceId: choiceOf(acme.urn) },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(zernioRequest).toHaveBeenCalledTimes(2);
  });

  it("names each account by an id of this sign-in, never the provider's", async () => {
    zernioRequest.mockResolvedValueOnce(pending([acme]));
    const error = await connectZernioLinkedInAccount({
      ...signIn,
      pick: { offerChoice: true },
    }).catch((caught: unknown) => caught);
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("urn:li:organization:42");
    expect(serialized).not.toContain("member-1");
    // Another sign-in gives the same Page another id.
    expect(socialAccountChoiceId("zernio:other", acme.urn)).not.toBe(
      choiceOf(acme.urn),
    );
  });
});
