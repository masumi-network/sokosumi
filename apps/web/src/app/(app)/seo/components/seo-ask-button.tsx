"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** The chat sheet gives the focus back to this button when it closes. */
export const SEO_ASK_BUTTON_ID = "seo-ask-agent";
/** Toasts rise from the same corner: this keeps them over the button (its height plus both gaps). */
const SEO_TOAST_BOTTOM_OFFSET = "76px";

/**
 * The one way to the SEO agent, in one place on every tab: a button that
 * floats over the page and opens the chat sheet. The sheet and every dialog
 * cover it, so it is never a second control next to an open one.
 */
export function SeoAskButton({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--toast-bottom-offset", SEO_TOAST_BOTTOM_OFFSET);
    return () => {
      root.style.removeProperty("--toast-bottom-offset");
    };
  }, []);
  return (
    <button
      type="button"
      id={SEO_ASK_BUTTON_ID}
      aria-label={t("agent.ask")}
      onClick={() => model.openChat()}
      // On a phone with a home indicator the button stays over it.
      className="bg-foreground text-background hover:bg-secondary-hover focus-visible:ring-ring focus-visible:ring-offset-background fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:end-6 sm:bottom-6"
    >
      <Bot className="size-4" />
      {/* The phone has less room over the rows: the short word, with the full name as the label. */}
      <span className="sm:hidden">{t("agent.askShort")}</span>
      <span className="max-sm:hidden">{t("agent.ask")}</span>
    </button>
  );
}
