"use client";

import "./onboarding.css";
import "./brief.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { AGENT_NAME } from "../../lib/agent";
import type { BrandSectionKey } from "../../lib/brand-sections";
import type { SocialProvider } from "../../lib/calendar";
import { channelKey } from "../../lib/channels";
import type { CusoMessage } from "../../lib/chat-messages";
import {
  listenForConnectDone,
  openConnectWindow,
} from "../../lib/connect-window";
import type { SkippedStep } from "../../lib/skipped-steps";
import type { CusoPose } from "../../lib/thread";
import { AccountMenu } from "../account-menu";
import { adsReturnError } from "../ads";
import { hostOf } from "../brand-profile";
import { Logo } from "../logo";
import type { AnswerInput, OnboardingActions } from "./actions";
import {
  type Ask,
  askKey,
  askProgress,
  type BriefDone,
  type BriefLocal,
  briefAsks,
  briefStage,
  planUnfitted,
  type StageId,
  stageMarks,
  workingStatus,
} from "./brief";
import { type BarMode, BriefBar, StageBar } from "./brief-bar";
import { ChatAsk, type ChatHandlers, WelcomeBack } from "./brief-chat";
import { BriefMain } from "./brief-main";
import { researchGroups, USUAL_SECONDS } from "./live";
import { connectedNetworks, strategySocialChannels } from "./networks";
import { Refusal } from "./refusal";

const POLL_MS = 2_500;
/** A hidden tab still checks in, so coming back shows where Cuso is now. */
const HIDDEN_POLL_MS = 20_000;
/** How often the flow checks whether the person closed a connect window. */
const POPUP_CHECK_MS = 500;
const CONNECT_FAILED = "That connection didn't finish. Try again.";
const FITTING = "Fitting your plan to your answers";

/** Briefing steps done on this device; Core keeps no record of them. */
function briefedKey(projectId: string) {
  return `cmo-briefed-${projectId}`;
}

function readBriefed(projectId: string): BriefDone[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(briefedKey(projectId)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((step): step is BriefDone =>
          ["plan", "pace", "ads", "checks"].includes(step),
        )
      : [];
  } catch {
    return [];
  }
}

function writeBriefed(projectId: string, steps: BriefDone[]) {
  try {
    window.localStorage.setItem(briefedKey(projectId), JSON.stringify(steps));
  } catch {
    // A private window keeps them for this visit only.
  }
}

/** The stage this device last showed, so coming back can say what moved. */
function seenKey(projectId: string) {
  return `cmo-seen-${projectId}`;
}

function readSeen(projectId: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(projectId));
  } catch {
    return null;
  }
}

function writeSeen(projectId: string, stage: string) {
  try {
    window.localStorage.setItem(seenKey(projectId), stage);
  } catch {
    // Without storage, coming back reads as a first visit.
  }
}

/** Cuso stopped the read to ask something in words, instead of a Brand Brain. */
function askedInWords(overview: CmoOverview, messages: CusoMessage[]) {
  if (overview.brandBrain) return false;
  const settled =
    overview.work?.kind === "research"
      ? overview.work.status
      : overview.learning;
  return (
    settled !== "running" &&
    overview.learning !== "failed" &&
    overview.work?.status !== "failed" &&
    messages.some((message) => message.fromCuso)
  );
}

/**
 * Past the usual time, or past twice it, for a whole read or plan. It renders
 * again only when a threshold passes, never every second.
 */
function useSlowness(overview: CmoOverview): BriefLocal["slow"] {
  const work = overview.work;
  const whole = work?.status === "running" && !work.change ? work : null;
  const started = whole ? new Date(whole.startedAt).getTime() : null;
  const usual = whole ? USUAL_SECONDS[whole.kind] * 1_000 : 0;
  const [, passed] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (started === null) return;
    const timers = [usual, usual * 2]
      .map((at) => started + at - Date.now())
      .filter((wait) => wait > 0)
      .map((wait) => window.setTimeout(passed, wait));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [started, usual]);
  if (started === null) return "none";
  const elapsed = Date.now() - started;
  return elapsed >= usual * 2 ? "stuck" : elapsed >= usual ? "slow" : "none";
}

/** The pose follows the state. */
function poseFor(mode: BarMode["kind"], overview: CmoOverview): CusoPose {
  if (mode === "asking" || mode === "folded") return "needs-you";
  if (mode === "live") return "done";
  return overview.work?.kind === "research" ? "reading" : "thinking";
}

interface OnboardingFlowProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  /** What this person skipped in hiring, from CMO's cookie. */
  skipped?: SkippedStep[];
  /** Briefing steps already gone through; this device's own are added. */
  briefed?: BriefDone[];
  /** Launch was pressed: the fixture screens start on Your month with it. */
  launched?: boolean;
  /**
   * The welcome back: unset, it shows when Cuso moved on since this device
   * last looked; true or false force it (the fixture screens).
   */
  welcome?: boolean | undefined;
  actions: OnboardingActions;
}

