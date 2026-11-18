"use client";

import type {
  CmoCompetitor,
  CmoCompetitorCreate,
  CmoCompetitorMeasure,
  CmoCompetitorSignal,
  CmoCompetitors,
  CmoOverview,
} from "@sokosumi/core-client";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { CompetitorResult } from "../../app/cmo-actions";
import { AGENT_NAME } from "../../lib/agent";
import type { BrandBrain } from "../../lib/brand-sections";
import { hostOf } from "../brand-profile";
import { MarketMap } from "../onboarding/market-map";
import { StatusText } from "../status";
import { SubmitButton } from "../submit-button";

export interface CompetitorActions {
  loadCompetitors: () => Promise<CmoCompetitors | null>;
  addCompetitor: (input: CmoCompetitorCreate) => Promise<CompetitorResult>;
  updateCompetitor: (
    id: string,
    input: CmoCompetitorCreate,
  ) => Promise<CompetitorResult>;
  removeCompetitor: (id: string) => Promise<CompetitorResult>;
  addMoveToStrategy: (itemId: string) => Promise<CompetitorResult>;
}

/** A change to the page; resolves to why it was refused, or null. */
type Change = (run: () => Promise<CompetitorResult>) => Promise<string | null>;

interface CompetitorsPageProps {
  overview: CmoOverview;
  actions: CompetitorActions;
  compose: (text: string) => void;
}

const FAILED = "That didn't go through. Try again.";

function day(at: string | Date): string {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    // A check day and an article's date are calendar days, stored in UTC.
    timeZone: "UTC",
  });
}

type MarketMapData = NonNullable<NonNullable<BrandBrain["reveal"]>["map"]>;

/** The market map with the business and the players still watched. */
export function watchedMap(
  map: MarketMapData,
  watched: readonly string[],
): MarketMapData {
  return {
    ...map,
    players: map.players.filter(
      (player) => player.you || watched.includes(player.name),
    ),
  };
}

const SIGNAL_KINDS: Record<CmoCompetitorSignal["kind"], string> = {
  PRICE_CHANGE: "Price",
  WEBSITE_CHANGE: "Website",
  NEWS: "News",
  AD: "Ads",
  SOCIAL: "Instagram",
};

