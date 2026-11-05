"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  CalendarDays,
  Loader2,
  Repeat,
  Sparkles,
  Sun,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useRef, useState, useTransition } from "react";

import { channelLabel, formatDay, planWeeks } from "../../lib/calendar";
import { changeIdeas } from "../../lib/change-ideas";
import { strategyApproved } from "../../lib/strategy";
import { brandStyle, Section } from "../brand-profile";
import { businessDisplayName } from "../business-mark";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { withoutLabel } from "../showcases";
import {
  AdBudget,
  FunnelPlan,
  MeasureFunnel,
  money,
  PacePicker,
} from "../strategy-core";
import { Funnel } from "../strategy-funnel";
import { ChannelPlan, Mix, outcomeLine, Pillars } from "../strategy-reveal";
import {
  AGENT_NAME,
  type Answer,
  AssumptionChip,
  Checklist,
  CusoAvatar,
  GoalBlock,
  NoteField,
  PLANNING_PHASES,
  RetryButton,
  useAnswers,
  workChecklist,
} from "./parts";
import { Refusal } from "./refusal";
import { type Phase, planUnfitted } from "./step";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Measure = NonNullable<Strategy["funnel"]>[number]["measure"];

export type ConnectMeasurement = (
  provider: CmoOverview["measurement"][number]["provider"],
) => Promise<{ url: string | null; error: string | null }>;

export type PlanTab = "plan" | "month" | "results";

