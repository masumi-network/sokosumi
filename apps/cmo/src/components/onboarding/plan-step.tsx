"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, CircleAlert, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useRef, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { changeIdeas } from "../../lib/change-ideas";
import { channelInfo } from "../../lib/channels";
import { strategyApproved } from "../../lib/strategy";
import { CusoAvatar } from "../cuso";
import { EntrySheet } from "../entry-sheet";
import { AdBudget, money, PACES, PacePicker } from "../strategy-core";
import { outcomeLine } from "../strategy-reveal";
import { SubmitButton } from "../submit-button";
import {
  type Answer,
  AssumptionChip,
  Checklist,
  GoalBlock,
  NoteField,
  PLANNING_PHASES,
  RetryButton,
  useAnswers,
  useElapsed,
  workChecklist,
} from "./parts";
import {
  type ConnectMeasurement,
  MonthPanel,
  PlanPanel,
  type PlanTab,
  ResultsPanel,
  TABS,
} from "./plan-tabs";
import { Refusal } from "./refusal";
import { type PlanPhase, planUnfitted } from "./step";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Work = NonNullable<CmoOverview["work"]>;
type Step = Work["steps"][number];
type FeedRow = Omit<Step, "at">;

/** Next tab index for arrow / Home / End keys; null when the key is unrelated. */
export function planTabAfterKey(
  event: Pick<KeyboardEvent<HTMLButtonElement>, "key">,
  index: number,
): number | null {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    return (index + 1) % TABS.length;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    return (index - 1 + TABS.length) % TABS.length;
  }
  if (event.key === "Home") return 0;
  if (event.key === "End") return TABS.length - 1;
  return null;
}

/**
 * Planning as the founder can follow it: the plan's first save brings the
 * idea, channels and pillars, then the calendar fills in. Cuso writes each
 * save in one go, so the running row says what he is on.
 */
export function planningRows(
  steps: Step[],
  strategy: Strategy | null,
  running: boolean,
): FeedRow[] {
  const rows: FeedRow[] = steps.filter((step) => step.kind !== "strategy");
  if (strategy) {
    const done = { status: "done", url: null } as const;
    const idea = strategy.idea?.sentence ?? strategy.summary;
    if (idea) rows.push({ ...done, id: "idea", kind: "strategy", label: idea });
    const goal = outcomeLine(strategy);
    if (goal) {
      rows.push({
        ...done,
        id: "goal",
        kind: "strategy",
        label: `Goal: ${goal}`,
      });
    }
    for (const channel of strategy.channels) {
      rows.push({
        ...done,
        id: `channel:${channel.channel}`,
        kind: "other",
        label: `${channelInfo(channel.channel)?.name ?? channel.channel}, ${channel.cadence}`,
      });
    }
    for (const pillar of strategy.pillars) {
      rows.push({
        ...done,
        id: `pillar:${pillar.name}`,
        kind: "brain",
        label: `${pillar.name}: ${pillar.share}% of pieces`,
      });
    }
  }
  if (running) {
    const pieces = strategy?.calendar.length ?? 0;
    // On top, so what Cuso is on stays in view above the plan so far.
    rows.unshift({
      id: strategy ? "calendar" : "plan",
      kind: "strategy",
      label: !strategy
        ? "Choosing your idea, channels and pillars"
        : pieces > 0
          ? `Writing four weeks, day by day: ${pieces} pieces so far`
          : "Writing four weeks, day by day",
      url: null,
      status: "running",
    });
  }
  return rows;
}

const ANSWER_WORDS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  unsure: "Not sure",
  "": "Not answered",
};

