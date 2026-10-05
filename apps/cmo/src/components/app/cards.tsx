"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useTransition } from "react";

import { channelLabel } from "../../lib/calendar";
import { ExpandableText } from "./expandable-text";
import { CalendarLegend, MonthCalendar } from "./month-calendar";

type Update = CmoOverview["updates"][number];

/** What a card can ask the app to do. */
export interface CardActions {
  approve: () => Promise<void>;
  revert: (updateId: string) => Promise<void>;
  /** Starts Cuso's first look at the business again. */
  retryLearning: () => Promise<void>;
  /** Puts text in the composer and focuses it. */
  compose: (text: string) => void;
  open: (view: "strategy" | "brain" | "results" | "channels") => void;
}

type BrandBrain = NonNullable<CmoOverview["brandBrain"]>;

const UNCONFIRMED = /not confirmed|could not|not found/i;

function known(values: string[]): boolean {
  return values.some((value) => value.trim() && !UNCONFIRMED.test(value));
}

/** Each step is ticked only when the Brand Brain holds something real for it. */
export function learningSteps(brain: BrandBrain | null) {
  return [
    ["Website", brain ? known([brain.summary]) : false],
    ["Products", brain ? known(brain.products) : false],
    ["Audience", brain ? known(brain.audience) : false],
    [
      "Competitors",
      brain ? known(brain.competitors.map((c) => c.name)) : false,
    ],
    [
      "Existing marketing",
      brain ? known(brain.channels.map((c) => c.name)) : false,
    ],
  ] as const;
}

