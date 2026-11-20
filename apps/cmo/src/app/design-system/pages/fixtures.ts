/** The pages around sign in, and the error page: no overview needed. */
export const PAGES = [
  "signed-in",
  "invite-only",
  "sign-in-problem",
  "name-setup",
  "error",
] as const;

export type FixturePageName = (typeof PAGES)[number];

export function isFixturePage(page: string): page is FixturePageName {
  return (PAGES as readonly string[]).includes(page);
}
