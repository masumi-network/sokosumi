"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowUpRight, Check, FileUp, Loader2, Lock } from "lucide-react";
import { motion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { channelLabel, SOCIAL_PROVIDERS } from "../../lib/calendar";
import {
  type ChannelGroup,
  COMMENT_REPLY_CHANNELS,
  channelInfo,
  channelKey,
  SOON_CHANNELS,
} from "../../lib/channels";
import { ChannelIcon } from "../channel-icon";
import { StepHead } from "./step-head";

type Provider = (typeof SOCIAL_PROVIDERS)[number];

function isProvider(channel: string): channel is Provider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(channel);
}

/** Every channel in the strategy that Cuso runs, by its key. */
export function strategyChannels(overview: CmoOverview): string[] {
  return [
    ...new Set(
      (overview.strategy?.channels ?? [])
        .map((channel) => channelKey(channel.channel))
        .filter(
          (key): key is NonNullable<typeof key> =>
            key !== null && channelInfo(key)?.status === "live",
        ),
    ),
  ];
}

/** Whether the plan uses a channel the founder sets up: social, ads, newsletter. */
export function needsAccounts(overview: CmoOverview): boolean {
  return strategyChannels(overview).some((key) => key !== "seo");
}

/** The social networks in the strategy, which Cuso can post to once connected. */
export function strategySocialChannels(overview: CmoOverview): Provider[] {
  return strategyChannels(overview).filter(isProvider);
}

/**
 * What the founder may add but need not: the plan's ads and newsletter, and
 * the channels Cuso proposed adding, with how much each would bring a month.
 */
export function optionalChannels(
  overview: CmoOverview,
): { key: string; perMonth: number | null }[] {
  const planned = strategyChannels(overview);
  const own = planned
    .filter((key) => !isProvider(key) && key !== "seo")
    .map((key) => ({ key, perMonth: null }));
  const proposed = (overview.strategy?.proposals ?? []).flatMap((proposal) => {
    const key = channelKey(proposal.channel);
    return key &&
      channelInfo(key)?.status === "live" &&
      !planned.includes(key) &&
      key !== "seo"
      ? [{ key, perMonth: proposal.perMonth }]
      : [];
  });
  return [...own, ...proposed].filter(
    (channel, index, all) =>
      all.findIndex((other) => other.key === channel.key) === index,
  );
}

interface ConnectStepProps {
  overview: CmoOverview;
  onConnect: (
    provider: Provider,
  ) => Promise<{ url: string | null; error: string | null }>;
  onMailingList: (text: string) => Promise<string | null>;
  onContinue: () => Promise<void>;
}

const GROUP_ORDER: ChannelGroup[] = ["social", "ads", "email", "search"];

/** Below the 1 MB a server action carries; about 20,000 addresses. */
const MAX_LIST_BYTES = 900_000;

/**
 * Everything Cuso needs to run the plan, channel by channel: the social
 * accounts to connect, the ad accounts, the mailing list, and what SEO asks
 * of the founder. Each one is optional.
 */
