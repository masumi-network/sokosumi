/** One account a sign-in reaches: a Page, or the person's own profile. */
export interface SocialAccountChoice {
  externalAccountId: string;
  name: string;
  handle: string | null;
  kind: "page" | "profile";
}

/** The sign-in reaches several accounts and nobody picked one yet. */
export class SocialAccountChoiceRequiredError extends Error {
  constructor(readonly choices: SocialAccountChoice[]) {
    super("Pick the account to connect");
    this.name = "SocialAccountChoiceRequiredError";
  }
}

/**
 * The account to connect: the picked one, the only one, or a request to pick
 * when `offerChoice` is set. Null when the caller must decide.
 */
export function pickSocialAccount<T extends { externalAccountId: string }>(
  accounts: readonly T[],
  pick: { externalAccountId?: string; offerChoice?: boolean },
  toChoice: (account: T) => SocialAccountChoice,
): T | null {
  if (pick.externalAccountId) {
    return (
      accounts.find(
        (account) => account.externalAccountId === pick.externalAccountId,
      ) ?? null
    );
  }
  const [only, ...more] = accounts;
  if (only && more.length === 0) return only;
  if (only && pick.offerChoice) {
    throw new SocialAccountChoiceRequiredError(accounts.map(toChoice));
  }
  return null;
}
