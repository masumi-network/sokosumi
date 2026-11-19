import { createHash } from "node:crypto";

/**
 * One account a sign-in reaches: a Page, or the person's own profile. `id`
 * names it within that sign-in only; the provider's account id never leaves
 * Core.
 */
export interface SocialAccountChoice {
  id: string;
  name: string;
  handle: string | null;
  kind: "page" | "profile";
}

/** The owner's pick among a sign-in's accounts, or whether to ask for one. */
export interface SocialAccountPick {
  /** A `SocialAccountChoice.id` the owner picked. */
  choiceId?: string;
  /** Core's own pick, such as the account a reconnect must keep. */
  externalAccountId?: string;
  offerChoice?: boolean;
}

/** The sign-in reaches several accounts and nobody picked one yet. */
export class SocialAccountChoiceRequiredError extends Error {
  constructor(readonly choices: SocialAccountChoice[]) {
    super("Pick the account to connect");
    this.name = "SocialAccountChoiceRequiredError";
  }
}

/** A choice's id: stable for one sign-in, meaningless outside it. */
export function socialAccountChoiceId(
  signIn: string,
  externalAccountId: string,
): string {
  return createHash("sha256")
    .update(`${signIn}\n${externalAccountId}`)
    .digest("base64url")
    .slice(0, 22);
}

/**
 * The account to connect: the picked one, the only one, or a request to pick
 * when `offerChoice` is set. Null when the caller must decide, or when the
 * pick is not one of this sign-in's accounts.
 */
export function pickSocialAccount<T extends { externalAccountId: string }>(
  signIn: string,
  accounts: readonly T[],
  pick: SocialAccountPick,
  describe: (account: T) => Omit<SocialAccountChoice, "id">,
): T | null {
  const picked = pick.choiceId
    ? (account: T) =>
        socialAccountChoiceId(signIn, account.externalAccountId) ===
        pick.choiceId
    : pick.externalAccountId
      ? (account: T) => account.externalAccountId === pick.externalAccountId
      : null;
  if (picked) return accounts.find(picked) ?? null;
  const [only, ...more] = accounts;
  if (only && more.length === 0) return only;
  if (only && pick.offerChoice) {
    throw new SocialAccountChoiceRequiredError(
      accounts.map((account) => ({
        id: socialAccountChoiceId(signIn, account.externalAccountId),
        ...describe(account),
      })),
    );
  }
  return null;
}