interface PlanStepProps {
  overview: CmoOverview;
  phase: PlanPhase;
  /** The tab to open, such as Results after a measurement connection. */
  initialTab?: PlanTab;
  /** Cuso writes or changes the plan; a refusal comes back as text. */
  onRequest: (note?: string) => Promise<string | null>;
  /** The owner's own monthly ad budget; a refusal comes back as text. */
  onSetAds: (monthly: number, currency: string) => Promise<string | null>;
  onAnswer: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  /** A no changed something: Cuso fits the plan to the answers. */
  onUpdate: () => Promise<string | null>;
  onApprove: () => Promise<void>;
  onConnectMeasurement: ConnectMeasurement;
  /** The plan was just requested: wait for Cuso's work to show up. */
  starting?: boolean;
  /** Set when the founder opened the plan again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
}

/**
 * The plan in one place: Cuso writing it, then the goal, his assumptions to
 * check, the plan itself, the month and how the founder will know it works.
 * While Cuso writes or changes it, the plan stays on screen and fills in.
 */
export function PlanStep(props: PlanStepProps) {
  const { overview, phase, onRequest } = props;
  if (phase === "planning") {
    return (
      <Planning
        overview={overview}
        starting={props.starting ?? false}
        onRetry={() => onRequest()}
      />
    );
  }
  if (phase === "writing-needed" || !overview.strategy) {
    return <WriteNeeded overview={overview} onWrite={() => onRequest()} />;
  }
  return <PlanReview {...props} />;
}

interface PlanningProps {
  overview: CmoOverview;
  starting: boolean;
  onRetry: () => Promise<string | null>;
}

/** The first plan is being written: the checklist, and the way to try again. */
function Planning({ overview, starting, onRetry }: PlanningProps) {
  const work = overview.work;
  const running =
    starting || (work?.kind === "strategy" && work.status === "running");
  const noCredits = !running && overview.billing.availableCredits <= 0;
  const elapsed = useElapsed(work?.startedAt, running);
  const rows = planningRows(
    work?.kind === "strategy" ? work.steps : [],
    overview.strategy ?? null,
    running,
  );
  return (
    <section className="panel ob-wait">
      <div className={running ? "card ob-says" : "card card-focus ob-says"}>
        <CusoAvatar pose="reporting" size={96} />
        <h1 className="ob-h1">
          {running ? "Writing your plan" : "Planning stopped"}
        </h1>
        {noCredits ? (
          <Refusal text="credits" topUpUrl={overview.subscribeUrl} />
        ) : (
          <p className="muted">
            {running
              ? `Every post and ad ${AGENT_NAME} will make, and when. This takes a few minutes.`
              : `Nothing was lost. Try again and I start over.`}
          </p>
        )}
        {elapsed ? <p className="ob-small muted num">{elapsed}</p> : null}
        <Checklist
          items={workChecklist(
            work?.kind === "strategy" ? work.steps : [],
            PLANNING_PHASES,
            running,
          )}
        />
        <div className="ob-feed" aria-label="What Cuso is writing">
          <p className="ob-feed-title">
            <span className={running ? "ob-live on" : "ob-live"} />
            {running ? "Live" : "What Cuso wrote"}
          </p>
          {rows.length === 0 ? (
            <p className="ob-feed-empty">
              {running ? "Getting started…" : "Nothing yet."}
            </p>
          ) : (
            <ul className="ob-feed-list">
              <AnimatePresence initial={false}>
                {rows.map((step, index) => (
                  <motion.li
                    key={step.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.25,
                      ease: [0.25, 1, 0.5, 1] as const,
                      delay: Math.min(index, 12) * 0.12,
                    }}
                    className={`ob-feed-item ${step.status}${step.id === "idea" ? " wrap" : ""}`}
                  >
                    <span className="ob-feed-label">{step.label}</span>
                    <span className="ob-feed-state" aria-hidden="true">
                      {step.status === "running" ? (
                        <Loader2 size={14} className="spin" />
                      ) : step.status === "failed" ? (
                        <CircleAlert size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
        {running ? null : (
          <RetryButton onRetry={onRetry} topUpUrl={overview.subscribeUrl} />
        )}
      </div>
    </section>
  );
}

interface WriteNeededProps {
  overview: CmoOverview;
  onWrite: () => Promise<string | null>;
}

/** Brand is confirmed and nothing writes the plan: one button does. */
function WriteNeeded({ overview, onWrite }: WriteNeededProps) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <section className="panel ob-wait">
      <div className="card card-focus ob-says">
        <CusoAvatar pose="reporting" size={96} />
        <h1 className="ob-h1">Ready to write your plan</h1>
        <p className="muted">
          I build it from your Brand Brain and your answers.
        </p>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                setRefusal(await onWrite());
              } catch {
                setRefusal("That didn't go through. Try again in a moment.");
              }
            })
          }
        >
          {pending ? "Starting…" : "Write my plan"}
          {pending ? null : <ArrowRight size={16} aria-hidden="true" />}
        </button>
        {refusal ? (
          <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
        ) : null}
      </div>
    </section>
  );
}

interface PlanReviewProps extends Omit<PlanStepProps, "phase" | "starting"> {
  /** Shows the plan as it stands: no answers, pace, budget or approval. */
  readOnly?: boolean;
}

/** The goal, what was checked and the plan's tabs; reused by the app's Strategy page. */
export function PlanReview({
  overview,
  readOnly = false,
  initialTab = "plan",
  onRequest,
  onSetAds,
  onAnswer,
  onUpdate,
  onApprove,
  onConnectMeasurement,
  ahead,
}: PlanReviewProps) {
  const strategy = overview.strategy as Strategy;
  const [tab, setTab] = useState<PlanTab>(initialTab);
  const [open, setOpen] = useState<Entry | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  // The change on its way to Cuso, in a few words.
  const [sending, setSending] = useState<string | null>(null);
  const changing = sending !== null;
  const [going, startGoing] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const work = overview.work;
  const writing = work?.kind === "strategy" && work.status === "running";
  // The plan arrives in one save; only a change can stop half way.
  const stopped =
    work?.kind === "strategy" && work.status === "failed" && asked !== null;
  const busy = writing || changing;
  // From the tap until the new plan lands, the old one is not shown as if it held.
  const replanning = sending ?? (writing && asked ? asked : null);
  const changes = strategy.changes ?? [];
  const approved = strategyApproved(overview);
  const locked = readOnly || approved;
  const [questions, answer] = useAnswers(strategy.questions ?? [], onAnswer);
  // A no is fitted once Cuso has changed the plan; until then, update it.
  const unfitted = planUnfitted({
    ...overview,
    strategy: { ...strategy, questions },
  });
  const pieces = strategy.calendar.length;
  const pages =
    overview.brandMedia?.pages.filter((page) => page.device === "desktop")
      .length ?? 0;

  // Plain async, not a transition: React holds a transition's state updates
  // until it ends, and the re-planning screen must show on the tap. A refusal
  // throws so the control that asked can stay open.
  async function send(label: string, run: () => Promise<string | null>) {
    setSending(label);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const refused = await run();
      setRefusal(refused);
      if (refused) throw new Error(refused);
      setAsked(label);
    } finally {
      setSending(null);
    }
  }

