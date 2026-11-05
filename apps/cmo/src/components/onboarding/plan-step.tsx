"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useRef, useState, useTransition } from "react";

import { channelLabel } from "../../lib/calendar";
import { changeIdeas } from "../../lib/change-ideas";
import { strategyApproved } from "../../lib/strategy";
import { AGENT_NAME, CusoAvatar } from "../cuso";
import { EntrySheet } from "../entry-sheet";
import { AdBudget, money, PacePicker } from "../strategy-core";
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

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

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

interface PlanningProps {
  overview: CmoOverview;
  onRetry: () => Promise<string | null>;
}

/** The first plan is being written: the checklist, and the way to try again. */
function Planning({ overview, onRetry }: PlanningProps) {
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

interface WriteNeededProps {
  overview: CmoOverview;
  onWrite: () => Promise<string | null>;
}

/** Brand is confirmed and nothing writes the plan: one button does. */
function WriteNeeded({ overview, onWrite }: WriteNeededProps) {
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
            <p className="ob-muted">
              {replanning}. About two minutes; your new plan opens here.
            </p>
          </div>
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
            <PlanPanel overview={overview} strategy={strategy} />
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
