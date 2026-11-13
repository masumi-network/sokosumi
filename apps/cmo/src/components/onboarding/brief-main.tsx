"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowLeft, Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { type ReactNode, useId, useState } from "react";

import { AGENT_NAME } from "../../lib/agent";
import {
  BRAND_SECTIONS,
  type BrandBrain,
  type BrandSectionKey,
  brandProfile,
  sourceHost,
} from "../../lib/brand-sections";
import { channelLabel, formatDay, planWeeks } from "../../lib/calendar";
import { channelKey } from "../../lib/channels";
import type { CusoMessage } from "../../lib/chat-messages";
import { joinNames } from "../../lib/names";
import { strategyApproved } from "../../lib/strategy";
import { VIEW_PATHS } from "../../lib/views";
import { firstSentence, hostOf } from "../brand-profile";
import { businessDisplayName } from "../business-mark";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { StatusDisc } from "../status";
import { money } from "../strategy-core";
import { outcomeLine } from "../strategy-reveal";
import { TypeIn } from "../type-in";
import { BrandStep } from "./brand-step";
import {
  type Ask,
  adEntries,
  adWeek,
  type BriefLocal,
  brandFixPending,
  questionEntry,
  STAGES,
  type StageId,
  weekOne,
} from "./brief";
import { Checklist } from "./checklist";
import { researchGroups } from "./live";
import { connectedNetworks, firstPost } from "./networks";
import { PlanAnswers, PlanReview } from "./plan-step";
import { type ConnectMeasurement, MonthPanel, PlanPanel } from "./plan-tabs";
import { GoalBlock } from "./tiles";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

interface SeeMoreProps {
  label: string;
  children: ReactNode;
}

/**
 * The full detail behind one result: closed until the person wants it. Every
 * part of the old screens lives behind one of these.
 */
function SeeMore({ label, children }: SeeMoreProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="brief-more">
      <button
        type="button"
        className="brief-more-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : label}
      </button>
      <div id={id} className="brief-more-body" hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}

/** The six research groups, ticking off as Cuso saves them. */
function GroupChips({ overview }: { overview: CmoOverview }) {
  const groups = researchGroups(overview);
  if (!groups) return null;
  const reading =
    overview.work?.kind === "research" && overview.work.status === "running";
  return (
    <Checklist
      className="ob-chips"
      items={groups.map((group) => ({
        label: group.label,
        state: group.state === "done" ? "done" : reading ? "working" : "next",
      }))}
    />
  );
}

/**
 * One result: a small label, the line, then where it comes from. A quiet
 * result keeps its label for screen readers only, when the card says it.
 */
function Result({
  label,
  source,
  quiet = false,
  children,
}: {
  label: string;
  source?: string | undefined;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card brief-result" aria-label={label}>
      {quiet ? null : <p className="brief-result-head">{label}</p>}
      {children}
      {source ? <p className="brief-source">{source}</p> : null}
    </section>
  );
}