  function requestChange(text: string) {
    const request = text.trim();
    if (!request) return;
    send(request, () => onRequest(request)).then(
      () => {
        setNote("");
        setAsking(false);
      },
      () => {},
    );
  }

  const written = strategy.contentLanguage
    ? ` Written in ${strategy.contentLanguage}.`
    : "";
  const line =
    pages > 0
      ? `${AGENT_NAME} · built from your answers and ${pages} ${pages === 1 ? "page" : "pages"} of your site.${written}`
      : `${AGENT_NAME} · ${pieces} ${pieces === 1 ? "piece" : "pieces"} for the next four weeks.${written}${approved ? "" : " Nothing goes out until you approve the plan."}`;
  // The short goal is the headline; the long sentence sits under it.
  const sentence = strategy.idea?.sentence ?? strategy.summary;
  const goal = outcomeLine(strategy) || firstClause(sentence);

  const primary = ahead ? (
    <button type="button" className="button" onClick={ahead.onClick}>
      Continue to {ahead.label}
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  ) : locked ? null : !overview.viewerCanApprove && !unfitted ? (
    <p className="muted">An owner or admin approves the plan.</p>
  ) : (
    <button
      type="button"
      className="button"
      disabled={going || busy}
      onClick={() => {
        setRefusal(null);
        // Same path as a change, and not in a transition (which would hold
        // the waiting screen back): the plan waits while Cuso refits it.
        if (unfitted) {
          send("Fitting your plan to your answers", onUpdate).catch(() => {});
          return;
        }
        // A refused approval (a new version on its way) stays here.
        startGoing(async () => {
          try {
            await onApprove();
          } catch {
            setRefusal("That didn't go through. Try again in a moment.");
          }
        });
      }}
    >
      {going ? (
        "Approving…"
      ) : writing ? (
        <>
          <Loader2 size={16} className="spin" aria-hidden="true" />
          {asked
            ? `${AGENT_NAME} is changing it`
            : `${AGENT_NAME} is finishing`}
        </>
      ) : (
        <>
          {unfitted ? "Update plan" : "Approve plan"}
          <ArrowRight size={16} aria-hidden="true" />
        </>
      )}
    </button>
  );

