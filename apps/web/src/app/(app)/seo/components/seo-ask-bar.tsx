"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { SeoChatComposer, SeoPromptChips } from "./seo-chat-composer";
import { SeoChatHeading } from "./seo-chat-panel";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const SEO_ASK_INPUT_ID = "seo-ask-question";

/** The agent tab's way into the chat: one field and three questions. The thread itself opens in the chat sheet. */
export function SeoAskBar({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const [question, setQuestion] = useState("");
  return (
    <div className={cn(HOLDER_ITEM_CLASS, "content-rise space-y-3 p-4")}>
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
        <Button variant="ghost" size="sm" onClick={() => model.openChat()}>
          <MessageSquare />
          {t("chat.openThread")}
        </Button>
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
      <SeoPromptChips compact onPick={model.askAgent} />
    </div>
  );
}
