"use client";

import type { SeoAuditChatTurn } from "@sokosumi/core-client";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth/auth.client";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoDate, SeoEmpty } from "./seo-shared";
import { SEO_CHAT_QUESTION_LIMIT, useSeoChat } from "./use-seo-chat";
import type { SeoDialog, SeoWorkspaceModel } from "./use-seo-workspace";

const ACTION_LABELS = {
  page: "addPage",
  keyword: "keywords.add",
  competitor: "competitors.add",
  import: "importAudit",
  analysis: "runAnalysis",
  statistics: "syncStatistics",
  page_change: "pageChange.title",
} as const;

function ChatActions({
  turn,
  model,
}: {
  turn: SeoAuditChatTurn;
  model: SeoWorkspaceModel;
}) {
  const t = useTranslations("App.Seo");
  return (
    <div className="flex flex-wrap gap-2">
      {turn.actions.map((action, index) =>
        action.kind === "connect" ? (
          <SeoConnectionButton
            key={`${action.provider}:${index}`}
            provider={action.provider}
            onConnected={() => {
              void model.result.refetch();
            }}
          />
        ) : action.dialog === "analysis" &&
          !model.data.availableActions.canRequestAnalysis ? null : (
          <Button
            key={`${action.dialog}:${index}`}
            variant="outline"
            size="sm"
            disabled={!model.data.availableActions.canEdit}
            onClick={() => {
              model.setChatOpen(false);
              model.setDialog(action.dialog as SeoDialog);
            }}
          >
            {t(ACTION_LABELS[action.dialog])}
          </Button>
        ),
      )}
    </div>
  );
}

export function SeoChatPanel({ model }: { model: SeoWorkspaceModel }) {
  const { data: session } = useSession();
  const identity = JSON.stringify([
    session?.session.activeOrganizationId,
    session?.user.id,
    model.data.auditId,
  ]);
  return <SeoChatConversation key={identity} model={model} />;
}

function SeoChatConversation({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const chat = useSeoChat(model);
  return (
    <Sheet open={model.chatOpen} onOpenChange={model.setChatOpen}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b pr-12">
          <SheetTitle>{t("chat.title")}</SheetTitle>
          <SheetDescription>{t("chat.description")}</SheetDescription>
        </SheetHeader>
        <div
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"
          aria-live="polite"
          aria-busy={chat.busy}
        >
          {chat.history.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("loading")}
            </p>
          ) : chat.history.isError ? (
            <div role="alert" className="space-y-2">
              <p>{t("chat.loadFailed")}</p>
              <Button
                variant="outline"
                onClick={() => {
                  void chat.history.refetch();
                }}
              >
                {t("retry")}
              </Button>
            </div>
          ) : !chat.turns.length ? (
            <SeoEmpty title={t("chat.empty")} body={t("chat.emptyBody")} />
          ) : null}
          {chat.turns.map((turn) => (
            <article key={turn.id} className="space-y-3 border-b pb-5">
              <div className="bg-muted ml-6 rounded-lg px-3 py-2">
                <p className="text-sm whitespace-pre-wrap">{turn.question}</p>
              </div>
              <p className="text-muted-foreground text-xs">
                {t("chat.pages", { count: turn.scope.pageIds.length })} ·{" "}
                <SeoDate value={turn.createdAt} />
              </p>
              {turn.status === "running" ? (
                <p role="status" className="text-muted-foreground text-sm">
                  {t("chat.working")}
                </p>
              ) : turn.status === "failed" ? (
                <p role="alert" className="text-destructive text-sm">
                  {t("chat.failed")}
                </p>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{turn.response}</p>
                  <ChatActions turn={turn} model={model} />
                </>
              )}
            </article>
          ))}
          {chat.sending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("chat.working")}
            </p>
          ) : null}
        </div>
        <form
          className="shrink-0 space-y-3 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void chat.send();
          }}
        >
          <p className="text-muted-foreground text-xs">{t("chat.private")}</p>
          <Label htmlFor="seo-chat-question">{t("chat.question")}</Label>
          <Textarea
            id="seo-chat-question"
            value={chat.question}
            onChange={(event) => chat.setQuestion(event.target.value)}
            maxLength={SEO_CHAT_QUESTION_LIMIT}
            rows={3}
            required
            disabled={chat.busy}
          />
          {chat.error ? (
            <p role="alert" className="text-destructive text-sm">
              {chat.error}
            </p>
          ) : null}
          <Button
            type="submit"
            loading={chat.busy}
            disabled={chat.busy || !chat.question.trim()}
          >
            <Send className="size-4" />
            {t("chat.send")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
