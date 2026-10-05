"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowUp,
  Brain,
  ChartLine,
  type LucideIcon,
  MessageSquare,
  PanelRight,
  Settings,
  Share2,
  Target,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type { CusoMessage } from "../../lib/chat-messages";
import { buildThread, cusoStatus, type ThreadItem } from "../../lib/thread";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { Logo } from "../logo";
import {
  BrandBrainCard,
  type CardActions,
  ConnectCard,
  LearningCard,
  StrategyCard,
  SubscribeCard,
  UpdateCard,
} from "./cards";
import {
  BrandBrainPage,
  ChannelsPage,
  type ConnectChannel,
  ResultsPage,
  SettingsPage,
  StrategyPage,
} from "./pages";
import { UpNext } from "./up-next";

const POLL_MS = 4_000;

/** Below this width Up next is a drawer with its own open state. */
const DRAWER_QUERY = "(max-width: 860px)";

function subscribeToDrawerQuery(onChange: () => void): () => void {
  const query = window.matchMedia(DRAWER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useDrawerLayout(): boolean {
  return useSyncExternalStore(
    subscribeToDrawerQuery,
    () => window.matchMedia(DRAWER_QUERY).matches,
    () => false,
  );
}

const VIEWS = [
  ["chat", "Cuso", MessageSquare],
  ["strategy", "Strategy", Target],
  ["results", "Results", ChartLine],
  ["brain", "Brand Brain", Brain],
  ["channels", "Channels", Share2],
  ["settings", "Settings", Settings],
] as const satisfies readonly (readonly [string, string, LucideIcon])[];
export type View = (typeof VIEWS)[number][0];

export interface CmoAppActions {
  loadState: () => Promise<{
    overview: CmoOverview | null;
    messages: CusoMessage[];
  }>;
  sendMessage: (content: string) => Promise<void>;
  approveStrategy: () => Promise<CmoOverview>;
  revertUpdate: (id: string) => Promise<CmoOverview>;
  retryLearning: () => Promise<{
    overview: CmoOverview;
    error: string | null;
  }>;
  pauseEntry: (id: string) => Promise<CmoOverview>;
  connectChannel: ConnectChannel;
  signOut: () => Promise<void>;
}

interface CmoAppProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  name: string;
  email: string;
  /** Where a redirect (a channel connection) returns to. */
  initialView?: View;
  /** The channel connection that sent the founder back did not finish. */
  connectFailed?: boolean;
  actions: CmoAppActions;
}

const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;

/**
 * Cuso and Core write Markdown: `**bold**` and `[label](url)` read badly raw.
 * Core links point into Sokosumi (e.g. `/social?postId=…`), so a relative
 * link resolves against Sokosumi's web origin and opens there.
 */
export function renderInline(
  text: string,
  webOrigin: string,
): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    const link = LINK.exec(part);
    if (link?.[1] && link[2]) {
      const href = new URL(link[2], webOrigin);
      if (href.protocol !== "https:" && href.protocol !== "http:") {
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
  if (overview.strategy && !overview.strategyApprovedAt) {
    return [
      "Post more on LinkedIn",
      "Fewer posts, more depth",
      "Push the launch harder",
    ];
  }
  if (overview.strategyApprovedAt) {
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
  name,
  email,
  initialView = "chat",
  connectFailed = false,
  actions,
}: CmoAppProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [view, setView] = useState<View>(initialView);
  const [upNextOpen, setUpNextOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerLayout = useDrawerLayout();
  const [draft, setDraft] = useState("");
  const [sending, startSending] = useTransition();
  const [highlight, setHighlight] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // A connection redirect lands on /?step=connect; keep the address clean.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/");
  }, []);

  const refresh = useCallback(async () => {
    const state = await actions.loadState().catch(() => null);
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

  const thread = buildThread(overview, messages);
  const threadLength = thread.length;
  useEffect(() => {
    if (view === "chat" && threadLength > 0) {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [threadLength, view]);

  const compose = useCallback((text: string) => {
    setView("chat");
    setDrawerOpen(false);
    setDraft(text);
    window.setTimeout(() => input.current?.focus(), 0);
  }, []);

  const cardActions: CardActions = {
    approve: async () => setOverview(await actions.approveStrategy()),
    revert: async (id) => setOverview(await actions.revertUpdate(id)),
    retryLearning: async () => {
      const result = await actions.retryLearning();
      setOverview(result.overview);
      return result.error;
    },
    compose,
    open: (target) => setView(target),
  };

  function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    startSending(async () => {
      await actions.sendMessage(content);
      await refresh();
    });
  }

  function openUpdate(id: string) {
    setView("chat");
    setHighlight(id);
    window.setTimeout(
      () =>
        document
          .getElementById(`update-${id}`)
          ?.scrollIntoView({ block: "center" }),
      0,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const status = cusoStatus(overview);
  const outOfCredits =
    overview.strategyApprovedAt !== null &&
    overview.billing.availableCredits <= 0;
  const upNextCount = overview.upNext.length;
  const host = siteHost(overview.websiteUrl);
  const displayName = businessDisplayName(overview);

  return (
    <div
      className={[
        "app",
        upNextOpen ? "" : "upnext-closed",
        drawerOpen ? "upnext-open" : "",
      ].join(" ")}
    >
      <nav className="side" aria-label="Main">
        <div className="side-head">
          <Logo />
        </div>
        <div className="business" title={overview.websiteUrl}>
          <BusinessMark overview={overview} size={28} />
          <span className="business-text">
            <span className="business-name">{displayName}</span>
            {host !== displayName ? <span className="note">{host}</span> : null}
          </span>
        </div>
        <div className="nav">
          {VIEWS.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="grow" />
        <div className="who">
          <span className="avatar" aria-hidden="true">
            {initial(name || email)}
          </span>
          <span className="who-text">
            <span className="who-name">{name || email}</span>
            {name ? <span className="note">{email}</span> : null}
          </span>
        </div>
      </nav>

      <main className="main">
        <div className="vhead">
          <h2>{VIEWS.find(([id]) => id === view)?.[1]}</h2>
          {view === "chat" ? (
            <span className="status">
              <span
                className={
                  overview.botStatus === "RUNNING" ? "dot live" : "dot"
                }
                aria-hidden="true"
              />
              {status}
            </span>
          ) : null}
          {view === "strategy" && overview.strategy ? (
            <span className={overview.strategyApprovedAt ? "tag ok" : "tag"}>
              {overview.strategyApprovedAt ? "Approved" : "Draft"}
            </span>
          ) : null}
          <span className="sp" />
          {view === "strategy" || view === "brain" ? (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => compose("")}
            >
              Change with Cuso
            </button>
          ) : null}
          {view === "chat" ? (
            <button
              type="button"
              className="button button-secondary button-small"
              aria-pressed={drawerLayout ? drawerOpen : upNextOpen}
              onClick={() => {
                if (drawerLayout) {
                  setDrawerOpen((open) => !open);
                } else {
                  setUpNextOpen((open) => !open);
                }
              }}
            >
              <PanelRight size={16} aria-hidden="true" />
              Up next <span className="count num">{upNextCount}</span>
            </button>
          ) : null}
        </div>

        {outOfCredits ? (
          <div className="banner" role="status">
            <span className="sw" aria-hidden="true" />
            <b>Cuso is paused: out of credits.</b>
            <span className="muted">
              Scheduled work waits until you top up.
            </span>
            <span className="sp" />
            <a
              className="button button-accent button-small"
              href={overview.subscribeUrl}
              target="_blank"
              rel="noreferrer"
            >
              Top up
            </a>
          </div>
        ) : null}

        {view === "chat" ? (
          <>
            <div className="scroll">
              <div className="thread">
                {thread.map((item) => (
                  <ThreadEntry
                    key={threadKey(item)}
                    item={item}
                    overview={overview}
                    actions={cardActions}
                    name={name || email}
                    highlighted={
                      item.kind === "update" && item.update.id === highlight
                    }
                  />
                ))}
                {overview.botStatus === "RUNNING" ? (
                  <CusoSays>
                    <span className="typing" aria-label="Cuso is working">
                      <i />
                      <i />
                      <i />
                    </span>
                  </CusoSays>
                ) : null}
                <div ref={end} />
              </div>
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
              <form className="composer" onSubmit={send}>
                <textarea
                  ref={input}
                  rows={2}
                  value={draft}
                  aria-label="Message Cuso"
                  placeholder="Ask Cuso anything, or tell him what to change"
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
          <div className="scroll">
            <div className="page-wide">
              {view === "strategy" ? (
                <StrategyPage overview={overview} compose={compose} />
              ) : view === "results" ? (
                <ResultsPage
                  overview={overview}
                  compose={compose}
                  openUpdate={openUpdate}
                />
              ) : view === "brain" ? (
                <BrandBrainPage overview={overview} compose={compose} />
              ) : view === "channels" ? (
                <ChannelsPage
                  overview={overview}
                  compose={compose}
                  connect={actions.connectChannel}
                  connectFailed={connectFailed}
                />
              ) : (
                <SettingsPage
                  overview={overview}
                  compose={compose}
                  name={name}
                  email={email}
                  signOut={actions.signOut}
                />
              )}
            </div>
          </div>
        )}
      </main>

      <UpNext
        overview={overview}
        today={today}
        compose={compose}
        pause={async (id) => setOverview(await actions.pauseEntry(id))}
        close={() => {
          setUpNextOpen(false);
          setDrawerOpen(false);
        }}
      />
      {drawerOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close Up next"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function threadKey(item: ThreadItem): string {
  if (item.kind === "message") return `m-${item.message.id}`;
  if (item.kind === "update") return `u-${item.update.id}`;
  return item.kind;
}

function ThreadEntry({
  item,
  overview,
  actions,
  name,
  highlighted,
}: {
  item: ThreadItem;
  overview: CmoOverview;
  actions: CardActions;
  name: string;
  highlighted: boolean;
}) {
  if (item.kind === "message") {
    if (!item.message.fromCuso) {
      return (
        <div className="msg">
          <span className="mav user" aria-hidden="true">
            {initial(name)}
          </span>
          <div className="mbody">
            <MessageMeta author={item.message.author || name} at={item.at} />
            <p className="txt">{item.message.content}</p>
          </div>
        </div>
      );
    }
    return (
      <CusoSays at={item.at}>
        <p className="txt">
          {renderInline(item.message.content, webOriginOf(overview))}
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
      case "subscribe":
        return <SubscribeCard overview={overview} />;
      case "connect":
        return <ConnectCard actions={actions} />;
      case "update":
        return (
          <div
            id={`update-${item.update.id}`}
            className={highlighted ? "flash" : undefined}
          >
            <UpdateCard
              update={item.update}
              actions={actions}
              approved={
                overview.strategyApprovedAt !== null &&
                new Date(item.update.at) >=
                  new Date(overview.strategyApprovedAt)
              }
              superseded={
                overview.strategyApprovedAt !== null &&
                new Date(item.update.at) < new Date(overview.strategyApprovedAt)
              }
            />
          </div>
        );
    }
  })();
  return card ? <CusoSays at={item.at}>{card}</CusoSays> : null;
}

function CusoSays({
  at,
  children,
}: {
  at?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="msg">
      <span className="mav" aria-hidden="true">
        <img alt="" src="/icon.svg" width={18} height={18} />
      </span>
      <div className="mbody">
        <MessageMeta author="Cuso" at={at} />
        {children}
      </div>
    </div>
  );
}

function MessageMeta({ author, at }: { author: string; at?: string }) {
  return (
    <span className="meta">
      <b>{author}</b>
      {at ? (
        <time dateTime={at} suppressHydrationWarning>
          {stamp(at)}
        </time>
      ) : null}
    </span>
  );
}

/** "14:02" today, "Mon 5 Oct, 14:02" before. */
function stamp(at: string): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === new Date().toDateString()) return time;
  const day = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day}, ${time}`;
}

function initial(text: string): string {
  return text.trim().charAt(0).toUpperCase() || "?";
}

function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
