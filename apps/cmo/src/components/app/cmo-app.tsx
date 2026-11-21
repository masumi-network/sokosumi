"use client";

import { SeoActions, SeoPage } from "./seo-page";
import "../onboarding/onboarding.css";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { withoutSokosumiLinks } from "@sokosumi/utils";
import { ArrowUp, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useCmoAppInitialUrl } from "../../hooks/effects/use-cmo-app-initial-url";
import { useEventListener } from "../../hooks/effects/use-event-listener";
import { useScrollIntoViewWhen } from "../../hooks/effects/use-scroll-into-view-when";
import { AGENT_NAME } from "../../lib/agent";
import { changeIdeas } from "../../lib/change-ideas";
import type { CusoMessage } from "../../lib/chat-messages";
import type { ChatTable, ChatWork } from "../../lib/chat-work";
import { pageLead } from "../../lib/page-lead";
import { productionShare, productionSteps } from "../../lib/production";
import { strategyApproved } from "../../lib/strategy";
import { buildThread, type ThreadItem } from "../../lib/thread";
import { needsYou } from "../../lib/today";
import { VIEW_PATHS, type View, viewFromPath } from "../../lib/views";
import { type AdActions, SearchAdControl } from "../ads";
import { CusoAvatar, type Pose } from "../cuso";
import { HowIGotHere, Working } from "../cuso-trace";
import { LocalStamp } from "../local-day";
import { StatusText } from "../status";
import { type StartTopUp, skipOffer, TopUpButton, topUpOffer } from "../top-up";
import { BrandMenu } from "./brand-menu";
import { CalendarPage } from "./calendar-page";
import {
  BrandBrainCard,
  type CardActions,
  CompetitorWeekCard,
  ConnectCard,
  LearningCard,
  StrategyCard,
  UpdateCard,
} from "./cards";
import { MadeInChat } from "./chat-work";
import { type CompetitorActions, CompetitorsPage } from "./competitors-page";
import { cusoMood } from "./cuso-status";
import type { DraftActions, DraftResult, TikTokSettings } from "./draft-post";
import { MessageText } from "./message-text";
import { PageLead } from "./page-lead";
import {
  type AddMailingList,
  BrandBrainPage,
  ChannelsPage,
  type ConnectChannel,
  ResultsLead,
  ResultsPage,
  SettingsPage,
} from "./pages";
import { cmoPause, PausedBanner } from "./paused";
import { initial, Sidebar } from "./sidebar";
import { StrategyPage } from "./strategy-page";
import { type ChangePlan, type OpenPortal } from "./subscription-card";
import { TabBar } from "./tab-bar";
import { TodayPage } from "./today-page";

const POLL_MS = 4_000;