/**
 * Brief me: CMO's first run. The page shows one result at a time; the bar at
 * the bottom shows the seven stages and either what Cuso is doing or the one
 * thing he needs, asked in the chat. Research and the plan run in Core as
 * they always do; only how they are shown changes here.
 */
export function OnboardingFlow({
  overview: initialOverview,
  messages: initialMessages,
  skipped: initialSkipped = [],
  briefed: initialBriefed = [],
  launched: initialLaunched = false,
  welcome,
  actions,
}: OnboardingFlowProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [skipped, setSkipped] = useState(initialSkipped);
  const { projectId } = overview;
  const [briefed, setBriefed] = useState<BriefDone[]>(initialBriefed);
  const [launched, setLaunched] = useState(initialLaunched);
  // The question folded with Later or Esc; a new question opens the chat.
  const [foldedAt, setFoldedAt] = useState<string | null>(null);
  // Several things waited when the person came back: say so first.
  const [away, setAway] = useState(false);
  // The change just sent, in the person's words, while Cuso patches.
  const [changing, setChanging] = useState<string | null>(null);
  // Why Core refused something the chat sent, shown in the chat.
  const [notice, setNotice] = useState<string | null>(null);
  // The chat's free text field, which a tapped piece writes into.
  const [draft, setDraft] = useState("");
  // A finished stage the person looks back at; the chat stays on the current.
  const [viewing, setViewing] = useState<StageId | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const state = await actions.loadState().catch(() => null);
    if (!state?.overview) return;
    setOverview(state.overview);
    setMessages(state.messages);
  }, [actions]);

  useEffect(() => {
    let last = Date.now();
    const poll = () => {
      const visible = document.visibilityState === "visible";
      if (!visible && Date.now() - last < HIDDEN_POLL_MS) return;
      last = Date.now();
      void refresh();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  const work = overview.work;
  const running = work?.status === "running";
  const slow = useSlowness(overview);
  const local: BriefLocal = {
    briefed,
    skipped,
    launched,
    askedInWords: askedInWords(overview, messages),
    slow,
  };

  // Read once on this device, after the first render (the server has none).
  const initial = useRef({ overview: initialOverview, local });
  // The stage this device showed last time, read before this visit writes it.
  const seenBefore = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const loaded = [
      ...new Set([...initial.current.local.briefed, ...readBriefed(projectId)]),
    ];
    setBriefed(loaded);
    const waitingThen = briefAsks(initial.current.overview, {
      ...initial.current.local,
      briefed: loaded,
    });
    // Coming back: Cuso moved on while the person was away. While he still
    // works, or on a reload where they left off, they are not coming back.
    const stage = briefStage(initial.current.overview, {
      ...initial.current.local,
      briefed: loaded,
    });
    if (seenBefore.current === undefined) {
      seenBefore.current = readSeen(projectId);
    }
    const movedOn =
      welcome ??
      (initial.current.overview.work?.status !== "running" &&
        seenBefore.current !== stage);
    setAway(movedOn && waitingThen.length >= 2);
  }, [projectId, welcome]);

  // A patch that landed (or never started) clears the change in words.
  useEffect(() => {
    if (changing && !(work?.kind === "strategy" && running)) {
      const timer = window.setTimeout(() => setChanging(null), POLL_MS * 2);
      return () => window.clearTimeout(timer);
    }
  }, [changing, work?.kind, running]);

  const stage = briefStage(overview, local);
  useEffect(() => writeSeen(projectId, stage), [projectId, stage]);
  const asks = briefAsks(overview, local);
  const ask: Ask | null = asks[0] ?? null;
  const key = ask ? askKey(ask) : null;
  // One count: the dock's "3 of 6", and what is left of it everywhere else.
  const progress = askProgress(overview, local, ask);
  const waiting = progress ? progress.of - progress.at + 1 : asks.length;
  const folded = key !== null && foldedAt === key;
  // A refusal belongs to the question it answered.
  useEffect(() => {
    if (key) setNotice(null);
  }, [key]);

  // The tab says when Cuso needs you.
  const title = useRef<string | null>(null);
  useEffect(() => {
    title.current ??= document.title;
    document.title =
      waiting > 0
        ? `(${waiting}) ${AGENT_NAME} needs you`
        : (title.current ?? document.title);
  }, [waiting]);
  useEffect(
    () => () => {
      if (title.current) document.title = title.current;
    },
    [],
  );

  const brief = (step: BriefDone) =>
    setBriefed((current) => {
      const next = [...new Set([...current, step])];
      writeBriefed(projectId, next);
      return next;
    });

  /** Keeps the overview a call brought back; its error, if any, is the answer. */
  const settle = (result: {
    overview: CmoOverview | null;
    error: string | null;
  }) => {
    if (result.overview) setOverview(result.overview);
    return result.error;
  };
  const request = async () => settle(await actions.requestStrategy());
  const fixSection = async (section: BrandSectionKey | null, note: string) => {
    const refused = await actions.fixBrandSection(section, note);
    if (!refused) void refresh();
    return refused;
  };
  const applyPlan = async () => {
    setChanging(FITTING);
    const refused = settle(await actions.applyPlanAnswers());
    if (refused) setChanging(null);
    return refused;
  };

  const connect = useConnect(overview, actions, refresh);
  const plan = overview.approvedStrategy ?? overview.strategy;
  const connected = connectedNetworks(overview);
  const networks = strategySocialChannels(overview).map((key) => ({
    key,
    pieces: (plan?.calendar ?? []).filter(
      (entry) => channelKey(entry.channel) === key,
    ).length,
    connected: connected.has(key),
  }));

  const handlers: ChatHandlers = {
    answerBrand: async (questionId, answer, note) => {
      const input: AnswerInput = { questionId, answer, note };
      setOverview(await actions.answerBrandQuestion(input));
      // While Cuso reads, the plan he starts next takes the no in. Afterwards
      // it is a fix to its one section, which Core runs now or once his
      // current turn ends.
      const question = overview.brandBrain?.questions?.find(
        (candidate) => candidate.id === questionId,
      );
      const reading = work?.kind === "research" && running;
      if (answer !== "no" || !question || reading) return;
      setNotice(
        await fixSection(
          question.section,
          note?.trim() || `Not true: ${question.statement}`,
        ),
      );
    },
    confirmBrand: async () => {
      setOverview(await actions.approveBrandBrain());
      // Core starts the plan when the research ends, and again once a fix
      // that ran first lands: confirming starts nothing while Cuso writes,
      // or once a plan is written.
      const busy = work?.kind === "strategy" && running;
      if (overview.strategy !== null || busy) return null;
      return request();
    },
    fixBrand: fixSection,
    retryResearch: async () => {
      const result = await actions.retryLearning();
      setOverview(result.overview);
      return result.error;
    },
    reply: async (text) => {
      await actions.sendMessage(text);
      await refresh();
    },
    retryPlan: async () =>
      // Past twice the usual time Core replaces the running plan; a stopped
      // or never started plan is simply asked for again.
      work?.kind === "strategy" && running && researchGroups(overview)
        ? settle(await actions.restartStrategy())
        : request(),
    patch: async (note, label) => {
      setChanging(label);
      try {
        const refused = settle(await actions.requestStrategy(note, true));
        if (refused) setChanging(null);
        return refused;
      } catch (error) {
        setChanging(null);
        throw error;
      }
    },
    brief,
    answerPlan: async (questionId, answer, note) => {
      const next = await actions.answerPlanQuestion({
        questionId,
        answer,
        note,
      });
      // All the nos become one patch once the last check is answered. It
      // starts before the answers show, so no "Change the plan" flashes up
      // and runs itself; a refusal leaves that ask to press.
      const open = (next.strategy?.questions ?? []).some(
        (question) => !question.answer,
      );
      if (open || !planUnfitted(next)) {
        setOverview(next);
        return;
      }
      setChanging(FITTING);
      const result = await actions.applyPlanAnswers();
      setOverview(result.overview ?? next);
      if (result.error) {
        setChanging(null);
        setNotice(result.error);
      }
    },
    applyPlan,
    setAds: async (monthly, currency) => {
      setChanging(monthly > 0 ? "Setting your ad budget" : "Removing the ads");
      const refused = settle(await actions.setAdBudget(monthly, currency));
      if (refused) setChanging(null);
      else brief("ads");
      return refused;
    },
    approve: async () => {
      setOverview(await actions.approveStrategy());
      return null;
    },
    connect: connect.connect,
    launch: () => setLaunched(true),
  };

  const marks = stageMarks(overview, local);
  // Only a finished stage is looked back at; it stays shown when the current
  // stage moves on, and the current stage itself is the page as usual.
  const looking =
    marks.find((mark) => mark.id === viewing && mark.state === "done")?.id ??
    null;
  const view = (id: StageId) => {
    setViewing(id === stage ? null : id);
    document.getElementById("brief-main")?.scrollIntoView?.({ block: "start" });
  };
  const status = workingStatus(overview, local);
  if (changing && work?.kind === "strategy" && running && work.change) {
    status.title = changing;
  }
  const later = () => {
    if (!ask) return;
    setAway(false);
    // Questions that may be skipped stay skipped on this device; the rest
    // only fold until the next question.
    if (ask.kind === "brand-question") {
      void actions.skipBrandQuestions().then(setOverview, () => {});
      setSkipped((current) => [...new Set([...current, "questions" as const])]);
    } else if (ask.kind === "plan-question") {
      brief("checks");
    } else {
      setFoldedAt(key);
    }
  };

  let mode: BarMode;
  if (stage === "month") {
    mode = {
      kind: "live",
      status,
      onGoToday: () => void actions.finishAccounts(),
    };
  } else if (!ask) {
    mode = { kind: "working", status };
  } else if (folded) {
    mode = {
      kind: "folded",
      waiting,
      onOpen: () => setFoldedAt(null),
    };
  } else if (away) {
    mode = {
      kind: "asking",
      count: "",
      askKey: "away",
      onLater: () => {
        setAway(false);
        setFoldedAt(key);
      },
      chat: <WelcomeBack waiting={waiting} onStart={() => setAway(false)} />,
    };
  } else {
    mode = {
      kind: "asking",
      count: progress ? `${progress.at} of ${progress.of}` : "",
      askKey: key ?? "",
      onLater: later,
      chat: (
        <>
          <ChatAsk
            key={key}
            ask={ask}
            overview={overview}
            messages={messages}
            handlers={handlers}
            connect={{
              networks,
              pending: connect.pending,
              error: connect.error,
            }}
            draft={draft}
            setDraft={setDraft}
            draftRef={draftRef}
          />
          {notice ? (
            <Refusal text={notice} topUpUrl={overview.subscribeUrl} />
          ) : null}
        </>
      ),
    };
  }

  return (
    <div className="ob brief">
      <header className="ob-top brief-top">
        <Logo />
        <span />
        <AccountMenu
          label={hostOf(overview.websiteUrl)}
          startOver={actions.startOver}
          signOut={actions.signOut}
        />
      </header>
      <StageBar marks={marks} viewing={looking} onView={view} />
      <BriefMain
        overview={overview}
        stage={stage}
        ask={ask}
        local={local}
        messages={messages}
        away={away && mode.kind === "asking"}
        networks={networks}
        onPick={(entry) => {
          setFoldedAt(null);
          setDraft(`Change “${entry.title}”: `);
          window.setTimeout(() => draftRef.current?.focus(), 0);
        }}
        viewing={looking}
        onBack={() => setViewing(null)}
        onConnectMeasurement={(provider) =>
          actions.connectMeasurement(provider, "onboarding")
        }
        brand={{
          onFix: async (section, note) => {
            const refused = await fixSection(section, note);
            if (refused) throw new Error(refused);
          },
          onSave: async (brain) => {
            setOverview(await actions.saveBrandBrain(brain));
          },
          onCorrect: async (text) => {
            await actions.sendMessage(text);
            await refresh();
          },
        }}
      />
      <BriefBar pose={poseFor(mode.kind, overview)} mode={mode} />
    </div>
  );
}

