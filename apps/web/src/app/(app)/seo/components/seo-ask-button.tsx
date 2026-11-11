"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * The one way to the SEO agent, in one place on every tab: a button that
 * floats over the page and opens the chat sheet. The sheet and every dialog
 * cover it, so it is never a second control next to an open one.
 */
export function SeoAskButton({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  return (
    <button
      type="button"
      aria-label={t("agent.ask")}
      onClick={() => model.openChat()}
      className="bg-foreground text-background hover:bg-secondary-hover focus-visible:ring-ring focus-visible:ring-offset-background fixed end-4 bottom-4 z-40 inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:end-6 sm:bottom-6"
    >
      <Bot className="size-4" />
      {/* The phone has less room over the rows: the short word, with the full name as the label. */}
      <span className="sm:hidden">{t("agent.askShort")}</span>
      <span className="max-sm:hidden">{t("agent.ask")}</span>
    </button>
  );
}