  const ads = strategy.ads;
  const pace = PACES.find((option) => option.level === strategy.pace?.level);
  const hasChecks = questions.length > 0 || strategy.pace || ads;

  return (
    <section className="ob-plan">
      <div className="ob-title-row">
        <CusoAvatar pose="reporting" size={48} />
        <div className="ob-title-copy">
          <p className="muted">{line}</p>
        </div>
        <div className="ob-title-action">
          {locked ? null : (
            <button
              type="button"
              className="button button-secondary"
              aria-expanded={asking}
              disabled={busy}
              onClick={() => {
                setAsking(!asking);
                if (!asking) window.setTimeout(() => input.current?.focus(), 0);
              }}
            >
              Ask for a change
            </button>
          )}
          {primary}
        </div>
      </div>

      {asking && !locked ? (
        <div className="panel">
          <form
            className="card ob-change"
            onSubmit={(event) => {
              event.preventDefault();
              requestChange(note);
            }}
          >
            <label htmlFor="ob-change-input">
              Tell {AGENT_NAME} what to change
            </label>
            <div className="ob-change-row">
              <input
                id="ob-change-input"
                ref={input}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. “More videos, fewer text posts”"
                disabled={busy}
              />
              <SubmitButton className="button button-secondary">
                {changing ? (
                  <Loader2 size={14} className="spin" aria-hidden="true" />
                ) : null}
                Change it
              </SubmitButton>
            </div>
            <div className="ob-ideas">
              {changeIdeas(overview).map((idea) => (
                <button
                  key={idea}
                  type="button"
                  className="button button-secondary button-small"
                  disabled={busy}
                  onClick={() => {
                    setNote(idea);
                    input.current?.focus();
                  }}
                >
                  {idea}
                </button>
              ))}
            </div>
          </form>
        </div>
      ) : null}

      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
      {stopped ? (
        <p className="alert" role="alert">
          {asked
            ? "That change didn't go through. Ask again."
            : `${AGENT_NAME} stopped before he finished. Ask him to finish the plan.`}
        </p>
      ) : null}

      {replanning ? (
        <div className="panel">
          <div className="card ob-replanning" role="status">
            <Loader2 size={20} className="spin" aria-hidden="true" />
            <p className="ob-value">{AGENT_NAME} is re-planning your month</p>
            <p className="muted">
              {replanning}. About two minutes; your new plan opens here.
            </p>
          </div>
        </div>
      ) : null}

      <div className="ob-plan-body panel" hidden={replanning !== null}>
        <GoalBlock
          label="The goal"
          headline
          goal={goal}
          statement={sentence !== goal ? sentence : undefined}
          facts={goalFacts(strategy)}
        />

        {changes.length > 0 && !writing ? (
          <div className="card ob-changed">
            <h2>What changed</h2>
            <ul className="ob-list">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {locked && hasChecks ? (
          <div className="card ob-checks">
            <h2>{approved ? "What you approved" : "Your answers"}</h2>
            <ul className="ob-approved">
              {questions.map((question) => (
                <li key={question.id}>
                  {question.question}{" "}
                  <b>{ANSWER_WORDS[question.answer ?? ""]}</b>
                  {question.answer === "no" && question.note
                    ? `: ${question.note}`
                    : ""}
                </li>
              ))}
              {pace ? (
                <li>
                  Pace: <b>{pace.name}</b>, {pace.does.toLowerCase()}
                </li>
              ) : null}
              {ads ? (
                <li>
                  {ads.monthly > 0
                    ? `${money(ads.monthly, ads.currency)} a month for ads`
                    : "No ads"}
                </li>
              ) : null}
            </ul>
          </div>
        ) : hasChecks ? (
          <div
            className={
              questions.some((question) => !question.answer)
                ? "card card-focus ob-checks"
                : "card ob-checks"
            }
          >
            <h2>Check these</h2>
            {questions.map((question) => (
              <PlanQuestionChip
                key={question.id}
                question={question}
                onAnswer={(value, text) => answer(question.id, value, text)}
              />
            ))}
            {strategy.pace ? (
              <div className="ob-pace">
                <PacePicker
                  pace={strategy.pace}
                  onAsk={(text, label) =>
                    send(label ?? text, () => onRequest(text))
                  }
                />
              </div>
            ) : null}
            {ads ? (
              <div className="ob-budget">
                <div className="ob-budget-row">
                  <p>
                    {ads.monthly > 0
                      ? `${money(ads.monthly, ads.currency)} a month for ads`
                      : "No ads"}
                  </p>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    aria-expanded={budgetOpen}
                    onClick={() => setBudgetOpen(!budgetOpen)}
                  >
                    {ads.monthly > 0 ? "Change" : "Add a budget"}
                  </button>
                </div>
                {budgetOpen ? (
                  <AdBudget
                    ads={ads}
                    onSetAds={(monthly, currency) =>
                      send(`Ad budget: ${currency} ${monthly} a month`, () =>
                        onSetAds(monthly, currency),
                      )
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ob-tabs" role="tablist" aria-label="Plan">
          {TABS.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              id={`ob-tab-${candidate.id}`}
              aria-selected={tab === candidate.id}
              aria-controls={`ob-tabpanel-${candidate.id}`}
              tabIndex={tab === candidate.id ? 0 : -1}
              onClick={() => setTab(candidate.id)}
              onKeyDown={(event) => {
                const next = planTabAfterKey(event, index);
                if (next === null) return;
                event.preventDefault();
                setTab(TABS[next]!.id);
                document.getElementById(`ob-tab-${TABS[next]!.id}`)?.focus();
              }}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <div
          className="card ob-tabpanel"
          role="tabpanel"
          id={`ob-tabpanel-${tab}`}
          aria-labelledby={`ob-tab-${tab}`}
        >
          {tab === "plan" ? (
            <PlanPanel
              overview={overview}
              strategy={strategy}
              onAsk={
                locked
                  ? undefined
                  : (text, label) => send(label ?? text, () => onRequest(text))
              }
            />
          ) : tab === "month" ? (
            <MonthPanel strategy={strategy} onOpen={setOpen} />
          ) : (
            <ResultsPanel
              overview={overview}
              strategy={strategy}
              onConnectMeasurement={onConnectMeasurement}
            />
          )}
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <EntrySheet
            entry={open}
            media={overview.media.find((item) => item.entryId === open.id)}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/** "We'll reach X, show Y, and invite Z." → "We'll reach X". */
function firstClause(text: string): string {
  const clause = text.split(/[,;.]/)[0]?.trim() ?? text;
  return clause || text;
}

/** Who, what, where and how much, from whatever the plan fills in. */
function goalFacts(strategy: Strategy): { term: string; value: string }[] {
  const who =
    strategy.focus?.segment ?? strategy.idea?.who ?? strategy.audience;
  const offer =
    strategy.offer?.what ?? strategy.idea?.offer ?? strategy.ladder?.core.what;
  const where = strategy.channels
    .map((channel) => channelLabel(channel.channel))
    .join(", ");
  const pieces = strategy.calendar.length;
  const facts = [
    { term: "Who", value: who },
    { term: "The offer", value: offer },
    { term: "Where", value: where },
    {
      term: "This month",
      value: pieces > 0 ? `${pieces} ${pieces === 1 ? "piece" : "pieces"}` : "",
    },
  ];
  return facts.filter((fact): fact is { term: string; value: string } =>
    Boolean(fact.value),
  );
}

interface PlanQuestionChipProps {
  question: { question: string; answer?: Answer; note?: string };
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
}

/** One of Cuso's assumptions: Yes, or No with what is true instead. */
function PlanQuestionChip({ question, onAnswer }: PlanQuestionChipProps) {
  const [correcting, setCorrecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = (value: Answer, text?: string) => {
    setFailed(false);
    setCorrecting(false);
    onAnswer(value, text).catch(() => setFailed(true));
  };
  return (
    <AssumptionChip
      question={question.question}
      yes={{
        pressed: !correcting && question.answer === "yes",
        onClick: () => save("yes"),
      }}
      other={{
        pressed: correcting || question.answer === "no",
        onClick: () => setCorrecting(true),
      }}
      unsure={{
        pressed: !correcting && question.answer === "unsure",
        onClick: () => save("unsure"),
      }}
    >
      {correcting ? (
        <NoteField
          initial={question.note ?? ""}
          onSave={(text) => save("no", text)}
        />
      ) : question.answer === "no" && question.note ? (
        <p className="ob-question-said">{question.note}</p>
      ) : null}
      {failed ? (
        <p className="alert" role="alert">
          That didn't save. Try again.
        </p>
      ) : null}
    </AssumptionChip>
  );
}