export function ConnectStep({
  overview,
  onConnect,
  onMailingList,
  onContinue,
}: ConnectStepProps) {
  const required = strategySocialChannels(overview);
  const optional = optionalChannels(overview);
  const searchOnly = strategyChannels(overview).includes("seo");
  const calendar = overview.strategy?.calendar ?? [];
  const connected = new Set(
    overview.channels
      .filter((channel) => channel.status.toUpperCase() === "ACTIVE")
      .map((channel) => channel.provider.toLowerCase()),
  );
  const ads = new Set(overview.adProviders);
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [continuing, startContinuing] = useTransition();
  const missing = required.filter((key) => !connected.has(key));
  const pieces = (key: string) =>
    calendar.filter((entry) => channelKey(entry.channel) === key).length;

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("connect") === "failed"
    ) {
      setError("That connection didn't finish. Try again.");
    }
  }, []);

  function connect(provider: Provider) {
    setPending(provider);
    setError(null);
    startTransition(async () => {
      try {
        const result = await onConnect(provider);
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setPending(null);
        setError(result.error);
      } catch {
        setPending(null);
        setError("Could not connect. Try again.");
      }
    });
  }

  const byGroup = (keys: string[]) =>
    [...keys].sort(
      (a, b) =>
        GROUP_ORDER.indexOf(channelInfo(a)?.group ?? "search") -
        GROUP_ORDER.indexOf(channelInfo(b)?.group ?? "search"),
    );
  const needed = [...required, ...(searchOnly ? ["seo"] : [])];
  const sections = [
    { label: "Needed", keys: needed },
    { label: "Optional", keys: byGroup(optional.map(({ key }) => key)) },
  ].filter((section) => section.keys.length > 0);
  const perMonth = (key: string) =>
    optional.find((channel) => channel.key === key)?.perMonth ?? null;

  function row(key: string, delay: number) {
    const done = connected.has(key) || ads.has(key);
    return (
      <motion.li
        key={key}
        className="ob-connect-row"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 * delay }}
      >
        <ChannelIcon channel={key} size={22} />
        {key === "newsletter" ? (
          <MailingList
            size={overview.mailingListSize}
            issues={pieces(key)}
            onAdd={onMailingList}
          />
        ) : (
          <>
            <div className="ob-connect-text">
              <p className="ob-connect-name">{channelLabel(key)}</p>
              <p className="ob-note">
                {rowNote(key, {
                  connected: done,
                  handle: overview.channels.find(
                    (channel) => channel.provider.toLowerCase() === key,
                  )?.handle,
                  pieces: pieces(key),
                  perMonth: perMonth(key),
                })}
              </p>
            </div>
            {key === "seo" ? (
              <Done>Nothing to connect</Done>
            ) : done ? (
              <Done>Connected</Done>
            ) : isProvider(key) ? (
              <button
                type="button"
                className={
                  required.includes(key)
                    ? "ob-button"
                    : "ob-button ob-button-quiet"
                }
                disabled={pending !== null}
                onClick={() => connect(key)}
              >
                {pending === key ? (
                  <Loader2 size={14} className="ob-spin" aria-hidden="true" />
                ) : null}
                Connect
              </button>
            ) : (
              <a
                className="ob-button ob-button-quiet"
                href={overview.connectAdsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Connect
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
          </>
        )}
      </motion.li>
    );
  }

  return (
    <section className="ob-narrow">
      <StepHead
        step={7}
        title="Accounts"
        mood="point"
        say={
          required.length > 0
            ? "Connect the accounts I post to. Ads and the rest are optional: add them now or later."
            : "Nothing here is needed to start. Add any of these now or later."
        }
        note={
          missing.length > 0
            ? `Connect ${listNames(missing.map(channelLabel))} to continue.`
            : undefined
        }
        action={
          <button
            type="button"
            className="ob-button ob-button-lg"
            disabled={continuing || missing.length > 0}
            onClick={() =>
              startContinuing(async () => {
                try {
                  await onContinue();
                } catch {
                  setError("Could not continue. Try again.");
                }
              })
            }
          >
            <Check size={16} aria-hidden="true" />
            Continue
          </button>
        }
      />

      {sections.map((section, sectionIndex) => (
        <div key={section.label} className="ob-connect-group">
          <p className="ob-label">{section.label}</p>
          <ul className="ob-connect-list">
            {section.keys.map((key, index) =>
              row(key, sectionIndex * 3 + index),
            )}
          </ul>
        </div>
      ))}

      {SOON_CHANNELS.length > 0 ? (
        <p className="ob-note ob-connect-soon">
          {SOON_CHANNELS.map((channel) => channel.name).join(" and ")}{" "}
          {SOON_CHANNELS.length === 1 ? "is" : "are"} coming soon.
        </p>
      ) : null}

      {error ? (
        <p className="ob-alert" role="alert">
          {/configured|unavailable|set up/i.test(error)
            ? "Connecting accounts isn't available here yet."
            : error}
        </p>
      ) : null}
      <p className="ob-note ob-safe">
        <Lock size={13} aria-hidden="true" />
        Cuso only does what your approved plan says, and you can disconnect any
        time.
      </p>
    </section>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <span className="ob-tag runs">
      <Check size={12} aria-hidden="true" /> {children}
    </span>
  );
}

