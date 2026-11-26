import { Bot, ChevronLeft, ChevronRight, Plus, Star } from "lucide-react";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import type { ViewContext } from "../../shell/Shell.tsx";
import {
  formatNumber,
  isPlainReference,
  isUnderBase,
  type MessageKey,
  t,
} from "../../shell/text.ts";
import { Badge, Button } from "../../shell/ui.tsx";

/**
 * The fields of an `agents_list` Cardano item the view reads. x402 items have
 * no `credits`: people pay them only through a Coworker, so they are skipped.
 */
const ListedAgent = z.object({
  kind: z.literal("cardano").optional(),
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  summary: z.string().nullish(),
  description: z.string().nullish(),
  metrics: z
    .object({
      ratings: z.object({ total: z.number(), average: z.number().nullable() }),
    })
    .nullish(),
});
type ListedAgent = z.infer<typeof ListedAgent>;

/** `agents_list`'s result, which `agents_show` returns unchanged. */
export const AgentsList = z.object({ data: z.array(z.unknown()) });
export type AgentsList = z.infer<typeof AgentsList>;

export const AGENTS_EMPTY = {
  title: "agentsBrowse.empty.title",
  body: "agentsBrowse.empty.body",
} satisfies { title: MessageKey; body: MessageKey };

const MAX_AGENTS = 8;

/** The agents a person can hire from here, each once, at most eight. */
export function hireable(list: AgentsList): ListedAgent[] {
  const agents = new Map<string, ListedAgent>();
  for (const item of list.data) {
    const agent = ListedAgent.safeParse(item).data;
    if (agent && !agents.has(agent.id)) agents.set(agent.id, agent);
  }
  return [...agents.values()].slice(0, MAX_AGENTS);
}

type Sending = { id: string; state: "sending" | "sent" | "failed" };

export function AgentsBrowse({
  data,
  context,
}: {
  data: AgentsList;
  context: ViewContext;
}) {
  const { app, input = {}, locale } = context;
  const workspace =
    typeof input.workspace === "string" && input.workspace
      ? input.workspace
      : undefined;
  // agents_list is a public catalog, so a call often names no workspace: the
  // message then names none either, and the model asks or picks one.
  const canHire =
    !!app.getHostCapabilities()?.message &&
    (workspace === undefined || isPlainReference(workspace));
  const agents = hireable(data);
  const [sending, setSending] = useState<Sending>();
  // Set before the message leaves, so a second click in the same frame is a no-op.
  const busy = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * A fixed message naming only ids: the agent's name and summary are
   * untrusted record text and never reach the model (ADR 0083).
   */
  const askToHire = async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setSending({ id, state: "sending" });
    const text = workspace
      ? t("agentsBrowse.hireMessage", { agent: id, workspace })
      : t("agentsBrowse.hireMessageNoWorkspace", { agent: id });
    let state: Sending["state"] = "failed";
    try {
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text }],
      });
      if (!result.isError) state = "sent";
    } catch {}
    busy.current = false;
    setSending({ id, state });
  };

  const base = context.webBaseUrl;
  const allUrl = base ? `${base.replace(/\/$/, "")}/agents` : undefined;
  const seeAll =
    allUrl && isUnderBase(allUrl, base)
      ? () =>
          app.openLink({ url: allUrl }).catch((error: unknown) =>
            app.sendLog({
              level: "warning",
              data: `ui/open-link failed: ${String(error)}`,
            }),
          )
      : undefined;

  const scroll = (direction: 1 | -1) => {
    const list = listRef.current;
    const step = list?.firstElementChild?.clientWidth ?? 0;
    const still = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list?.scrollBy?.({
      left: direction * (step + 12),
      behavior: still ? "auto" : "smooth",
    });
  };

  const credits = (amount: number) =>
    amount > 0
      ? t(amount === 1 ? "agentsBrowse.credit" : "agentsBrowse.credits", {
          amount: formatNumber(amount, locale),
        })
      : t("agentsBrowse.free");

  return (
    <article
      data-step={sending?.state === "sent" ? "sent" : "browse"}
      className="flex flex-col gap-4"
    >
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-base font-semibold tracking-tight">
          {t("agentsBrowse.title")}
        </h1>
        {agents.length > 1 && (
          <div className="-mx-3 -my-2.5 flex items-center">
            <Button
              variant="ghost"
              className="min-w-11"
              onClick={() => scroll(-1)}
              aria-label={t("agentsBrowse.previous")}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              className="min-w-11"
              onClick={() => scroll(1)}
              aria-label={t("agentsBrowse.next")}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </header>

      <ul
        ref={listRef}
        aria-label={t("agentsBrowse.title")}
        // A scrollable region is reachable from the keyboard: arrow keys scroll it.
        tabIndex={0}
        className="focus-visible:outline-ring -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            price={credits(agent.credits)}
            locale={locale}
            sending={sending?.id === agent.id ? sending.state : undefined}
            onHire={
              canHire && isPlainReference(agent.id)
                ? () => askToHire(agent.id)
                : undefined
            }
            disabled={sending?.state === "sending"}
          />
        ))}
      </ul>

      <p role="status" className="text-muted-foreground text-sm empty:hidden">
        {sending?.state === "sent"
          ? t("agentsBrowse.sent")
          : sending?.state === "failed"
            ? t("agentsBrowse.sendFailed")
            : ""}
      </p>

      {seeAll && (
        <Button variant="ghost" onClick={seeAll} className="-mx-3 self-start">
          {t("agentsBrowse.seeAll")}
        </Button>
      )}
    </article>
  );
}