const TABS: { id: PlanTab; label: string }[] = [
  { id: "plan", label: "The plan" },
  { id: "month", label: "Your month" },
  { id: "results", label: "How we know it works" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"];
/** How many entries "Up first" lists. */
const UP_FIRST = 3;

interface PlanStepProps {
  overview: CmoOverview;
  phase: Extract<Phase, "planning" | "writing-needed" | "review">;
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
    return <Planning overview={overview} onRetry={() => onRequest()} />;
  }
  if (phase === "writing-needed" || !overview.strategy) {
    return <WriteNeeded overview={overview} onWrite={() => onRequest()} />;
  }
  return <PlanReview {...props} />;
}

/** The first plan is being written: the checklist, and the way to try again. */
function Planning({
  overview,
  onRetry,
}: {
  overview: CmoOverview;
  onRetry: () => Promise<string | null>;
}) {
  const work = overview.work;
  const running = work?.kind === "strategy" && work.status === "running";
  const noCredits = !running && overview.billing.availableCredits <= 0;
  return (
    <section className="ob-panel panel ob-wait">
      <div className="card ob-focus ob-says">
        <CusoAvatar pose="reporting" size={96} />
        <h1 className="ob-h1">
          {running ? "Writing your plan" : "Planning stopped"}
        </h1>
        {noCredits ? (
          <Refusal text="credits" topUpUrl={overview.subscribeUrl} />
        ) : (
          <p className="ob-muted">
            {running
              ? `Every post, ad and email ${AGENT_NAME} will make, and when. Ready in about a minute.`
              : `Nothing was lost. Try again and I start over.`}
          </p>
        )}
        <Checklist
          items={workChecklist(
            work?.kind === "strategy" ? work.steps : [],
            PLANNING_PHASES,
            running,
          )}
        />
        {running ? null : (
          <RetryButton onRetry={onRetry} topUpUrl={overview.subscribeUrl} />
        )}
      </div>
    </section>
  );
}

/** Brand is confirmed and nothing writes the plan: one button does. */
function WriteNeeded({
  overview,
  onWrite,
}: {
  overview: CmoOverview;
  onWrite: () => Promise<string | null>;
}) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <section className="ob-panel panel ob-wait">
      <div className="card ob-focus ob-says">
        <CusoAvatar pose="reporting" size={96} />
        <h1 className="ob-h1">Ready to write your plan</h1>
        <p className="ob-muted">
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

function PlanReview({
  overview,
  initialTab = "plan",
  onRequest,
  onSetAds,
  onAnswer,
  onUpdate,
  onApprove,
  onConnectMeasurement,
  ahead,
}: PlanStepProps) {
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
  const [budgetOk, setBudgetOk] = useState(false);
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
  const moves = (strategy.funnel ?? []).length;

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

  const statement =
    moves > 0 && pages > 0
      ? `One goal, ${NUMBER_WORDS[moves] ?? moves} ${moves === 1 ? "move" : "moves"}. Built from your answers and ${pages} ${pages === 1 ? "page" : "pages"} of your site.`
      : `${pieces} ${pieces === 1 ? "piece" : "pieces"} for the next four weeks. Nothing goes out until you approve.`;

  const primary = ahead ? (
    <button type="button" className="button" onClick={ahead.onClick}>
      Continue to {ahead.label}
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  ) : approved ? null : !overview.viewerCanApprove && !unfitted ? (
    <p className="ob-muted">An owner or admin approves the plan.</p>
  ) : (
    <button
      type="button"
      className="button"
      disabled={going || busy}
      onClick={() =>
        startGoing(async () => {
          // A refused approval (a new version on its way) stays here.
          try {
            setRefusal(null);
            if (unfitted) setRefusal(await onUpdate());
            else await onApprove();
          } catch {
            setRefusal("That didn't go through. Try again in a moment.");
          }
        })
      }
    >
      {going ? (
        unfitted ? (
          "Updating…"
        ) : (
          "Approving…"
        )
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
  const hasChecks = questions.length > 0 || strategy.pace || ads;

  return (
    <section className="ob-plan">
      <div className="ob-title-row">
        <CusoAvatar pose="reporting" size={48} />
        <div className="ob-title-copy">
          <h1 className="ob-statement-title">{statement}</h1>
        </div>
        <div className="ob-title-action">
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
          {primary}
        </div>
      </div>

      {asking ? (
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
              aria-label="What should Cuso change?"
              disabled={busy}
            />
            <button
              type="submit"
              className="button button-secondary"
              disabled={busy || !note.trim()}
            >
              {changing ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : null}
              Change it
            </button>
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
        <div className="card ob-replanning" role="status">
          <Loader2 size={20} className="spin" aria-hidden="true" />
          <p className="ob-value">{AGENT_NAME} is re-planning your month</p>
          <p className="ob-muted">
            {replanning}. About two minutes; your new plan opens here.
          </p>
        </div>
      ) : null}

      <div className="ob-plan-body panel" hidden={replanning !== null}>
        <GoalBlock
          label="The goal"
          goal={
            strategy.idea?.sentence ??
            (outcomeLine(strategy) || strategy.summary)
          }
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

        {hasChecks ? (
          <div className="ob-checks">
            <h2>Check these</h2>
            {questions.map((question) => (
              <PlanQuestionChip
                key={question.id}
                question={question}
                onAnswer={(value, text) => answer(question.id, value, text)}
              />
            ))}
            {strategy.pace ? (
              <div className="card ob-pace">
                <PacePicker
                  pace={strategy.pace}
                  onAsk={(text, label) =>
                    send(label ?? text, () => onRequest(text))
                  }
                />
              </div>
            ) : null}
            {ads && ads.monthly > 0 ? (
              <AssumptionChip
                question={`Is ${money(ads.monthly, ads.currency)} a month OK for ads?`}
                yes={{
                  pressed: budgetOk,
                  onClick: () => {
                    setBudgetOk(true);
                    setBudgetOpen(false);
                  },
                }}
                other={{
                  label: "Change",
                  pressed: budgetOpen,
                  onClick: () => {
                    setBudgetOk(false);
                    setBudgetOpen(!budgetOpen);
                  },
                }}
              >
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
              </AssumptionChip>
            ) : ads ? (
              <div className="card ob-pace">
                <AdBudget
                  ads={ads}
                  onSetAds={(monthly, currency) =>
                    send(`Ad budget: ${currency} ${monthly} a month`, () =>
                      onSetAds(monthly, currency),
                    )
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ob-tabs" role="tablist" aria-label="The plan">
          {TABS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              id={`ob-tab-${candidate.id}`}
              aria-selected={tab === candidate.id}
              aria-controls={`ob-tabpanel-${candidate.id}`}
              tabIndex={tab === candidate.id ? 0 : -1}
              onClick={() => setTab(candidate.id)}
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
            <PlanTab overview={overview} strategy={strategy} />
          ) : tab === "month" ? (
            <MonthTab strategy={strategy} onOpen={setOpen} />
          ) : (
            <ResultsTab
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

/** One of Cuso's assumptions: Yes, or No with what is true instead. */
function PlanQuestionChip({
  question,
  onAnswer,
}: {
  question: { question: string; answer?: Answer; note?: string };
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
}) {
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

/** The moves, the mix of posts, the topics and where Cuso works. */
function PlanTab({
  overview,
  strategy,
}: {
  overview: CmoOverview;
  strategy: Strategy;
}) {
  const stages = strategy.funnel ?? [];
  const mix = strategy.mix ?? [];
  return (
    <div className="bb" style={brandStyle(overview)}>
      {stages.length > 0 ? (
        <Section title="How people become customers" wide>
          {stages.some((stage) => (stage.plays ?? []).length > 0) ? (
            <FunnelPlan
              stages={stages}
              improvements={strategy.improvements ?? []}
            />
          ) : (
            <Funnel stages={stages} />
          )}
        </Section>
      ) : null}
      {mix.length > 0 ? (
        <Section title="What the posts do">
          <Mix
            mix={mix}
            calendar={strategy.calendar}
            business={businessDisplayName(overview)}
          />
        </Section>
      ) : null}
      {strategy.pillars.length > 0 ? (
        <Section title="What the posts are about">
          <Pillars
            pillars={strategy.pillars}
            calendar={strategy.calendar}
            made={overview.production.pillars}
          />
        </Section>
      ) : null}
      <Section title={`Where ${AGENT_NAME} works`} wide>
        <ChannelPlan strategy={strategy} />
      </Section>
    </div>
  );
}

/** What goes out first, then every day of the plan. */
function MonthTab({
  strategy,
  onOpen,
}: {
  strategy: Strategy;
  onOpen: (entry: Entry) => void;
}) {
  const weeks = useMemo(
    () => planWeeks(strategy.calendar),
    [strategy.calendar],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of [...strategy.calendar].sort((a, b) =>
      (a.time ?? "").localeCompare(b.time ?? ""),
    )) {
      map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    }
    return map;
  }, [strategy.calendar]);
  const first = useMemo(
    () =>
      [...strategy.calendar]
        .sort((a, b) =>
          `${a.date} ${a.time ?? ""}`.localeCompare(
            `${b.date} ${b.time ?? ""}`,
          ),
        )
        .slice(0, UP_FIRST),
    [strategy.calendar],
  );
  return (
    <div className="ob-month">
      {first.length > 0 ? (
        <div className="ob-upfirst">
          <h2>Up first</h2>
          <ul>
            {first.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="ob-entry"
                  onClick={() => onOpen(entry)}
                >
                  <span className="ob-entry-meta">
                    <ChannelIcon channel={entry.channel} size={12} />
                    {formatDay(entry.date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                    {entry.time ? ` ${entry.time}` : ""}
                  </span>
                  <span className="ob-entry-title">
                    {withoutLabel(entry.hook ?? entry.title)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="ob-weeks">
        <div className="ob-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div key={week.start} className="ob-week">
            <span className="ob-week-label">Week {weekIndex + 1}</span>
            <div className="ob-days">
              {week.days.map((day) => {
                const entries = byDay.get(day) ?? [];
                const dayNumber = formatDay(day, { day: "numeric" });
                return (
                  <div
                    key={day}
                    className={
                      entries.length ? "ob-day" : "ob-day ob-day-blank"
                    }
                  >
                    <span className="ob-day-n">
                      <span className="ob-day-short">
                        {dayNumber}
                        {dayNumber === "1"
                          ? ` ${formatDay(day, { month: "short" })}`
                          : ""}
                      </span>
                      <span className="ob-day-long">
                        {formatDay(day, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </span>
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="ob-entry"
                        onClick={() => onOpen(entry)}
                      >
                        <span className="ob-entry-meta">
                          <ChannelIcon channel={entry.channel} size={12} />
                          {entry.time ?? ""}
                        </span>
                        <span className="ob-entry-title">
                          {withoutLabel(entry.hook ?? entry.title)}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function measureLine(measure: Measure): string {
  if (measure?.basis === "measured") {
    return `${measure.value ?? "Measured"}${measure.source ? `, from ${measure.source}` : ""}`;
  }
  if (measure?.basis === "estimated") {
    if (!measure.value) return "My estimate";
    // Cuso often says so himself: "(estimate; not measured)".
    return /estimat/i.test(measure.value)
      ? measure.value
      : `${measure.value} (my estimate)`;
  }
  return "Not measured yet";
}

/** What Cuso does on his own schedule; it matches his daily, weekly and monthly runs. */
const RHYTHM = [
  {
    icon: Sparkles,
    when: "Once you subscribe",
    what: [
      "Makes the whole month at once: every post, picture, video, ad, article and newsletter",
      "Schedules it all on your connected accounts",
      "You can change any piece, any time, by telling him",
    ],
  },
  {
    icon: Sun,
    when: "Every day",
    what: [
      "Replies to new comments on your Instagram, Facebook and YouTube posts, in your voice; complaints and anything sensitive come to you",
      "Checks the news: holidays, competitors, your market. When something matters, he changes a post",
      "Tells you in one line what went out, what he answered and what's next",
    ],
  },
  {
    icon: Repeat,
    when: "Every Monday",
    what: [
      "Checks last week's real numbers, never guesses",
      "Moves effort to what worked and drops what didn't",
      "Sends you each change; you can undo any of them",
    ],
  },
  {
    icon: CalendarDays,
    when: "Every month",
    what: [
      "Writes next month's plan from what worked",
      "Re-reads your site for news, prices and launches",
      "Keeps your goal unless you change it",
    ],
  },
];

/**
 * How the founder will know the plan works: the numbers Cuso tracks at each
 * stage, what he does every day, week and month, and when he changes course.
 */
function ResultsTab({
  overview,
  strategy,
  onConnectMeasurement,
}: {
  overview: CmoOverview;
  strategy: Strategy;
  onConnectMeasurement: ConnectMeasurement;
}) {
  const { objective, measurement } = strategy;
  const stages = strategy.funnel ?? [];
  const rules = measurement?.rules ?? [];
  const tracking = measurement?.tracking ?? [];
  return (
    <div className="bb" style={brandStyle(overview)}>
      <Section title="The outcome that matters">
        <p className="bb-big">{outcomeLine(strategy)}</p>
        {objective?.target ? (
          <p className="note">
            Target: {objective.target}
            {objective.baseline ? `. Today: ${objective.baseline}` : ""}
            {objective.baselineBasis === "assumption"
              ? " (my estimate until you tell me the real number)"
              : ""}
            .
          </p>
        ) : null}
      </Section>

      {stages.length > 0 ? (
        <Section title="What I track at each step" wide>
          <ol className="ob-metrics">
            {stages.map((stage) => (
              <li key={stage.stage}>
                <span className="note">{stage.name}</span>
                <b>{stage.metric}</b>
                {stage.target ? (
                  <span className="note">{stage.target}</span>
                ) : null}
                <span className="note">{measureLine(stage.measure)}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title="Connect your numbers">
        <p className="note">
          I read real visits, searches and orders from these. Where none of them
          reaches, I estimate and ask you for the number.
        </p>
        <MeasureFunnel
          sources={overview.measurement}
          onConnect={onConnectMeasurement}
        />
      </Section>

      <Section title="What I do" wide>
        <div className="ob-rhythm">
          {RHYTHM.map(({ icon: Icon, when, what }) => (
            <div key={when} className="ob-rhythm-card">
              <p className="ob-rhythm-when">
                <Icon size={16} aria-hidden="true" />
                {when}
              </p>
              <ul>
                {what.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {rules.length > 0 ? (
        <Section title="When I change course">
          <ul className="ob-rules">
            {rules.map((rule) => (
              <li key={rule.when}>
                <span>{rule.when}</span>
                <ArrowRight size={14} aria-hidden="true" />
                <b>{rule.then}</b>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {tracking.length > 0 ? (
        <Section title="What we set up to measure it">
          <ul className="bb-list">
            {tracking.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