/**
 * Connect a network in a popup that tells this page when it is done, and
 * polls at once. A blocked popup falls back to the redirect.
 */
function useConnect(
  overview: CmoOverview,
  actions: OnboardingActions,
  onReturn: () => Promise<void>,
) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why a connection came back without an account, read before the query goes.
  useEffect(() => {
    const failed =
      new URLSearchParams(window.location.search).get("connect") === "failed";
    setError(failed ? CONNECT_FAILED : adsReturnError());
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  const popupCheck = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(popupCheck.current), []);
  useEffect(
    () =>
      listenForConnectDone(overview.projectId, (result) => {
        window.clearInterval(popupCheck.current);
        setPending(null);
        setError(result === "failed" ? CONNECT_FAILED : null);
        void onReturn();
      }),
    [overview.projectId, onReturn],
  );

  function connect(key: SocialProvider) {
    setPending(key);
    setError(null);
    // Opened in the click, before any wait, so a popup blocker lets it through.
    const popup = openConnectWindow();
    void (async () => {
      try {
        const result = await actions.connectChannel(
          key,
          popup ? "popup" : "onboarding",
        );
        if (!result.url) {
          popup?.close();
          setPending(null);
          setError(result.error);
          return;
        }
        if (!popup) {
          window.location.assign(result.url);
          return;
        }
        popup.location.href = result.url;
        window.clearInterval(popupCheck.current);
        popupCheck.current = window.setInterval(() => {
          if (!popup.closed) return;
          window.clearInterval(popupCheck.current);
          setPending(null);
          void onReturn();
        }, POPUP_CHECK_MS);
      } catch {
        popup?.close();
        setPending(null);
        setError("Could not connect. Try again.");
      }
    })();
  }

  return { pending, error, connect };
}
