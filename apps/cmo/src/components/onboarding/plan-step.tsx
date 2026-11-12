"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { AnimatePresence } from "motion/react";
import { type KeyboardEvent, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { strategyApproved } from "../../lib/strategy";
import { CusoAvatar } from "../cuso";
import { EntrySheet } from "../entry-sheet";
import { money, PACES } from "../strategy-core";
import { outcomeLine } from "../strategy-reveal";
import {
  type ConnectMeasurement,
  MonthPanel,
  PlanPanel,
  type PlanTab,
  ResultsPanel,
  TABS,
} from "./plan-tabs";
import { GoalBlock } from "./tiles";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

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

const ANSWER_WORDS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  unsure: "Not sure",
  "": "Not answered",
};

interface PlanReviewProps {
  overview: CmoOverview;
  /** The tab to open, such as Results after a measurement connection. */
  initialTab?: PlanTab;
  onConnectMeasurement: ConnectMeasurement;
  /** False inside a page with its own H1: the goal is not the heading then. */
  titled?: boolean;
}

/**
 * The plan as it stands, read-only: the goal, the answers it was checked
 * with, and its tabs (the moves, the month, how we know it works). The app's
 * Strategy page and the briefing's See more show it; the chat changes it.
 */
export function PlanReview({
  overview,
  initialTab = "plan",
  onConnectMeasurement,
  titled = true,
}: PlanReviewProps) {
  const strategy = overview.strategy as Strategy;
  const [tab, setTab] = useState<PlanTab>(initialTab);
  const [open, setOpen] = useState<Entry | null>(null);
  const work = overview.work;
  const writing = work?.kind === "strategy" && work.status === "running";
  const approved = strategyApproved(overview);
  const questions = strategy.questions ?? [];
  const pieces = strategy.calendar.length;
  const changes = strategy.changes ?? [];
  const written = strategy.contentLanguage
    ? ` Written in ${strategy.contentLanguage}.`
    : "";
  const line = `${AGENT_NAME} · ${pieces} ${pieces === 1 ? "piece" : "pieces"} for the next four weeks.${written}${approved ? "" : " Nothing goes out until you approve the plan."}`;
  // The short goal is the headline; the long sentence sits under it.
  const sentence = strategy.idea?.sentence ?? strategy.summary;
  const goal = outcomeLine(strategy) || firstClause(sentence);
  const ads = strategy.ads;
  const pace = PACES.find((option) => option.level === strategy.pace?.level);
  const hasChecks = questions.length > 0 || pace || ads;

  return (
    <section className="ob-plan">
      <div className="ob-title-row">
        <CusoAvatar pose="reporting" size={48} />
        <div className="ob-title-copy">
          <p className="muted">{line}</p>
        </div>
      </div>

      <div className="ob-plan-body panel">
        <GoalBlock
          label="The goal"
          headline={titled}
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

        {hasChecks ? (
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
            <PlanPanel overview={overview} strategy={strategy} />
          ) : tab === "month" ? (
            <MonthPanel
              overview={overview}
              strategy={strategy}
              writing={writing}
              onOpen={setOpen}
            />
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