/** The Competitors page: the market map, the week's moves, the numbers, the list. */
export function CompetitorsPage({
  overview,
  actions,
  compose,
}: CompetitorsPageProps) {
  const [data, setData] = useState<CmoCompetitors | null>(null);
  const [failed, setFailed] = useState(false);
  const { loadCompetitors } = actions;

  const load = useCallback(() => {
    let current = true;
    setFailed(false);
    loadCompetitors()
      .then((loaded) => {
        if (!current) return;
        if (loaded) setData(loaded);
        else setFailed(true);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [loadCompetitors]);
  useEffect(load, [load]);

  /** Runs a change and shows its result; why it did not go through comes back. */
  const change: Change = useCallback(async (run) => {
    const result = await run().catch(() => ({
      competitors: null,
      error: FAILED,
    }));
    if (result.competitors) setData(result.competitors);
    return result.error;
  }, []);

  if (failed) {
    return (
      <div className="page-body">
        <section className="card">
          <h3>Your competitors did not load</h3>
          <p className="muted">Nothing is lost. Load the page again.</p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={load}
          >
            Try again
          </button>
        </section>
      </div>
    );
  }
  if (!data) return <CompetitorsLoading />;

  const brain = overview.brandBrain as BrandBrain | null;
  const map = brain?.reveal?.map;
  const names = new Map(data.competitors.map((c) => [c.id, c.name]));
  const signals = new Map(data.signals.map((signal) => [signal.id, signal]));

  return (
    <div className="page-body comp-page">
      {map && brain ? (
        <section className="card">
          <h3>Where you stand</h3>
          <MarketMap
            map={
              data.competitors.length === 0
                ? map
                : watchedMap(map, data.mapPlayers)
            }
            companies={brain.competitors}
          />
        </section>
      ) : null}
      <ThisWeek
        data={data}
        names={names}
        signals={signals}
        addToStrategy={(itemId) =>
          change(() => actions.addMoveToStrategy(itemId))
        }
      />
      <Scoreboard data={data} />
      <TopPosts data={data} names={names} compose={compose} />
      <Found data={data} names={names} />
      <Manage data={data} actions={actions} change={change} />
    </div>
  );
}

/** The page while it loads: dashed boxes where the sections will be. */
function CompetitorsLoading() {
  return (
    <div className="page-body" aria-busy="true">
      <span className="sr-only">Loading your competitors</span>
      {[0, 1, 2].map((box) => (
        <div key={box} className="comp-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

interface SourcedProps {
  className: string;
  label: ReactNode;
  children: ReactNode;
}

/**
 * Text that says where it comes from: a note that opens on hover, on a press
 * and from the keyboard, stays open once pressed, and closes on Escape or a
 * press elsewhere.
 */
function Sourced({ className, label, children }: SourcedProps) {
  const id = useId();
  const anchor = `--source-${id.replace(/\W/g, "")}`;
  const note = useRef<HTMLSpanElement>(null);
  const pressed = useRef(false);
  const show = (open: boolean) => {
    const element = note.current;
    if (typeof element?.showPopover !== "function") return;
    if (element.matches(":popover-open") === open) return;
    // A note someone pressed open stays until they close it.
    if (open && document.querySelector(".source-pop:popover-open")) return;
    if (open) element.showPopover();
    else element.hidePopover();
  };
  return (
    <span
      className="sourced"
      onMouseEnter={() => show(true)}
      onMouseLeave={() => {
        if (!pressed.current) show(false);
      }}
    >
      <button
        type="button"
        className={className}
        style={{ anchorName: anchor }}
        popoverTarget={id}
        popoverTargetAction="show"
        onClick={() => {
          pressed.current = true;
        }}
      >
        {label}
      </button>
      <span
        id={id}
        ref={note}
        popover="auto"
        className="source-pop"
        style={{ positionAnchor: anchor }}
        onToggle={(event) => {
          if (event.newState === "closed") pressed.current = false;
        }}
      >
        {children}
      </span>
    </span>
  );
}

interface SourceProps {
  signal: CmoCompetitorSignal;
}

/** A signal's source: title, publisher, date, quote, link. */
function Source({ signal }: SourceProps) {
  const name = signal.sourcePublisher ?? signal.sourceTitle ?? "Source";
  return (
    <Sourced
      className="source-chip"
      label={`${name}, ${day(signal.observedAt)}`}
    >
      <b>{signal.sourceTitle ?? name}</b>
      <span className="note">
        {name} · {signal.kind === "NEWS" ? "published" : "seen"}{" "}
        {day(signal.observedAt)}
      </span>
      {signal.quote ? <q>{signal.quote}</q> : null}
      {signal.sourceUrl ? (
        <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
          Open the source
        </a>
      ) : null}
    </Sourced>
  );
}

interface ThisWeekProps {
  data: CmoCompetitors;
  names: Map<string, string>;
  signals: Map<string, CmoCompetitorSignal>;
  addToStrategy: (itemId: string) => Promise<string | null>;
}

function ThisWeek({ data, names, signals, addToStrategy }: ThisWeekProps) {
  const { feed, check } = data;
  const [adding, setAdding] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ id: string; why: string } | null>(
    null,
  );
  if (!feed) {
    return (
      <section className="card">
        <h3>This week</h3>
        <p className="muted">
          {data.competitors.length === 0
            ? "Add a competitor below and I check it within the hour."
            : check.lastCheckedAt
              ? "I am reading what the last check found. My notes land here shortly."
              : "The first check runs within the hour. What moved shows here, each line with its source."}
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="comp-head">
        <h3>This week</h3>
        <span className="note">Checked {day(feed.checkDay)}</span>
      </div>
      {feed.items.length === 0 ? (
        <p className="muted">
          Nothing solid moved this week. I would sooner say so than guess.
        </p>
      ) : (
        <ul className="comp-moves">
          {feed.items.map((item) => (
            <li key={item.id} className="comp-move">
              <div className="comp-head">
                <b>{names.get(item.competitorId) ?? "A competitor"}</b>
                {item.big ? <span className="tag">Big move</span> : null}
              </div>
              {item.facts.map((fact) => {
                const sources = fact.signalIds.flatMap(
                  (signalId) => signals.get(signalId) ?? [],
                );
                return (
                  <p
                    key={`${fact.signalIds.join()}:${fact.text}`}
                    className="comp-fact"
                  >
                    {fact.text}{" "}
                    {fact.support === "weak" ? (
                      <span className="tag">Partly backed</span>
                    ) : null}{" "}
                    {sources.map((signal) => (
                      <Source key={signal.id} signal={signal} />
                    ))}
                    {sources.length === 0 ? (
                      <span className="note">
                        Its source is older than I keep.
                      </span>
                    ) : null}
                  </p>
                );
              })}
              <p>
                <span className="label">What this means for you</span>
                {item.meaning}
              </p>
              <p>
                <span className="label">Suggested move</span>
                {item.move}
              </p>
              {item.addedToStrategyAt ? (
                <StatusText>In the strategy</StatusText>
              ) : (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={adding !== null}
                  onClick={async () => {
                    setAdding(item.id);
                    setRefused(null);
                    const why = await addToStrategy(item.id);
                    if (why) setRefused({ id: item.id, why });
                    setAdding(null);
                  }}
                >
                  {adding === item.id ? "Adding" : "Add to strategy"}
                </button>
              )}
              {refused?.id === item.id ? (
                <p className="alert" role="alert">
                  {refused.why}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {feed.items.some((item) =>
        item.facts.some((fact) => fact.support === "weak"),
      ) ? (
        <p className="note">
          Partly backed: the source supports only part of the sentence.
        </p>
      ) : null}
      {feed.openQuestions.length > 0 ? (
        <div>
          <span className="label">Still open</span>
          <ul className="comp-open">
            {feed.openQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const COMPACT = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** One number with where and when it was read; an empty cell is no data. */
interface CellProps {
  measure: CmoCompetitorMeasure | null;
  signed?: boolean;
}

function Cell({ measure, signed = false }: CellProps) {
  if (!measure) {
    return (
      <td>
        <span className="cell-empty" role="img" aria-label="No data" />
      </td>
    );
  }
  const value = `${signed && measure.value > 0 ? "+" : ""}${COMPACT.format(measure.value)}`;
  return (
    <td>
      <Sourced className="source-number num" label={value}>
        <span className="note">Instagram · read {day(measure.observedAt)}</span>
        {measure.sourceUrl ? (
          <a href={measure.sourceUrl} target="_blank" rel="noreferrer">
            Open the account
          </a>
        ) : null}
      </Sourced>
    </td>
  );
}

interface ScoreboardProps {
  data: CmoCompetitors;
}

function Scoreboard({ data }: ScoreboardProps) {
  const { social } = data.check.sources;
  const hasNumbers = data.scoreboard.some(
    (row) => row.postsPerWeek || row.followers || row.engagementPerPost,
  );
  return (
    <section className="card">
      <h3>Scoreboard</h3>
      {social.needs ? <p className="muted">{social.needs}</p> : null}
      {!social.needs && !hasNumbers ? (
        <p className="muted">
          No Instagram numbers yet. They come with the next check, for
          competitors with a business account.
        </p>
      ) : null}
      {hasNumbers ? (
        <>
          <div className="comp-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Instagram</th>
                  <th scope="col">Posts a week</th>
                  <th scope="col">Per post</th>
                  <th scope="col">Followers</th>
                  <th scope="col">Growth</th>
                </tr>
              </thead>
              <tbody>
                {data.scoreboard.map((row) => (
                  <tr key={row.competitorId ?? "you"}>
                    <th scope="row">
                      {row.competitorId ? row.name : `You (${row.name})`}
                    </th>
                    <Cell measure={row.postsPerWeek} />
                    <Cell measure={row.engagementPerPost} />
                    <Cell measure={row.followers} />
                    <Cell measure={row.followerGrowth} signed />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Per post is likes and comments. An empty cell means no data.
          </p>
        </>
      ) : null}
    </section>
  );
}

interface TopPostsProps {
  data: CmoCompetitors;
  names: Map<string, string>;
  compose: (text: string) => void;
}

function TopPosts({ data, names, compose }: TopPostsProps) {
  if (data.topPosts.length === 0) return null;
  const byCompetitor = new Map<string, CmoCompetitors["topPosts"]>();
  for (const post of data.topPosts) {
    byCompetitor.set(post.competitorId, [
      ...(byCompetitor.get(post.competitorId) ?? []),
      post,
    ]);
  }
  return (
    <section className="card">
      <h3>What worked for them</h3>
      <p className="muted">
        Each competitor's three strongest posts of the last 30 days. Ideas to
        learn from, never to copy.
      </p>
      {[...byCompetitor].map(([competitorId, posts]) => {
        const name = names.get(competitorId) ?? "A competitor";
        return (
          <div key={competitorId} className="comp-posts">
            <div className="comp-head">
              <b>{name}</b>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() =>
                  compose(
                    `Look at ${name}'s strongest Instagram posts on the Competitors page. Tell me why each one worked and give me three ideas of our own from them, never copies.`,
                  )
                }
              >
                Ask {AGENT_NAME} for ideas
              </button>
            </div>
            <ul className="list">
              {posts.map((post) => (
                <li key={post.url ?? String(post.postedAt)} className="li">
                  <span className="tag">{day(post.postedAt)}</span>
                  <span className="grow">
                    {post.caption ?? "A post without a caption"}
                    <br />
                    <span className="note num">
                      {post.likes === null
                        ? "Likes hidden"
                        : `${COMPACT.format(post.likes)} likes`}{" "}
                      · {COMPACT.format(post.comments ?? 0)} comments
                    </span>
                  </span>
                  {post.url ? (
                    <a
                      className="button button-secondary button-small"
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** Everything the checks stored, newest first, each with its source. */
interface FoundProps {
  data: CmoCompetitors;
  names: Map<string, string>;
}

function Found({ data, names }: FoundProps) {
  const found = data.signals.filter((signal) => signal.kind !== "SOCIAL");
  if (found.length === 0) return null;
  return (
    <section className="card">
      <h3>What the checks found</h3>
      <ul className="list">
        {found.map((signal) => (
          <li key={signal.id} className="li comp-found">
            <span className="tag">{SIGNAL_KINDS[signal.kind]}</span>
            <span className="grow">{signal.summary}</span>
            <Source signal={signal} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const FIELDS = [
  ["name", "Name", "Calendly"],
  ["websiteUrl", "Website", "calendly.com"],
  ["pricingUrl", "Pricing page", "calendly.com/pricing"],
  ["instagramHandle", "Instagram", "@calendly"],
  ["facebookHandle", "Facebook Page", "calendly"],
] as const satisfies readonly (readonly [
  keyof CmoCompetitorCreate,
  string,
  string,
])[];

type Draft = Record<(typeof FIELDS)[number][0], string>;

function draftOf(competitor?: CmoCompetitor): Draft {
  return {
    name: competitor?.name ?? "",
    websiteUrl: competitor?.websiteUrl ?? "",
    pricingUrl: competitor?.pricingUrl ?? "",
    instagramHandle: competitor?.instagramHandle ?? "",
    facebookHandle: competitor?.facebookHandle ?? "",
  };
}

interface CompetitorFormProps {
  competitor?: CmoCompetitor;
  /** Resolves to why it was refused, or null once saved. */
  save: (input: CmoCompetitorCreate) => Promise<string | null>;
  cancel?: () => void;
}

function CompetitorForm({ competitor, save, cancel }: CompetitorFormProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(competitor));
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <form
      className="comp-form"
      action={async () => {
        setRefused(null);
        setRefused(
          await save({
            name: draft.name,
            websiteUrl: draft.websiteUrl || null,
            pricingUrl: draft.pricingUrl || null,
            instagramHandle: draft.instagramHandle || null,
            facebookHandle: draft.facebookHandle || null,
          }),
        );
      }}
    >
      {FIELDS.map(([key, label, placeholder]) => (
        <div key={key} className="field">
          <label htmlFor={`${id}-${key}`}>{label}</label>
          <input
            id={`${id}-${key}`}
            value={draft[key]}
            placeholder={placeholder}
            required={key === "name"}
            maxLength={key === "name" ? 80 : 200}
            autoCapitalize={key === "name" ? "words" : "none"}
            onChange={(event) =>
              setDraft({ ...draft, [key]: event.target.value })
            }
          />
        </div>
      ))}
      {refused ? (
        <p className="alert" role="alert">
          {refused}
        </p>
      ) : null}
      <div className="comp-form-acts">
        <SubmitButton className="button button-small">
          {competitor ? "Save" : "Add competitor"}
        </SubmitButton>
        {cancel ? (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={cancel}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

interface ManageProps {
  data: CmoCompetitors;
  actions: CompetitorActions;
  change: Change;
}

function Manage({ data, actions, change }: ManageProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const { check, competitors, limit } = data;
  const full = competitors.length >= limit;
  return (
    <section className="card">
      <div className="comp-head">
        <h3>Who I watch</h3>
        <span className="note num">
          {competitors.length} of {limit}
        </span>
      </div>
      <p className="muted">
        I check each one every week: its website and prices, the news, its ads
        and its Instagram. That costs {check.creditsPerCompetitor} credits a
        competitor.
        {check.lastCheckedAt
          ? ` Last check ${day(check.lastCheckedAt)}${check.nextCheckAt ? `, next ${day(check.nextCheckAt)}` : ""}.`
          : ""}
      </p>
      {check.sources.ads.needs ? (
        <p className="note">{check.sources.ads.needs}</p>
      ) : null}
      {competitors.length === 0 ? (
        <p className="muted">
          Nobody yet. I add the competitors from your market map once I have
          read your market, or you add one now.
        </p>
      ) : (
        <ul className="list">
          {competitors.map((competitor) =>
            editing === competitor.id ? (
              <li key={competitor.id} className="li">
                <CompetitorForm
                  competitor={competitor}
                  cancel={() => setEditing(null)}
                  save={async (input) => {
                    const why = await change(() =>
                      actions.updateCompetitor(competitor.id, input),
                    );
                    if (!why) setEditing(null);
                    return why;
                  }}
                />
              </li>
            ) : (
              <li key={competitor.id} className="li">
                <span className="grow">
                  <b>{competitor.name}</b>
                  <br />
                  <span className="note">
                    {[
                      competitor.websiteUrl
                        ? hostOf(competitor.websiteUrl)
                        : "No website",
                      competitor.pricingUrl ? "pricing page" : null,
                      competitor.instagramHandle
                        ? `@${competitor.instagramHandle}`
                        : null,
                      competitor.facebookHandle
                        ? `Facebook ${competitor.facebookHandle}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  aria-label={`Edit ${competitor.name}`}
                  onClick={() => setEditing(competitor.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  aria-label={`Remove ${competitor.name}`}
                  disabled={removing !== null}
                  onClick={async () => {
                    setRemoving(competitor.id);
                    setRefused(
                      await change(() =>
                        actions.removeCompetitor(competitor.id),
                      ),
                    );
                    setRemoving(null);
                  }}
                >
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {refused ? (
        <p className="alert" role="alert">
          {refused}
        </p>
      ) : null}
      {adding ? (
        <CompetitorForm
          cancel={() => setAdding(false)}
          save={async (input) => {
            const why = await change(() => actions.addCompetitor(input));
            if (!why) setAdding(false);
            return why;
          }}
        />
      ) : full ? (
        <p className="note">
          That is all {limit}. Remove one to watch another.
        </p>
      ) : (
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => setAdding(true)}
        >
          Add a competitor
        </button>
      )}
    </section>
  );
}