export function LearningCard({
  brain,
  state,
  actions,
}: {
  brain: BrandBrain | null;
  state: CmoOverview["learning"];
  actions: CardActions;
}) {
  const [pending, startTransition] = useTransition();
  const steps = learningSteps(brain);
  const missing = steps.filter(([, found]) => !found).length;
  const running = state === "running";
  const failed = state === "failed";
  const status = running
    ? "In progress"
    : failed
      ? "Stopped"
      : !brain
        ? "Needs your answers"
        : missing === 0
          ? "Done"
          : `${missing} not confirmed yet`;
  return (
    <div className={failed ? "card highlight" : "card"}>
      <div className="ch">
        <b>Learning</b>
        <span className="sp" />
        <span className="note">{status}</span>
      </div>
      <div className="cb">
        {failed ? (
          <p className="txt">
            I couldn't finish learning your business. Nothing was lost; try
            again and I'll start over.
          </p>
        ) : (
          <div className="steps">
            {steps.map(([step, found]) => (
              <div
                key={step}
                className={running ? "step run" : found ? "step ok" : "step"}
              >
                <span className="dot" aria-hidden="true" />
                {step}
                {brain && !found ? (
                  <span className="note">Not confirmed yet</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      {failed ? (
        <div className="cf">
          <button
            type="button"
            className="button button-small"
            disabled={pending}
            onClick={() => startTransition(() => actions.retryLearning())}
          >
            {pending ? "Starting…" : "Try again"}
          </button>
        </div>
      ) : !running && !brain ? (
        <div className="cf">
          <span className="note">I have a few questions. Answer below.</span>
        </div>
      ) : brain && missing > 0 ? (
        <div className="cf">
          <span className="note">
            Tell me what I missed in the chat, or share a link.
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function BrandBrainCard({
  brandBrain,
  actions,
}: {
  brandBrain: NonNullable<CmoOverview["brandBrain"]>;
  actions: CardActions;
}) {
  return (
    <div className="card">
      <div className="ch">
        <b>Brand Brain</b>
        <span className="tag">Saved</span>
        <span className="sp" />
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => actions.open("brain")}
        >
          Open
        </button>
      </div>
      <div className="cb">
        <dl className="kv">
          <dt>Business</dt>
          <dd>
            <ExpandableText text={brandBrain.summary} />
          </dd>
          <dt>Voice</dt>
          <dd>{brandBrain.voice.tone}</dd>
          <dt>Audience</dt>
          <dd>{brandBrain.audience.join(", ") || "Not found yet"}</dd>
          <dt>Competitors</dt>
          <dd>
            {brandBrain.competitors.map((c) => c.name).join(", ") ||
              "Not found yet"}
          </dd>
        </dl>
      </div>
      <div className="cf">
        <span className="note">
          Wrong? Tell me in the chat and I will fix it.
        </span>
      </div>
    </div>
  );
}

const PREVIEW_LABELS = {
  post: "Post",
  ad: "Ad",
  seo: "SEO article",
  newsletter: "Newsletter",
} as const;

/** Ads, SEO and newsletters have no Sokosumi tool yet: preview only. */
const EXECUTABLE_PREVIEWS = new Set(["post"]);

export function StrategyCard({
  overview,
  actions,
}: {
  overview: CmoOverview;
  actions: CardActions;
}) {
  const [pending, startTransition] = useTransition();
  const strategy = overview.strategy;
  if (!strategy) return null;
  const approved = overview.strategyApprovedAt !== null;
  return (
    <div className={approved ? "card" : "card highlight"}>
      <div className="ch">
        <b>Strategy for {formatMonth(strategy.month)}</b>
        <span className="sp" />
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => actions.open("strategy")}
        >
          Open full
        </button>
      </div>
      <div className="cb">
        <dl className="kv">
          <dt>Goal</dt>
          <dd>{strategy.goals.join(" · ")}</dd>
          {strategy.audience ? (
            <>
              <dt>Audience</dt>
              <dd>{strategy.audience}</dd>
            </>
          ) : null}
          {strategy.positioning ? (
            <>
              <dt>Positioning</dt>
              <dd>{strategy.positioning}</dd>
            </>
          ) : null}
          <dt>Channels</dt>
          <dd className="chanrow">
            {strategy.channels.map((channel) => (
              <span key={channel.channel} className="tag">
                {channelLabel(channel.channel)}
              </span>
            ))}
          </dd>
        </dl>
        <div>
          <span className="label">Calendar</span>
          <div className="stack-sm">
            <MonthCalendar strategy={strategy} />
            <CalendarLegend />
          </div>
        </div>
        {strategy.previews && strategy.previews.length > 0 ? (
          <div>
            <span className="label">Examples</span>
            <div className="previews">
              {strategy.previews.map((preview) => (
                <div key={preview.kind} className="pv">
                  <span className="pv-head">
                    <span className="tag">{PREVIEW_LABELS[preview.kind]}</span>
                    {EXECUTABLE_PREVIEWS.has(preview.kind) ? null : (
                      <span className="note">Coming soon</span>
                    )}
                  </span>
                  <b>{preview.title}</b>
                  <p className="pv-body">{preview.body}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="cf">
        {approved ? (
          <>
            <span className="tag ok">Approved</span>
            <span className="note">
              Cuso runs this plan and keeps it current.
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button button-accent button-small"
              disabled={pending}
              onClick={() => startTransition(actions.approve)}
            >
              {pending ? "Approving" : "Approve strategy"}
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => actions.compose("")}
            >
              Change something
            </button>
            <span className="note">
              This is the only thing you approve. Cuso runs the rest.
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function SubscribeCard({ overview }: { overview: CmoOverview }) {
  const subscribed = overview.subscriptionActive;
  return (
    <div className={subscribed ? "card" : "card highlight"}>
      <div className="ch">
        <b>Put Cuso to work</b>
      </div>
      <div className="cb">
        <p>
          {subscribed
            ? "Your plan is active. Cuso executes the approved strategy."
            : "Cuso starts scheduling and publishing once the business has an active plan. Until then everything stays a draft."}
        </p>
        <span className="note">
          Plan: {overview.billing.plan ?? "none"} · Credits:{" "}
          <span className="num">
            {Math.floor(overview.billing.availableCredits)}
          </span>
        </span>
      </div>
      <div className="cf">
        {subscribed ? (
          <span className="tag ok">Subscribed</span>
        ) : (
          <a
            className="button button-accent button-small"
            href={overview.subscribeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Subscribe and start
          </a>
        )}
      </div>
    </div>
  );
}

export function ConnectCard({ overview }: { overview: CmoOverview }) {
  return (
    <div className="card">
      <div className="ch">
        <b>Connect a channel</b>
        <span className="tag warn">Not connected</span>
      </div>
      <div className="cb">
        <p>
          I can not publish anything yet. Connect at least one social account
          and I start.
        </p>
      </div>
      <div className="cf">
        <a
          className="button button-accent button-small"
          href={overview.connectChannelUrl}
          target="_blank"
          rel="noreferrer"
        >
          Connect a channel
        </a>
        <span className="note">Until then I keep the posts as drafts.</span>
      </div>
    </div>
  );
}

function ItemList({
  items,
  actions,
}: {
  items: string[];
  actions?: CardActions;
}) {
  return (
    <ul className="list">
      {items.map((item) => (
        <li key={item} className="li">
          <span className="grow">{item}</span>
          {actions ? (
            <span className="acts">
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => actions.compose(`Change "${item}": `)}
              >
                Change
              </button>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => actions.compose(`Pause "${item}"`)}
              >
                Pause
              </button>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const UPDATE_TITLES = {
  daily: "Daily update",
  weekly: "Weekly results",
  monthly: "Next month's strategy",
  brand: "Brand Brain refreshed",
  request: "Done",
} as const;

const CHANGE_LABELS = {
  weekly: "What I changed in the strategy",
  monthly: "What changes from this month",
  brand: "What changed in the Brand Brain",
} as const;

/** Updates that change the strategy, which the owner can put back. */
function changesStrategy(kind: Update["kind"]): boolean {
  return kind === "weekly" || kind === "monthly";
}

export function UpdateCard({
  update,
  actions,
  approved,
}: {
  update: Update;
  actions: CardActions;
  /** Once the strategy is approved, what is up next can be changed or paused. */
  approved: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className={update.kind === "request" ? "card highlight" : "card"}>
      <div className="ch">
        <b>{UPDATE_TITLES[update.kind]}</b>
        <span className="note">{update.headline}</span>
        <span className="sp" />
        <span className="note num">{formatTime(update.at)}</span>
      </div>
      <div className="cb">
        {changesStrategy(update.kind) ? (
          <div>
            <span className="label">Results</span>
            <p>{update.results ?? "No numbers from the providers yet."}</p>
          </div>
        ) : null}
        {(update.done ?? []).length > 0 ? (
          <div>
            <span className="label">
              {update.kind === "daily" ? "Done today" : "Done"}
            </span>
            <ItemList items={update.done ?? []} />
          </div>
        ) : null}
        {(update.upNext ?? []).length > 0 ? (
          <div>
            <span className="label">Up next</span>
            <ItemList
              items={update.upNext ?? []}
              actions={approved ? actions : undefined}
            />
          </div>
        ) : null}
        {update.kind !== "daily" &&
        update.kind !== "request" &&
        (update.changes ?? []).length > 0 ? (
          <div>
            <span className="label">{CHANGE_LABELS[update.kind]}</span>
            <ul className={update.revertedAt ? "list reverted" : "list"}>
              {(update.changes ?? []).map((change) => (
                <li key={change} className="li">
                  <span className="tag accent">
                    {update.revertedAt ? "Reverted" : "Changed"}
                  </span>
                  <span className="grow">{change}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="cf">
        {changesStrategy(update.kind) && update.revertible ? (
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={pending}
            onClick={() => startTransition(() => actions.revert(update.id))}
          >
            {pending ? "Reverting" : "Revert these changes"}
          </button>
        ) : null}
        {update.kind === "weekly" ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => actions.open("results")}
          >
            Open Results
          </button>
        ) : update.kind === "monthly" ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => actions.open("strategy")}
          >
            Open strategy
          </button>
        ) : update.kind === "brand" ? (
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => actions.open("brain")}
          >
            Open Brand Brain
          </button>
        ) : null}
        <span className="note">
          {update.revertedAt
            ? "Reverted. The strategy is back to how it was."
            : approved
              ? "No approvals needed. Reply to change anything."
              : "Reply to change anything."}
        </span>
      </div>
    </div>
  );
}

export function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(at: Date | string): string {
  return new Date(at).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
