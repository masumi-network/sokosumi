import { z } from "zod";
import { zernioRequest } from "@/clients/zernio.client";
import { conflict } from "@/helpers/error";
import { LINKEDIN_ORGANIZATION_URN_PREFIX } from "@/helpers/linkedin-person";
import {
  pickSocialAccount,
  type SocialAccountChoice,
  type SocialAccountPick,
} from "@/helpers/social-account-choice";

const userProfile = z.looseObject({
  id: z.string().min(1),
  username: z.string().nullish(),
  displayName: z.string().nullish(),
});
const organization = z.object({
  id: z.string().min(1),
  urn: z.string().startsWith(LINKEDIN_ORGANIZATION_URN_PREFIX),
  name: z.string().min(1),
  vanityName: z.string().nullish(),
});
const pendingData = z.object({
  platform: z.literal("linkedin"),
  profileId: z.string().min(1),
  tempToken: z.string().min(1),
  userProfile,
  organizations: z.array(organization).default([]),
});
const selected = z.object({
  account: z.object({
    accountId: z.string().min(1),
    username: z.string().nullish(),
    displayName: z.string().nullish(),
    profilePicture: z.string().nullish(),
  }),
});

type LinkedInAccount = Omit<SocialAccountChoice, "id"> & {
  externalAccountId: string;
  organization: z.infer<typeof organization> | null;
};

/** The sign-in's Pages first, then the person's own profile. */
function accountsOf(pending: z.infer<typeof pendingData>): LinkedInAccount[] {
  const person = pending.userProfile;
  return [
    ...pending.organizations.map((page) => ({
      externalAccountId: page.urn,
      name: page.name,
      handle: page.vanityName ?? null,
      kind: "page" as const,
      organization: page,
    })),
    {
      externalAccountId: person.id,
      name: person.displayName ?? person.username ?? "Your profile",
      handle: person.username ?? null,
      kind: "profile" as const,
      organization: null,
    },
  ];
}

function describe({
  name,
  handle,
  kind,
}: LinkedInAccount): Omit<SocialAccountChoice, "id"> {
  return { name, handle, kind };
}

export interface ZernioLinkedInSignIn {
  /** Our Zernio profile of this connection attempt. */
  profileId: string;
  /** Names the sign-in's token, profile and Pages at Zernio; good for an hour. */
  pendingDataToken: string;
  /** Lets an API caller finish the sign-in; good for fifteen minutes. */
  connectToken: string;
  /** The owner's pick, or Core's (the account a reconnect keeps). */
  pick: SocialAccountPick;
}

/**
 * Finishes a LinkedIn sign-in at Zernio as the picked Page or profile. Throws
 * `SocialAccountChoiceRequiredError` when the owner has to pick first.
 */
export async function connectZernioLinkedInAccount(
  input: ZernioLinkedInSignIn,
) {
  const pending = pendingData.parse(
    await zernioRequest(
      `/connect/pending-data?token=${encodeURIComponent(input.pendingDataToken)}`,
    ),
  );
  if (pending.profileId !== input.profileId) {
    throw conflict("LinkedIn sign-in does not belong to this connection");
  }
  const accounts = accountsOf(pending);
  const picked = Boolean(input.pick.choiceId || input.pick.externalAccountId);
  const account =
    pickSocialAccount(
      `zernio:${input.profileId}`,
      accounts,
      input.pick,
      describe,
    ) ??
    // No pick and no picker: the person's own profile, as before Pages.
    (picked ? null : accounts[accounts.length - 1]);
  if (!account) throw conflict("That LinkedIn account is not in this sign-in");

  const result = selected.parse(
    await zernioRequest("/connect/linkedin/select-organization", {
      method: "POST",
      headers: { "X-Connect-Token": input.connectToken },
      body: {
        profileId: pending.profileId,
        tempToken: pending.tempToken,
        userProfile: pending.userProfile,
        accountType: account.organization ? "organization" : "personal",
        ...(account.organization && {
          selectedOrganization: {
            id: account.organization.id,
            urn: account.organization.urn,
            name: account.organization.name,
            ...(account.organization.vanityName && {
              vanityName: account.organization.vanityName,
            }),
          },
        }),
      },
    }),
  ).account;
  return {
    connectedAccountId: `zernio:${result.accountId}`,
    identity: {
      id: account.externalAccountId,
      handle: result.username ?? account.handle,
      displayName: result.displayName ?? account.name,
      avatarUrl: result.profilePicture ?? null,
      subscriptionType: null,
    },
  };
}