/** Every page Cuso read and every section he saved so far, while he reads. */
function ResearchDetail({ overview }: { overview: CmoOverview }) {
  const work = overview.work?.kind === "research" ? overview.work : null;
  if (!work) return <p className="muted">Nothing read yet.</p>;
  return (
    <div className="brief-detail-cols">
      <div>
        <h3 className="brief-detail-head">What I read</h3>
        <ol className="brief-steps">
          {work.steps.map((step) => (
            <li key={step.id} className={step.status}>
              {step.url ? (
                <a href={step.url} target="_blank" rel="noreferrer">
                  {step.label}
                </a>
              ) : (
                step.label
              )}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="brief-detail-head">
          Sections saved, {work.sectionsSaved} of {work.sectionsTotal}
        </h3>
        <ul className="brief-steps">
          {work.sections.map((section) => (
            <li key={section.key} className="done">
              <b>{BRAND_SECTIONS[section.key].title}</b> {section.headline}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface BrandDetailProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onFix: (section: BrandSectionKey, note: string) => Promise<void>;
  onSave: (brain: BrandBrain) => Promise<void>;
  onCorrect: (text: string) => Promise<void>;
}

/** The whole Brand Brain: tiles, sources, voice, competitors and the map. */
function BrandDetail(props: BrandDetailProps) {
  return <BrandStep titled={false} {...props} />;
}

/** The first sourced finding of a section. */
function sectionSource(
  brain: BrandBrain,
  key: BrandSectionKey,
  fallback: string,
): string {
  const section = brandProfile(brain)[key];
  const url = section?.findings?.find(
    (finding) => finding.sourceUrl,
  )?.sourceUrl;
  return sourceHost(url ?? fallback);
}

/** The Brand Brain section a question or fix is about. */
function SectionResult({
  overview,
  section,
  fallback,
  fixing = false,
}: {
  overview: CmoOverview;
  section: BrandSectionKey;
  /** What a yes would confirm, while the section is not saved yet. */
  fallback?: string | undefined;
  fixing?: boolean;
}) {
  const brain = overview.brandBrain as BrandBrain;
  const saved = brandProfile(brain)[section];
  const title = BRAND_SECTIONS[section].title;
  return (
    <Result
      label={
        fixing ? `${title} · being fixed` : `${title} · from your Brand Brain`
      }
      source={sectionSource(brain, section, overview.websiteUrl)}
    >
      <p className="brief-line">
        {saved?.answer ?? fallback ?? "I haven't saved this part yet."}
      </p>
      {fixing ? (
        <p className="brief-meanwhile">
          <span className="dot live" aria-hidden="true" />
          {AGENT_NAME} is fixing this
        </p>
      ) : null}
    </Result>
  );
}

/** Up to three sourced findings that back the one line. */
function brandFindings(
  overview: CmoOverview,
): { text: string; source: string }[] {
  const brain = overview.brandBrain as BrandBrain;
  const insights = (brain.reveal?.insights ?? []).map((insight) => ({
    text: `${insight.title}. ${insight.detail}`,
    source: sourceHost(insight.sourceUrl ?? overview.websiteUrl),
  }));
  if (insights.length > 0) return insights.slice(0, 3);
  const profile = brandProfile(brain);
  return (Object.keys(BRAND_SECTIONS) as BrandSectionKey[])
    .flatMap((key) =>
      (profile[key]?.findings ?? [])
        .filter((finding) => finding.sourceUrl)
        .slice(0, 1)
        .map((finding) => ({
          text: finding.point,
          source: sourceHost(finding.sourceUrl ?? overview.websiteUrl),
        })),
    )
    .slice(0, 3);
}

function BrandCheckResult({ overview }: { overview: CmoOverview }) {
  const brain = overview.brandBrain as BrandBrain;
  const line = brain.reveal?.positioning ?? firstSentence(brain.summary);
  return (
    <>
      <Result label={`${businessDisplayName(overview)}, in one line`} quiet>
        <p className="brief-statement">{line}</p>
      </Result>
      <ul className="brief-findings">
        {brandFindings(overview).map((finding) => (
          <li key={finding.text}>
            <p>{finding.text}</p>
            <span className="brief-source">{finding.source}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The plan as Core saves it: the plan part, then the calendar, then a check. */
function PlanWriting({ overview }: { overview: CmoOverview }) {
  const strategy = overview.strategy;
  const running =
    overview.work?.kind === "strategy" && overview.work.status === "running";
  const pieces = strategy?.calendar.length ?? 0;
  const goal = strategy ? outcomeLine(strategy) : "";
  return (
    <>
      <section className="card brief-result" aria-label="Your briefing">
        <Checklist
          items={[
            {
              label: "Goal and moves",
              state: strategy ? "done" : running ? "working" : "next",
            },
            {
              label: "Four weeks, day by day",
              state: !strategy ? "next" : running ? "working" : "done",
            },
            {
              label: "A last check",
              state: strategy && pieces > 0 && !running ? "done" : "next",
            },
          ]}
        />
      </section>
      {goal ? <Goal strategy={strategy as Strategy} /> : null}
    </>
  );
}

function Goal({ strategy }: { strategy: Strategy }) {
  const goal = outcomeLine(strategy);
  const label = strategy.objective?.metric
    ? `Goal · ${strategy.objective.metric.toLowerCase()}`
    : "Goal";
  return (
    <GoalBlock
      label={label}
      goal={goal}
      statement={strategy.idea?.sentence ?? strategy.summary}
      facts={[]}
    />
  );
}

/**
 * The plan's moves: each funnel stage's job, its reason and the Brand Brain
 * sections it rests on, each of which opens that section in place. A plan
 * saved before Core sent reasons shows the stage's first play instead.
 */
function Moves({
  overview,
  strategy,
}: {
  overview: CmoOverview;
  strategy: Strategy;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const id = useId();
  const stages = (strategy.funnel ?? []).slice(0, 3);
  if (stages.length === 0) return null;
  // Core does not check basedOn: only a section the Brand Brain saved is a source.
  const profile = overview.brandBrain ? brandProfile(overview.brandBrain) : {};
  return (
    <ol className="brief-moves">
      {stages.map((stage, index) => {
        const play = stage.plays?.[0];
        const sections = (stage.basedOn ?? []).filter(
          (section) => profile[section],
        );
        const cardId = `${id}-${stage.stage}`;
        const open = sections.find(
          (section) => shown === `${stage.stage}:${section}`,
        );
        return (
          <li key={stage.stage}>
            <span className="brief-move-n num">{index + 1}</span>
            <div className="brief-move-body">
              <p className="brief-move">{stage.goal}</p>
              {stage.why ? (
                <p className="muted">{stage.why}</p>
              ) : play ? (
                <p className="muted">
                  {channelLabel(play.channel)}: {play.what}
                  {play.cadence ? `, ${play.cadence}` : ""}
                </p>
              ) : null}
              {sections.length > 0 ? (
                <p className="brief-move-sources">
                  {sections.map((section) => {
                    const key = `${stage.stage}:${section}`;
                    return (
                      <button
                        key={section}
                        type="button"
                        className="brief-source brief-source-link"
                        aria-expanded={shown === key}
                        aria-controls={cardId}
                        onClick={() => setShown(shown === key ? null : key)}
                      >
                        Brand Brain · {BRAND_SECTIONS[section].title}
                      </button>
                    );
                  })}
                </p>
              ) : null}
              <div id={cardId}>
                {open ? (
                  <SectionResult overview={overview} section={open} />
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const DAY = { weekday: "short", day: "numeric" } as const;
const SHORT = { day: "numeric", month: "short" } as const;

/** Week one day by day: when, where, the title and its brief. */
function WeekList({
  entries,
  patched,
  onPick,
}: {
  entries: Entry[];
  patched: ReadonlySet<string>;
  onPick?: ((entry: Entry) => void) | undefined;
}) {
  return (
    <ol className="brief-week">
      {entries.map((entry) => {
        const body = (
          <>
            <span className="brief-week-day">{formatDay(entry.date, DAY)}</span>
            <ChannelIcon channel={channelKey(entry.channel) ?? entry.channel} />
            <span className="brief-week-text">
              <b>{entry.title}</b>
              {patched.has(entry.id) ? (
                <span className="brief-changed">Changed</span>
              ) : null}
              {(entry.brief ?? entry.why) ? (
                <span className="muted">{entry.brief ?? entry.why}</span>
              ) : null}
            </span>
          </>
        );
        return (
          <li key={entry.id}>
            {onPick ? (
              <button
                type="button"
                className="brief-week-row"
                onClick={() => onPick(entry)}
              >
                {body}
              </button>
            ) : (
              <div className="brief-week-row">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The month as one table: each network's pieces per week. */
function MonthTable({ strategy }: { strategy: Strategy }) {
  const calendar = strategy.calendar.filter(
    (entry) => entry.status !== "skipped",
  );
  const weeks = planWeeks(calendar).slice(0, 4);
  const channels = [...new Set(calendar.map((entry) => entry.channel))];
  const count = (channel: string | null, week: { days: string[] }) =>
    calendar.filter(
      (entry) =>
        (channel === null || entry.channel === channel) &&
        week.days.includes(entry.date),
    ).length;
  return (
    <table className="brief-table">
      <caption className="ob-sr">Your month, in one table</caption>
      <thead>
        <tr>
          <th scope="col">Channel</th>
          {weeks.map((week, index) => (
            <th key={week.start} scope="col" className="num">
              Wk {index + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {channels.map((channel) => (
          <tr key={channel}>
            <th scope="row">{channelLabel(channel)}</th>
            {weeks.map((week) => (
              <td key={week.start} className="num">
                {count(channel, week)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{calendar.length} pieces</th>
          {weeks.map((week) => (
            <td key={week.start} className="num">
              {count(null, week)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

/** The first ad as people will see it, with what it is searched for. */
function AdResult({ strategy }: { strategy: Strategy }) {
  const ads = adEntries(strategy);
  const ad = ads[0];
  if (!ad) return null;
  const search = ad.searchAd;
  const week = adWeek(strategy, ad.date);
  return (
    <Result label={`${week ? `Week ${week} · ` : ""}ad 1 of ${ads.length}`}>
      <p className="brief-line">
        {search?.headlines.slice(0, 2).join(" | ") ?? ad.title}
      </p>
      <p className="muted">{search?.descriptions[0] ?? ad.brief ?? ad.why}</p>
      {search ? (
        <p className="brief-source">
          {sourceHost(search.finalUrl)} · Searches:{" "}
          {search.keywords
            .slice(0, 3)
            .map((keyword) => `“${keyword}”`)
            .join(", ")}
        </p>
      ) : null}
    </Result>
  );
}

function AdsDetail({ strategy }: { strategy: Strategy }) {
  const ads = strategy.ads;
  return (
    <div className="brief-detail-cols">
      <ul className="brief-steps">
        {adEntries(strategy).map((entry) => (
          <li key={entry.id} className="done">
            <b>{formatDay(entry.date, SHORT)}</b>{" "}
            {entry.searchAd?.headlines[0] ?? entry.title}
          </li>
        ))}
      </ul>
      {ads ? (
        <dl className="ob-summary">
          <div>
            <dt>Budget</dt>
            <dd>{money(ads.monthly, ads.currency)} a month</dd>
          </div>
          <div>
            <dt>What I expect</dt>
            <dd>{ads.expect}</dd>
          </div>
          <div>
            <dt>Without ads</dt>
            <dd>{ads.without}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

type BriefStep = "plan" | "week" | "checks" | "ads";

/** Which briefing step an ask belongs to. */
function briefingStep(ask: Ask | null): BriefStep | null {
  switch (ask?.kind) {
    case "briefing-plan":
      return "plan";
    case "briefing-week":
      return "week";
    case "plan-question":
    case "plan-apply":
      return "checks";
    case "briefing-ads":
      return "ads";
    default:
      return null;
  }
}

/** Where the month posts, and which networks are connected. */
function Networks({
  overview,
  networks,
}: {
  overview: CmoOverview;
  networks: { key: string; pieces: number; connected: boolean }[];
}) {
  const others = (overview.strategy?.channels ?? []).filter(
    (channel) => !networks.some((network) => network.key === channel.channel),
  );
  return (
    <section className="card brief-result" aria-label="Where your month posts">
      <ul className="brief-networks">
        {networks.map((network) => (
          <li key={network.key}>
            <ChannelIcon channel={network.key} size={20} />
            <span>
              {channelLabel(network.key)} · {network.pieces}{" "}
              {network.pieces === 1 ? "piece" : "pieces"}
            </span>
            {network.connected ? (
              <span className="ob-connected">
                <StatusDisc status="ok" />
                Connected
              </span>
            ) : (
              <span className="muted">Not yet</span>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <p className="muted">
          {joinNames(others.map((channel) => channelLabel(channel.channel)))}{" "}
          {others.length === 1 ? "needs" : "need"} no account here.
        </p>
      ) : null}
    </section>
  );
}

function YourMonth({ overview }: { overview: CmoOverview }) {
  const plan = overview.approvedStrategy ?? overview.strategy;
  const post = firstPost(plan?.calendar ?? [], connectedNetworks(overview));
  const { written, total } = overview.production;
  const months = total || (plan?.calendar.length ?? 0);
  return (
    <>
      <p className="brief-live">
        <span className="brief-mark ok" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
        <b>
          {post
            ? `You're live. First post: ${post.when} on ${channelLabel(post.channel)}.`
            : "You're live."}
        </b>
      </p>
      <Result label="Your month" quiet>
        <p className="brief-big num">
          <TypeIn text={`${written} of ${months} written`} />
        </p>
        <span className="brief-progress" aria-hidden="true">
          <span
            style={{
              width: `${months > 0 ? Math.round((written / months) * 100) : 0}%`,
            }}
          />
        </span>
      </Result>
    </>
  );
}

/** What finished while the person was away, read from the overview. */
function Away({ overview }: { overview: CmoOverview }) {
  const brain = overview.brandBrain;
  const strategy = overview.strategy;
  const groups = researchGroups(overview) ?? [];
  const sections = Object.keys(brain ? brandProfile(brain) : {}).length;
  const open = (brain?.questions ?? []).filter((question) => !question.answer);
  return (
    <section className="card brief-result" aria-label="While you were away">
      <p className="brief-result-head">While you were away</p>
      <Checklist
        items={[
          ...(brain
            ? [
                {
                  label: `Research: ${sections} sections${groups.length > 0 ? `, ${groups.length} groups` : ""}`,
                  state: "done" as const,
                },
              ]
            : []),
          ...(strategy && strategy.calendar.length > 0
            ? [
                {
                  label: `Your plan: ${strategy.calendar.length} pieces, week one in full`,
                  state: "done" as const,
                },
              ]
            : []),
          ...(!overview.brandBrainConfirmedAt && brain
            ? [
                {
                  label:
                    open.length > 0
                      ? `Brand check and ${open.length} ${open.length === 1 ? "question" : "questions"} wait for you`
                      : "Brand check waits for you",
                  state: "next" as const,
                },
              ]
            : []),
        ]}
      />
    </section>
  );
}

/** How many sections the Brand Brain saved. */
function savedCount(overview: CmoOverview): number {
  return Object.keys(brandProfile(overview.brandBrain as BrandBrain)).length;
}

/** Every section the Brand Brain saved, one result each. */
function SavedSections({ overview }: { overview: CmoOverview }) {
  const profile = brandProfile(overview.brandBrain as BrandBrain);
  return (
    <>
      {(Object.keys(BRAND_SECTIONS) as BrandSectionKey[])
        .filter((key) => profile[key])
        .map((key) => (
          <SectionResult key={key} overview={overview} section={key} />
        ))}
    </>
  );
}

/**
 * A finished stage, read-only: what Cuso found or what the owner decided.
 * Each stage reuses its own result; a change still goes through the chat.
 */
function StageReview({
  overview,
  stage,
  networks,
}: {
  overview: CmoOverview;
  stage: StageId;
  networks: BriefMainProps["networks"];
}) {
  const brain = overview.brandBrain;
  const strategy = overview.strategy;
  const preview = overview.research?.preview ?? null;
  switch (stage) {
    case "website":
      return (
        <Result label="Your website" source={hostOf(overview.websiteUrl)}>
          <p className="brief-statement">
            {preview?.line ??
              `${AGENT_NAME} reads ${hostOf(overview.websiteUrl)} and the places around it.`}
          </p>
        </Result>
      );
    case "research":
      return brain ? (
        <>
          <GroupChips overview={overview} />
          <Result
            label={`What I learned about ${businessDisplayName(overview)}`}
            quiet
          >
            <p className="brief-statement">{brain.summary}</p>
          </Result>
          <SeeMore label={`All ${savedCount(overview)} sections`}>
            <SavedSections overview={overview} />
          </SeeMore>
        </>
      ) : null;
    case "brand":
      return brain ? (
        <>
          <BrandCheckResult overview={overview} />
          <SeeMore label="Your Brand Brain">
            <SavedSections overview={overview} />
          </SeeMore>
        </>
      ) : null;
    case "plan":
      return strategy ? (
        <>
          <Goal strategy={strategy} />
          <Moves overview={overview} strategy={strategy} />
          <SeeMore label="The whole strategy">
            <PlanPanel overview={overview} strategy={strategy} />
          </SeeMore>
        </>
      ) : null;
    case "briefing":
      return strategy ? (
        <>
          <PlanAnswers overview={overview} />
          <section className="brief-result card" aria-label="Week one">
            <p className="brief-result-head">Week one</p>
            <WeekList
              entries={weekOne(strategy.calendar)}
              patched={new Set((strategy.patched ?? []).map((item) => item.id))}
            />
          </section>
        </>
      ) : null;
    case "golive":
      return (
        <>
          <PlanAnswers overview={overview} />
          <Networks overview={overview} networks={networks} />
        </>
      );
    default:
      return null;
  }
}

export interface BriefMainProps {
  overview: CmoOverview;
  stage: StageId;
  /** The question the chat shows, or would show while folded. */
  ask: Ask | null;
  local: BriefLocal;
  messages: CusoMessage[];
  /** The person is back with several things waiting. */
  away: boolean;
  /** The plan's networks and their connections, for Go live. */
  networks: { key: string; pieces: number; connected: boolean }[];
  /** A piece tapped on week one goes into the chat's field. */
  onPick: (entry: Entry) => void;
  /** Google Analytics, Search Console or Shopify, from the full strategy. */
  onConnectMeasurement: ConnectMeasurement;
  brand: Omit<BrandDetailProps, "overview" | "messages">;
  /** A finished stage shown read-only, while the chat stays on the current one. */
  viewing?: StageId | null;
  /** Back to the current stage. */
  onBack?: () => void;
}

/** The page: one result, and See more for the full detail. It never asks. */
export function BriefMain({
  overview,
  stage,
  ask,
  messages,
  away,
  networks,
  onPick,
  onConnectMeasurement,
  brand,
  viewing = null,
  onBack,
}: BriefMainProps) {
  const [open, setOpen] = useState<Entry | null>(null);
  const brain = overview.brandBrain;
  const strategy = overview.strategy;
  const site = hostOf(overview.websiteUrl);
  const brandDetail = (
    <BrandDetail overview={overview} messages={messages} {...brand} />
  );
  const monthDetail = strategy ? (
    <MonthPanel
      overview={overview}
      strategy={strategy}
      writing={
        overview.work?.kind === "strategy" && overview.work.status === "running"
      }
      onOpen={setOpen}
    />
  ) : null;

  let body: ReactNode = null;
  if (viewing && viewing !== stage) {
    body = (
      <StageReview overview={overview} stage={viewing} networks={networks} />
    );
  } else if (away) {
    body = <Away overview={overview} />;
  } else if (stage === "research" && !brain) {
    const preview = overview.research?.preview ?? null;
    const work = overview.work?.kind === "research" ? overview.work : null;
    const running = work?.status === "running";
    body = (
      <>
        <GroupChips overview={overview} />
        {running || !work ? (
          preview ? (
            <Result label="From your homepage" source={site}>
              <p className="brief-statement">
                <TypeIn text={preview.line} />
              </p>
              {preview.facts.length > 0 ? (
                <ul className="brief-facts">
                  {preview.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              ) : null}
            </Result>
          ) : (
            <div className="card brief-result ob-skeleton" aria-hidden="true">
              <span />
              <span />
            </div>
          )
        ) : ask?.kind === "research-retry" && work ? (
          <p className="brief-saved num">
            {work.sectionsSaved} of {work.sectionsTotal} sections saved
          </p>
        ) : null}
        {work && work.steps.length > 0 ? (
          <SeeMore
            label={
              ask?.kind === "research-retry"
                ? "Pages read"
                : `All ${work.steps.length} ${work.steps.length === 1 ? "page" : "pages"}`
            }
          >
            <ResearchDetail overview={overview} />
          </SeeMore>
        ) : null}
      </>
    );
  } else if (stage === "research" || stage === "brand") {
    const question =
      ask?.kind === "brand-question"
        ? brain?.questions?.find((candidate) => candidate.id === ask.id)
        : undefined;
    const fixing = brandFixPending(overview);
    body = (
      <>
        {stage === "research" ? <GroupChips overview={overview} /> : null}
        {question ? (
          <SectionResult
            overview={overview}
            section={question.section}
            fallback={question.statement}
          />
        ) : stage === "brand" && fixing?.section ? (
          <SectionResult overview={overview} section={fixing.section} fixing />
        ) : stage === "brand" && fixing ? (
          <Result label="Your correction · being fixed">
            <p className="brief-line">{fixing.note}</p>
            <p className="brief-meanwhile">
              <span className="dot live" aria-hidden="true" />
              {AGENT_NAME} is fixing this
            </p>
          </Result>
        ) : stage === "brand" ? (
          <BrandCheckResult overview={overview} />
        ) : (
          <Result
            label={`What I learned about ${businessDisplayName(overview)}`}
            quiet
          >
            <p className="brief-statement">{brain?.summary}</p>
          </Result>
        )}
        <SeeMore label="Your Brand Brain">{brandDetail}</SeeMore>
      </>
    );
  } else if (stage === "plan") {
    body = (
      <>
        <PlanWriting overview={overview} />
        {strategy ? (
          <SeeMore label="The plan so far">
            <PlanPanel overview={overview} strategy={strategy} />
          </SeeMore>
        ) : null}
      </>
    );
  } else if (stage === "briefing" && strategy) {
    const step = briefingStep(ask);
    const patched = new Set((strategy.patched ?? []).map((item) => item.id));
    const week = weekOne(strategy.calendar);
    const weekRange = week[0]
      ? `${formatDay(week[0].date, { day: "numeric" })} to ${formatDay(week.at(-1)?.date ?? week[0].date, SHORT)}`
      : "";
    const changing =
      overview.work?.kind === "strategy" && overview.work.status === "running";
    const weekView = (title: string, pick: boolean) => (
      <section className="brief-result card" aria-label="Week one">
        <p className="brief-result-head">{title}</p>
        <WeekList
          entries={week}
          patched={patched}
          onPick={pick ? onPick : undefined}
        />
      </section>
    );
    const question =
      ask?.kind === "plan-question"
        ? strategy.questions?.find((candidate) => candidate.id === ask.id)
        : undefined;
    const piece = question ? questionEntry(strategy, question) : null;
    body = (
      <>
        {changing ? (
          <>
            {weekView("Week one · being changed", false)}
            <SeeMore label="What changed">{monthDetail}</SeeMore>
          </>
        ) : step === "plan" ? (
          <>
            <Goal strategy={strategy} />
            <Moves overview={overview} strategy={strategy} />
            <SeeMore label="The whole strategy">
              <PlanReview
                overview={overview}
                titled={false}
                onConnectMeasurement={onConnectMeasurement}
              />
            </SeeMore>
          </>
        ) : step === "week" ? (
          <>
            {weekView(`Week one · ${weekRange}`, true)}
            <SeeMore label="Weeks 2 to 4">{monthDetail}</SeeMore>
          </>
        ) : question ? (
          <>
            {piece ? (
              <section
                className="brief-result card"
                aria-label="The piece this question changes"
              >
                <WeekList entries={[piece]} patched={patched} />
              </section>
            ) : (
              <Result label="What a yes keeps in the plan" quiet>
                <p className="brief-line">{question.statement}</p>
              </Result>
            )}
            <SeeMore label="Week one">{weekView("Week one", false)}</SeeMore>
          </>
        ) : step === "ads" ? (
          <>
            <AdResult strategy={strategy} />
            <SeeMore label={`All ${adEntries(strategy).length} ads`}>
              <AdsDetail strategy={strategy} />
            </SeeMore>
          </>
        ) : (
          weekView("Week one", false)
        )}
      </>
    );
  } else if (stage === "golive" && strategy && !strategyApproved(overview)) {
    // The one gate: the whole month in one table, and what approval starts.
    body = (
      <>
        <Result label="Your month, in one table" quiet>
          <MonthTable strategy={strategy} />
        </Result>
        <SeeMore label="Full calendar">{monthDetail}</SeeMore>
      </>
    );
  } else if (stage === "golive") {
    body = <Networks overview={overview} networks={networks} />;
  } else if (stage === "month") {
    body = (
      <>
        <YourMonth overview={overview} />
        <a
          className="brief-more-toggle"
          href={`${VIEW_PATHS.calendar}?project=${encodeURIComponent(overview.projectId)}`}
        >
          Calendar
        </a>
      </>
    );
  }

  const label = (id: StageId) =>
    STAGES.find((candidate) => candidate.id === id)?.label;
  const looking = viewing && viewing !== stage ? viewing : null;
  return (
    <main className="brief-main" id="brief-main">
      <h1 className="ob-sr">
        Hiring {AGENT_NAME}: {label(looking ?? stage)}
        {looking ? ", looking back" : ""}
      </h1>
      {looking && onBack ? (
        <button type="button" className="brief-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to {label(stage)}
        </button>
      ) : null}
      {body}
      <AnimatePresence>
        {open ? (
          <EntrySheet
            entry={open}
            media={overview.media.find((item) => item.entryId === open.id)}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