export interface CmoAppActions
  extends AdActions,
    Omit<SeoActions, "connectSearchConsole"> {
  loadState: () => Promise<{
    overview: CmoOverview | null;
    messages: CusoMessage[];
  }>;
  /** What Cuso made, or is making, in the chat, as it stands now. */
  loadChatWork: () => Promise<ChatWork[]>;
  /** The full words of a file Cuso wrote or of work he handed on. */
  loadChatWorkText: (id: string) => Promise<string | null>;
  /** All the rows of a table Cuso made or filled. */
  loadChatWorkTable: (id: string) => Promise<ChatTable | null>;
  sendMessage: (content: string) => Promise<void>;
  /** The words of a piece kept in the owner's Files. */
  loadPieceText: (entryId: string) => Promise<string | null>;
  approveStrategy: (versionId?: string) => Promise<CmoOverview>;
  /** A whole new strategy, written as a new hire's first one. */
  requestStrategy: () => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
  /** The owner's own monthly ad budget; Cuso re-plans around it. */
  setAdBudget: (
    monthly: number,
    currency: string,
  ) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  revertUpdate: (id: string) => Promise<CmoOverview>;
  saveBrandBrain: (
    brandBrain: NonNullable<CmoOverview["brandBrain"]>,
  ) => Promise<CmoOverview>;
  retryLearning: () => Promise<{
    overview: CmoOverview;
    error: string | null;
  }>;
  pauseEntry: (id: string) => Promise<CmoOverview>;
  /** Approve, decline or rewrite a post Cuso made outside the month. */
  approveDraft: (
    postId: string,
    revision: number,
    tikTokSettings?: TikTokSettings,
  ) => Promise<DraftResult>;
  readTikTokCreator: DraftActions["tikTokCreator"];
  declineDraft: (postId: string, revision: number) => Promise<DraftResult>;
  editDraft: (
    postId: string,
    revision: number,
    text: string,
  ) => Promise<DraftResult>;
  competitors: CompetitorActions;
  connectChannel: ConnectChannel;
  /** Signs in again to put another account in a connection's place. */
  changeChannel?: (socialConnectionId: string) => ReturnType<ConnectChannel>;
  addMailingList: AddMailingList;
  connectMeasurement: (
    provider: CmoOverview["measurement"][number]["provider"],
    from: "onboarding" | "app" | "seo" | "channels",
  ) => Promise<{ url: string | null; error: string | null }>;
  /** Archives this Cuso and opens the hiring form; a refusal comes back as text. */
  startOver: () => Promise<string | null>;
  /** Moves Cuso's routines to this time zone; a refusal comes back as text. */
  setTimeZone: (timeZone: string) => Promise<string | null>;
  /** Starts the checkout for a Project top-up of this Cuso. */
  startTopUp: StartTopUp;
  /** Starts the CMO plan checkout, for a paused Cuso or from Settings. */
  subscribe: StartTopUp;
  /** A tester continues without a subscription; a refusal comes back as text. */
  skipSubscription: () => Promise<{ error: string | null }>;
  /** Owners and admins: another tier of the interval, and Polar's portal. */
  changePlan: ChangePlan;
  openPortal: OpenPortal;
  signOut: () => Promise<void>;
}

interface CmoAppProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  /** The pictures, videos and voice-overs Cuso started in the chat. */
  work?: ChatWork[];
  name: string;
  email: string;
  /** The account's picture, when it has one. */
  image?: string | null;
  /** Where a redirect (a channel connection) returns to. */
  initialView?: View;
  /** Why the channel connection that sent the founder back did not finish. */
  connectError?: string | null;
  /** Why the ad-account connection that sent the founder back did not finish. */
  adsError?: string | null;
  /** Why the measurement connection that sent the founder back did not finish. */
  measureError?: string | null;
  /** The CMO plans, for Settings' plan change; empty unless the viewer manages billing. */
  plans?: CmoSubscriptionPlan[];
  /** The person has another Cuso, for the sidebar's "Your Cusos". */
  manyCusos?: boolean;
  /** The person may hire another Cuso (CMO is invite-only for now). */
  mayHire?: boolean;
  actions: CmoAppActions;
}

/**
 * Cuso is paused because the credits ran out; the top-up is offered when
 * this Cuso may have one.
 */
export function OutOfCreditsBanner({ topUp }: { topUp: StartTopUp | null }) {
  return (
    <div className="banner" role="status">
      <span className="sw" aria-hidden="true" />
      <b>{AGENT_NAME} is paused: out of credits.</b>
      {topUp ? (
        <>
          <span className="muted">Scheduled work waits until you top up.</span>
          <span className="sp" />
          <TopUpButton startTopUp={topUp} />
        </>
      ) : null}
    </div>
  );
}

const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;

/**
 * Cuso and Core write Markdown: `**bold**` and `[label](url)` read badly raw.
 * CMO never opens Sokosumi: a link into it (a relative route such as
 * `/social?postId=…`, or its web address) shows as its words alone.
 */