function AgentCard({
  agent,
  price,
  locale,
  sending,
  onHire,
  disabled,
}: {
  agent: ListedAgent;
  price: string;
  locale?: string;
  sending?: Sending["state"];
  onHire?: () => void;
  disabled: boolean;
}) {
  const nameId = useId();
  const ratings = agent.metrics?.ratings;
  const average =
    ratings?.average != null && ratings.total > 0
      ? formatNumber(Math.round(ratings.average * 10) / 10, locale)
      : undefined;
  const sent = sending === "sent";

  return (
    <li
      aria-labelledby={nameId}
      className="bg-background border-border flex w-64 shrink-0 snap-start flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="border-border bg-card-background flex size-10 shrink-0 items-center justify-center rounded-lg border"
        >
          <Bot className="text-muted-foreground size-5" />
        </span>
        <h2 id={nameId} className="min-w-0 truncate font-medium">
          {agent.name}
        </h2>
      </div>
      <p className="text-muted-foreground line-clamp-2 flex-1 text-sm break-words">
        {agent.summary || agent.description}
      </p>
      <div className="text-muted-foreground flex min-h-8 items-center justify-between gap-3 text-xs">
        <Badge>{price}</Badge>
        {average !== undefined && ratings ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star aria-hidden="true" className="size-3 fill-current" />
            <span aria-hidden="true">
              {t("agentsBrowse.rating", { average, total: ratings.total })}
            </span>
            <span className="sr-only">
              {t(
                ratings.total === 1
                  ? "agentsBrowse.ratedOne"
                  : "agentsBrowse.rated",
                { average, total: ratings.total },
              )}
            </span>
          </span>
        ) : (
          <span>{t("agentsBrowse.noRatings")}</span>
        )}
      </div>
      {onHire && (
        <Button onClick={onHire} disabled={disabled || sent} className="w-full">
          {!sent && sending !== "sending" && <Plus aria-hidden="true" />}
          {sent
            ? t("agentsBrowse.sentButton")
            : sending === "sending"
              ? t("agentsBrowse.sending")
              : t("agentsBrowse.hire")}
          <span className="sr-only"> {agent.name}</span>
        </Button>
      )}
    </li>
  );
}
