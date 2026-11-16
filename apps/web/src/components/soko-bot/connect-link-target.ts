import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

// Lives outside `connect-link-button.tsx` because that is a "use client"
// module: `Markdown` also renders on the server (a project's DESIGN.md), and a
// plain function imported across that boundary is a client reference the
// server cannot call, so any page with a link in it crashed.

export interface ConnectLinkTarget {
  provider: string;
  /** A team bot; the reader's own bot when null. */
  botId: string | null;
}

const PROVIDER = /^[a-z0-9_-]{1,64}$/i;
const TEAM_BOT_PATH = /^\/soko-bots\/([^/]+)$/;

/** A bot's `find_integrations` link: its page with `?connect=<app>`. */
export function connectLinkTarget(
  href: string | undefined,
): ConnectLinkTarget | null {
  if (!href?.startsWith("/") || href.startsWith("//")) return null;
  const url = new URL(href, "https://sokosumi.com");
  const provider = url.searchParams.get("connect");
  if (!provider || !PROVIDER.test(provider)) return null;
  if (url.pathname === SOKO_BOT_ROUTE) return { provider, botId: null };
  const teamBot = TEAM_BOT_PATH.exec(url.pathname);
  return teamBot?.[1] ? { provider, botId: teamBot[1] } : null;
}