export function renderInline(
  text: string,
  webOrigin: string,
): React.ReactNode[] {
  const parts = withoutSokosumiLinks(text, webOrigin).split(INLINE);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = LINK.exec(part);
    if (link?.[1] && link[2]) {
      const href = URL.parse(link[2]);
      if (href?.protocol !== "https:" && href?.protocol !== "http:") {
        return link[1];
      }
      return (
        <a key={index} href={href.toString()} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

/** Sokosumi's web origin, from the connect link Core already builds. */
export function webOriginOf(overview: CmoOverview): string {
  return new URL(overview.connectChannelUrl).origin;
}

/** Starter replies for the moment the owner is in. */
function suggestions(overview: CmoOverview): string[] {
  if (overview.strategy && !strategyApproved(overview)) {
    return changeIdeas(overview).slice(0, 3);
  }
  if (strategyApproved(overview)) {
    return [
      "Announce our new product tomorrow",
      "What are you doing today?",
      "What worked best?",
    ];
  }
  return [];
}

export function CmoApp({
  overview: initialOverview,
  messages: initialMessages,
  work: initialWork = [],
  name,
  email,
  image = null,
  initialView = "today",
  connectError = null,
  adsError = null,
  measureError = null,
  plans = [],
  manyCusos = false,
  mayHire = false,
  actions,
}: CmoAppProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [work, setWork] = useState(initialWork);
  const [nav, setNav] = useState({
    view: initialView,
    connectError,
    adsError,
    measureError,
  });
  const { view } = nav;
  // Leaving the landing view consumes its one-shot OAuth return notice so
  // returning later on the clean URL does not show it again.
  const selectView = useCallback((next: View) => {
    setNav((current) =>
      current.view === next
        ? current
        : {
            view: next,
            connectError:
              current.view === "channels" ? null : current.connectError,
            adsError: current.view === "channels" ? null : current.adsError,
            measureError:
              current.view === "results" || current.view === "channels"
                ? null
                : current.measureError,
          },
    );
  }, []);
  // Each page has its own address, so reload, Back and new tabs land on it.
  const go = useCallback(
    (next: View) => {
      selectView(next);
      if (window.location.pathname !== VIEW_PATHS[next]) {
        window.history.pushState(null, "", VIEW_PATHS[next]);
      }
    },
    [selectView],
  );
  useEventListener("window", "popstate", () =>
    selectView(viewFromPath(window.location.pathname) ?? "today"),
  );
  const [draft, setDraft] = useState("");
  // A post opened from Today opens on the Calendar.
  const [focusEntry, setFocusEntry] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [sendFailed, setSendFailed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // A connection redirect lands on /?step=connect; show the page's own address.
  useCmoAppInitialUrl(initialView);

  const refresh = useCallback(async () => {
    // On its own: the chat still shows when one of the two reads fails.
    const [state, made] = await Promise.all([
      actions.loadState().catch(() => null),
      actions.loadChatWork().catch(() => null),
    ]);
    if (made) setWork(made);
    if (!state?.overview) return;
    setOverview(state.overview);
    setMessages(state.messages);
  }, [actions]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  const thread = buildThread(overview, messages, work);
  const threadLength = thread.length;
  // What Cuso is doing sits under the thread, so it scrolls into view too.
  const working =
    overview.botStatus === "RUNNING"
      ? `${overview.activity?.step}\n${overview.activity?.reasoning}`
      : null;
  useScrollIntoViewWhen(end, view === "chat" && threadLength > 0, {
    block: "end",
    resetKey: `${threadLength}:${working === null ? "idle" : `busy:${working}`}`,
  });

  const compose = useCallback(
    (text: string) => {
      go("chat");
      setDraft(text);
      window.setTimeout(() => input.current?.focus(), 0);
    },
    [go],
  );

  // Core writes Polar's answer before the change returns, so the card reads
  // it now; an upgrade's credits follow with Polar's paid order on the poll.
  const changePlan: ChangePlan = async (tier) => {
    const result = await actions.changePlan(tier);
    if (result.change) await refresh();
    return result;
  };

  const topUp = topUpOffer(overview, actions.startTopUp);
  // A tester continues without a subscription; the overview then shows him
  // working on his Tester credits.
  const skip = skipOffer(overview, async () => {
    const { error } = await actions.skipSubscription();
    if (!error) await refresh();
    return error;
  });
  // A refused change (the draft moved on meanwhile) shows the draft as it is now.
  const settleDraft = async (change: Promise<DraftResult>) => {
    const { overview: next, error } = await change;
    if (next) setOverview(next);
    else await refresh();
    return error;
  };
  const draftActions: DraftActions = {
    approve: (postId, revision, tikTokSettings) =>
      settleDraft(actions.approveDraft(postId, revision, tikTokSettings)),
    tikTokCreator: actions.readTikTokCreator,
    decline: (postId, revision) =>
      settleDraft(actions.declineDraft(postId, revision)),
    edit: (postId, revision, text) =>
      settleDraft(actions.editDraft(postId, revision, text)),
  };
  const cardActions: CardActions = {
    approve: async () => setOverview(await actions.approveStrategy()),
    revert: async (id) => setOverview(await actions.revertUpdate(id)),
    retryLearning: async () => {
      const result = await actions.retryLearning();
      setOverview(result.overview);
      return result.error;
    },
    compose,
    open: (target) => go(target),
    topUp,
    drafts: draftActions,
  };

  function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setSendFailed(false);
    startSending(async () => {
      // A message that did not send comes back to the box, not lost.
      try {
        await actions.sendMessage(content);
      } catch {
        setDraft(content);
        setSendFailed(true);
        return;
      }
      await refresh();
    });
  }

  function openUpdate(id: string) {
    go("chat");
    window.setTimeout(
      () =>
        document
          .getElementById(`update-${id}`)
          ?.scrollIntoView({ block: "center" }),
      0,
    );
  }

  const lead = pageLead(view, overview);
  const outOfCredits =
    strategyApproved(overview) && overview.billing.availableCredits <= 0;
  const pause = strategyApproved(overview) ? cmoPause(overview) : null;

  return (
    <div className="app">
      <Sidebar
        overview={overview}
        manyCusos={manyCusos}
        view={view}
        onSelect={go}
        name={name}
        email={email}
        image={image}
        signOut={actions.signOut}
      />

      <main className={view === "chat" ? "main main-chat" : "main"}>
        {/* A phone has no sidebar: the brand's menu sits in a top bar. */}
        <header className="phonebar">
          <BrandMenu overview={overview} view={view} onSelect={go} />
        </header>
        {pause ? (
          <PausedBanner
            pause={pause}
            billing={overview.billing}
            subscribe={actions.subscribe}
            openPortal={actions.openPortal}
            skip={skip}
          />
        ) : outOfCredits ? (
          <OutOfCreditsBanner topUp={topUp} />
        ) : null}

        {view === "chat" ? (
          <>
            {lead ? <PageLead {...lead} /> : null}
            <div className="scroll chat">
              <div className="thread">
                {thread.map((item) => (
                  <ThreadEntry
                    key={threadKey(item)}
                    item={item}
                    overview={overview}
                    actions={cardActions}
                    name={name || email}
                    openCalendar={() => go("calendar")}
                    loadText={actions.loadChatWorkText}
                    loadTable={actions.loadChatWorkTable}
                  />
                ))}
                {overview.botStatus === "RUNNING" ? (
                  <CusoSays pose="thinking">
                    <Working activity={overview.activity} />
                  </CusoSays>
                ) : null}
              </div>
              {/* Outside the thread, so it adds no gap under the last message. */}
              <div ref={end} />
            </div>
            <div className="composer-wrap">
              <div className="suggest">
                {suggestions(overview).map((text) => (
                  <button
                    key={text}
                    type="button"
                    className="chip"
                    onClick={() => compose(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {sendFailed ? (
                <p className="note" role="alert">
                  Your message didn't send. Try again.
                </p>
              ) : null}
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={input}
                  rows={2}
                  value={draft}
                  aria-label={`Message ${AGENT_NAME}`}
                  placeholder={`Ask ${AGENT_NAME} anything, or tell him what to change`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) send(event);
                  }}
                />
                <div className="composer-bar">
                  <button
                    type="submit"
                    className="send"
                    aria-label="Send"
                    disabled={sending || !draft.trim()}
                  >
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : (
          // A new element per page, so each page opens at its top.
          <div className="scroll" key={view}>
            <div className={`page page-${view}`}>
              {lead && view !== "seo" && view !== "competitors" ? (
                <PageLead
                  {...lead}
                  line={
                    view === "results" ? (
                      <ResultsLead overview={overview} />
                    ) : (
                      lead.line
                    )
                  }
                >
                  {view === "strategy" ? (
                    <StrategyLeadAside
                      overview={overview}
                      approve={async () =>
                        setOverview(await actions.approveStrategy())
                      }
                    />
                  ) : null}
                </PageLead>
              ) : null}
              {view === "today" ? (
                <TodayPage
                  overview={overview}
                  firstName={name.trim().split(/\s+/)[0] ?? ""}
                  open={go}
                  openEntry={(id) => {
                    setFocusEntry(id);
                    go("calendar");
                  }}
                />
              ) : view === "calendar" ? (
                <CalendarPage
                  overview={overview}
                  initialOpenId={focusEntry}
                  drafts={draftActions}
                  onConnect={() => go("channels")}
                  loadText={actions.loadPieceText}
                  pieceExtra={(entry) => (
                    <>
                      <SearchAdControl
                        entry={entry}
                        overview={overview}
                        actions={actions}
                        onChange={setOverview}
                      />
                      {entry.status === "published" ? null : (
                        <PauseButton
                          pause={async () =>
                            setOverview(await actions.pauseEntry(entry.id))
                          }
                        />
                      )}
                    </>
                  )}
                  onAsk={async (text) => {
                    await actions.sendMessage(text);
                    await refresh();
                  }}
                />
              ) : view === "strategy" ? (
                <StrategyPage
                  overview={overview}
                  onOpenCalendar={() => go("calendar")}
                  connectMeasurement={(provider) =>
                    actions.connectMeasurement(provider, "app")
                  }
                  onApprove={async (versionId) =>
                    setOverview(await actions.approveStrategy(versionId))
                  }
                  onWriteNew={async () => {
                    const result = await actions.requestStrategy();
                    if (result.overview) setOverview(result.overview);
                    return result.error;
                  }}
                />
              ) : view === "seo" ? (
                <SeoPage
                  timeZone={overview.timeZone}
                  actions={{
                    ...actions,
                    connectSearchConsole: () =>
                      actions.connectMeasurement(
                        "google_search_console",
                        "seo",
                      ),
                  }}
                />
              ) : view === "results" ? (
                <ResultsPage
                  overview={overview}
                  compose={compose}
                  openUpdate={openUpdate}
                  connectMeasurement={(provider) =>
                    actions.connectMeasurement(provider, "app")
                  }
                  measureError={nav.measureError}
                  ads={actions}
                  onChange={setOverview}
                  openView={go}
                />
              ) : view === "competitors" ? (
                <CompetitorsPage
                  overview={overview}
                  actions={actions.competitors}
                  compose={compose}
                />
              ) : view === "brain" ? (
                <BrandBrainPage
                  overview={overview}
                  messages={messages}
                  onSave={async (brandBrain) =>
                    setOverview(await actions.saveBrandBrain(brandBrain))
                  }
                  onAsk={async (text) => {
                    await actions.sendMessage(text);
                    await refresh();
                  }}
                />
              ) : view === "channels" ? (
                <ChannelsPage
                  overview={overview}
                  compose={compose}
                  connect={actions.connectChannel}
                  connectAds={actions.connectAds}
                  addMailingList={actions.addMailingList}
                  onChange={setOverview}
                  connectError={nav.connectError}
                  adsError={nav.adsError}
                  change={actions.changeChannel}
                  openSeo={() => go("seo")}
                  connectMeasurement={(provider) =>
                    actions.connectMeasurement(provider, "channels")
                  }
                  measureError={nav.measureError}
                />
              ) : (
                <SettingsPage
                  overview={overview}
                  compose={compose}
                  name={name}
                  email={email}
                  startOver={actions.startOver}
                  mayHire={mayHire}
                  setTimeZone={actions.setTimeZone}
                  signOut={actions.signOut}
                  topUp={topUp}
                  plans={plans}
                  changePlan={changePlan}
                  openPortal={actions.openPortal}
                  subscribe={actions.subscribe}
                />
              )}
            </div>
          </div>
        )}
      </main>
      <TabBar
        view={view}
        onSelect={go}
        needs={needsYou(overview).length}
        pose={cusoMood(overview).art}
        manyCusos={manyCusos}
        signOut={actions.signOut}
      />
    </div>
  );
}

/** Strategy's status beside its lead, and the approval while it is a draft. */
function StrategyLeadAside({
  overview,
  approve,
}: {
  overview: CmoOverview;
  approve: () => Promise<void>;
}) {
  if (!overview.strategy) return null;
  if (strategyApproved(overview)) return <StatusText>Approved</StatusText>;
  return overview.strategyShort || !overview.viewerCanApprove ? (
    <span className="muted">Draft</span>
  ) : (
    <ApproveDraft approve={approve} />
  );
}

/** Takes a piece out of the plan and cancels its post. */
function PauseButton({ pause }: { pause: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="button button-ghost button-small"
      disabled={pending}
      onClick={() => startTransition(pause)}
    >
      {pending ? "Pausing…" : "Pause this post"}
    </button>
  );
}

function threadKey(item: ThreadItem): string {
  if (item.kind === "message") return `m-${item.message.id}`;
  if (item.kind === "update") return `u-${item.update.id}`;
  if (item.kind === "work") return `w-${item.work.id}`;
  return item.kind;
}

function ThreadEntry({
  item,
  overview,
  actions,
  name,
  openCalendar,
  loadText,
  loadTable,
}: {
  item: ThreadItem;
  overview: CmoOverview;
  actions: CardActions;
  name: string;
  openCalendar: () => void;
  loadText: (id: string) => Promise<string | null>;
  loadTable: (id: string) => Promise<ChatTable | null>;
}) {
  if (item.kind === "message") {
    if (!item.message.fromCuso) {
      return (
        <div className="msg">
          <span className="mav user" aria-hidden="true">
            {initial(item.message.author || name)}
          </span>
          <div className="mbody">
            <MessageMeta author={item.message.author || name} at={item.at} />
            <p className="txt">{item.message.content}</p>
          </div>
        </div>
      );
    }
    if (item.message.week) {
      return (
        <CusoSays at={item.at}>
          <CompetitorWeekCard week={item.message.week} actions={actions} />
        </CusoSays>
      );
    }
    return (
      <CusoSays at={item.at}>
        <MessageText
          content={item.message.content}
          inline={(text) => renderInline(text, webOriginOf(overview))}
        />
        {item.message.trace ? <HowIGotHere trace={item.message.trace} /> : null}
      </CusoSays>
    );
  }
  if (item.kind === "work") {
    return (
      <CusoSays at={item.at}>
        <MadeInChat
          work={item.work}
          compose={actions.compose}
          loadText={loadText}
          loadTable={loadTable}
        />
      </CusoSays>
    );
  }
  if (item.kind === "welcome") {
    return (
      <CusoSays at={item.at}>
        <p className="txt">
          Your strategy is ready. I'm making this month's posts now and publish
          each one on its day; the Calendar shows every post. Ask me anything
          here, or tell me what to change.
        </p>
      </CusoSays>
    );
  }
  const card = (() => {
    switch (item.kind) {
      case "learning":
        return (
          <LearningCard
            brain={overview.brandBrain}
            state={overview.learning}
            actions={actions}
          />
        );
      case "brandBrain":
        return overview.brandBrain ? (
          <BrandBrainCard brandBrain={overview.brandBrain} actions={actions} />
        ) : null;
      case "strategy":
        return <StrategyCard overview={overview} actions={actions} />;
      case "connect":
        return <ConnectCard actions={actions} />;
      case "production":
        return (
          <ProductionCard
            production={overview.production}
            openCalendar={openCalendar}
          />
        );
      case "update":
        return (
          <div id={`update-${item.update.id}`}>
            <UpdateCard
              update={item.update}
              actions={actions}
              approved={
                overview.strategyVersion?.approvedAt != null &&
                new Date(item.update.at) >=
                  new Date(overview.strategyVersion?.approvedAt)
              }
              superseded={
                overview.strategyVersion?.approvedAt != null &&
                new Date(item.update.at) <
                  new Date(overview.strategyVersion?.approvedAt)
              }
            />
          </div>
        );
    }
  })();
  return card ? <CusoSays at={item.at}>{card}</CusoSays> : null;
}

/**
 * Approves the newest version from the Strategy page; Cuso makes the month
 * from it. A refused approval says so instead of leaving the page.
 */
function ApproveDraft({ approve }: { approve: () => Promise<void> }) {
  const [pending, startApproving] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="button button-small"
      disabled={pending}
      title={failed ? "That didn't go through. Try again." : undefined}
      onClick={() =>
        startApproving(async () => {
          setFailed(false);
          try {
            await approve();
          } catch {
            setFailed(true);
          }
        })
      }
    >
      {pending ? "Approving…" : failed ? "Try again" : "Approve"}
    </button>
  );
}

/**
 * Cuso making the month, as one card that fills up: his rounds report to
 * Core, and the owner sees how far the month is and where to read it.
 */
function ProductionCard({
  production,
  openCalendar,
}: {
  production: CmoOverview["production"];
  openCalendar: () => void;
}) {
  const ready = production.state === "ready";
  const share = productionShare(production);
  // Between two runs the month is partly made: only a month with no words
  // yet is about to start.
  const notStarted =
    production.state === "starting" && production.written === 0;
  return (
    <div className="production">
      <p className="production-head">
        {production.state === "running" ? (
          <span className="dot live" aria-hidden="true" />
        ) : null}
        <b>
          {ready
            ? "Your month is ready"
            : production.state === "stuck"
              ? "Most of your month is ready"
              : production.state === "blocked"
                ? `${AGENT_NAME} couldn't start your month`
                : notStarted
                  ? `${AGENT_NAME} is about to make your month`
                  : `${AGENT_NAME} is making your month`}
        </b>
        <span className="note num">
          {production.ready} of {production.total} ready
        </span>
      </p>
      <span
        className="uprogress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share}
        aria-label="Month made"
      >
        <span style={{ width: `${share}%` }} />
      </span>
      <p className="note">
        {ready
          ? "Every post, picture, article and email is made. Each goes out on its day."
          : production.state === "stuck"
            ? `A few posts didn't finish. ${AGENT_NAME} tries them again on his next round.`
            : production.state === "blocked"
              ? "Something on our side keeps him from starting. He tries again every ten minutes."
              : notStarted
                ? "He starts shortly: first every post's words, then the pictures."
                : production.state === "starting"
                  ? `${productionSteps(production)}. He makes the rest shortly.`
                  : `${productionSteps(production)}. First the words, then the pictures.`}
      </p>
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={openCalendar}
      >
        <CalendarDays size={14} aria-hidden="true" />
        See your calendar
      </button>
    </div>
  );
}

interface CusoSaysProps {
  at?: string;
  /** Working shows him thinking; everything else he has already said. */
  pose?: Pose;
  children: React.ReactNode;
}

function CusoSays({ at, pose = "done", children }: CusoSaysProps) {
  return (
    <div className="msg">
      <CusoAvatar pose={pose} size={36} />
      <div className="mbody">
        <MessageMeta author={AGENT_NAME} at={at} />
        {children}
      </div>
    </div>
  );
}

function MessageMeta({ author, at }: { author: string; at?: string }) {
  return (
    <span className="meta">
      <b>{author}</b>
      {at ? <LocalStamp at={at} /> : null}
    </span>
  );
}
