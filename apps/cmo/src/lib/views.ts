/** The app's pages and their addresses; Today is home, the chat one tap away. */
export const VIEW_PATHS = {
  today: "/",
  chat: "/chat",
  strategy: "/strategy",
  calendar: "/calendar",
  seo: "/seo",
  results: "/results",
  competitors: "/competitors",
  brain: "/brand-brain",
  channels: "/channels",
  settings: "/settings",
} as const;

export type View = keyof typeof VIEW_PATHS;

/** "/brand-brain" → "brain"; null for an address that is not a page. */
export function viewFromPath(pathname: string): View | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const found = Object.entries(VIEW_PATHS).find(([, href]) => href === path);
  return found ? (found[0] as View) : null;
}
