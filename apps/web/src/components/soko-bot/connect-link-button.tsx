"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { SOKO_BOT_PROVIDER_LOGOS } from "@/components/soko-bot/provider-logos";
import { Button } from "@/components/ui/button";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

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

/**
 * Starts the app's sign-in right from the message, instead of opening the
 * bot page first, and comes back to the same chat afterwards.
 */
export function ConnectLinkButton({
  target,
  children,
}: {
  target: ConnectLinkTarget;
  children: ReactNode;
}) {
  const t = useTranslations("Components.ConnectLink");
  const [pending, setPending] = useState(false);
  const Logo = SOKO_BOT_PROVIDER_LOGOS[target.provider];

  async function connect() {
    setPending(true);
    // Loaded on click: every message renders through Markdown, and only this
    // button needs the connect action.
    const { startSokoBotConnect } = await import(
      "@/lib/soko-bot/start-integration-connect"
    );
    const error = await startSokoBotConnect(target.provider, {
      botId: target.botId,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
    if (error) {
      setPending(false);
      toast.error(error.message ?? t("error"));
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() => void connect()}
      className="not-prose mx-0.5 inline-flex align-middle no-underline"
    >
      {Logo ? (
        <Logo className="size-4 shrink-0" />
      ) : (
        <img
          src={`https://logos.composio.dev/api/${target.provider}`}
          alt=""
          className="size-4 shrink-0 rounded-sm object-contain dark:bg-foreground"
        />
      )}
      {children}
    </Button>
  );
}