/** Names as one phrase: "X", "X and LinkedIn", "X, LinkedIn and Facebook". */
function listNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function rowNote(
  key: string,
  state: {
    connected: boolean;
    handle?: string | null;
    pieces: number;
    /** A channel Cuso proposed adding: what it would bring a month. */
    perMonth: number | null;
  },
): string {
  const group = channelInfo(key)?.group;
  if (group === "search") {
    return "Ongoing page fixes and full articles. You paste them into your site; no connection needed.";
  }
  const platform = key === "google_ads" ? "Google Ads" : "Meta";
  const replies = COMMENT_REPLY_CHANNELS.includes(key)
    ? " Cuso answers its comments every day."
    : "";
  if (state.connected) {
    return group === "ads"
      ? `Connected. You set the budget and launch the ads in ${platform}.`
      : `Connected${state.handle ? ` as @${state.handle}` : ""}.${replies}`;
  }
  if (state.perMonth !== null) {
    const what = group === "ads" ? "ad" : key === "youtube" ? "video" : "post";
    return `Adds ${state.perMonth} ${what}${state.perMonth === 1 ? "" : "s"} a month.`;
  }
  if (group === "ads") {
    return `${state.pieces} ${state.pieces === 1 ? "ad" : "ads"}, written and designed. You set the budget and launch ${state.pieces === 1 ? "it" : "them"} in ${platform}.`;
  }
  const what = key === "youtube" ? "video" : "post";
  return `Unlocks ${state.pieces} ${what}${state.pieces === 1 ? "" : "s"} in your first four weeks.${replies}`;
}

/** The newsletter needs the founder's list: a CSV export or pasted addresses. */
function MailingList({
  size,
  issues,
  onAdd,
}: {
  size: number;
  issues: number;
  onAdd: (text: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const add = (value: string) =>
    startSaving(async () => {
      setError(null);
      if (new TextEncoder().encode(value).length > MAX_LIST_BYTES) {
        setError(
          "That list is too big. Export only the email column, or split the list.",
        );
        return;
      }
      try {
        const refused = await onAdd(value);
        if (refused) setError(refused);
        else {
          setOpen(false);
          setText("");
        }
      } catch {
        setError(
          "That didn't upload. Try a smaller file, or paste the addresses.",
        );
      }
    });

  return (
    <div className="ob-mailing">
      <div className="ob-connect-head">
        <div className="ob-connect-text">
          <p className="ob-connect-name">Newsletter</p>
          <p className="ob-note">
            {size > 0
              ? `${size} ${size === 1 ? "person" : "people"} on your list. Cuso writes ${issues} ${issues === 1 ? "issue" : "issues"} for them, ready to send with your email service.`
              : `Cuso writes ${issues} ${issues === 1 ? "issue" : "issues"}, ready to send with your email service. Add your mailing list so he writes for the people on it.`}
          </p>
        </div>
        {open ? null : (
          <button
            type="button"
            className="ob-button ob-button-quiet"
            onClick={() => setOpen(true)}
          >
            {size > 0 ? "Add more" : "Add your list"}
          </button>
        )}
      </div>
      {open ? (
        <div className="ob-mailing-form">
          <textarea
            className="ob-input"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              "Paste email addresses, one a line, or upload a CSV export"
            }
            aria-label="Email addresses"
            disabled={saving}
          />
          <div className="ob-mailing-actions">
            <input
              ref={file}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              hidden
              onChange={async (event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (!chosen) return;
                if (chosen.size > MAX_LIST_BYTES) {
                  setError(
                    "That file is too big. Export only the email column, or split the list.",
                  );
                  return;
                }
                add(await chosen.text());
              }}
            />
            <button
              type="button"
              className="ob-button ob-button-quiet"
              disabled={saving}
              onClick={() => file.current?.click()}
            >
              <FileUp size={14} aria-hidden="true" />
              Upload CSV
            </button>
            <button
              type="button"
              className="ob-button"
              disabled={saving || !text.trim()}
              onClick={() => add(text)}
            >
              {saving ? (
                <Loader2 size={14} className="ob-spin" aria-hidden="true" />
              ) : null}
              Add
            </button>
          </div>
          <p className="ob-note">
            Exported from Mailchimp, Substack, Shopify or a spreadsheet: any CSV
            with an email column works.
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="ob-alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
