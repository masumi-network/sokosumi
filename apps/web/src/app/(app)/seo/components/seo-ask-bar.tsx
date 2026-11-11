"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SeoChatComposer, SeoPromptChips } from "./seo-chat-composer";
import { SeoChatHeading } from "./seo-chat-panel";
import { seoHasCompetitor } from "./seo-shared";
import { useSeoChatStarted } from "./use-seo-chat";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_ASK_INPUT_ID = "seo-ask-question";

/**
 * The agent tab's way into the chat: one field and three questions. The thread itself opens in the chat sheet.
 * A part of the result card: the reader sees the result, then asks about it.
 */
export function SeoAskBar({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const [question, setQuestion] = useState("");
  const started = useSeoChatStarted(model);
  return (
    <div className="border-border space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <SeoChatHeading
            title={<h3 className="text-sm font-semibold">{t("chat.title")}</h3>}
            description={
              <p className="text-muted-foreground text-sm">
                {t("chat.description")}
              </p>
            }
          />
        </div>
        {started ? (
          // An empty conversation has nothing to open: the field under this line starts one.
          <Button variant="ghost" size="sm" onClick={() => model.openChat()}>
            <MessageSquare />
            {t("chat.continueThread")}
          </Button>
        ) : null}
      </div>
      <SeoChatComposer
        inputId={SEO_ASK_INPUT_ID}
        value={question}
        onChange={setQuestion}
        sharing={model.data.sharing ?? "personal"}
        onSend={() => {
          const text = question.trim();
          if (!text) return;
          // The sheet holds the question from here: its field gets it back if the send fails.
          setQuestion("");
          model.askAgent(text);
        }}
      />
      <SeoPromptChips
        compact
        competitors={seoHasCompetitor(model.data)}
        onPick={model.askAgent}
      />
    </div>
  );
}
