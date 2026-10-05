"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2, Lock } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useTransition } from "react";

import { channelLabel, SOCIAL_PROVIDERS } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";

type Provider = (typeof SOCIAL_PROVIDERS)[number];

function isProvider(channel: string): channel is Provider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(channel);
}

/** The social networks in the strategy, which Cuso can post to once connected. */
export function strategySocialChannels(overview: CmoOverview): Provider[] {
  const channels = (overview.strategy?.channels ?? []).map((channel) =>
    channel.channel.trim().toLowerCase(),
  );
  return [...new Set(channels.filter(isProvider))];
}

interface ConnectStepProps {
  overview: CmoOverview;
  onConnect: (
    provider: Provider,
  ) => Promise<{ url: string | null; error: string | null }>;
  onContinue: () => Promise<void>;
}

/** Connect the networks in the plan, so Cuso can post. Each one is optional. */
export function ConnectStep({
  overview,
  onConnect,
  onContinue,
}: ConnectStepProps) {
  const providers = strategySocialChannels(overview);
  const calendar = overview.strategy?.calendar ?? [];
  const connected = new Set(
    overview.channels
      .filter((channel) => channel.status.toUpperCase() === "ACTIVE")
      .map((channel) => channel.provider.toLowerCase()),
  );
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [continuing, startContinuing] = useTransition();
  const allConnected = providers.every((provider) => connected.has(provider));

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
      const result = await onConnect(provider);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setPending(null);
      setError(result.error);
    });
  }

  return (
    <section className="ob-narrow">
      <p className="ob-eyebrow">Accounts</p>
      <h1 className="ob-title">Let Cuso post for you</h1>
      <p className="ob-lede">
        Connect the accounts in your plan. Cuso schedules posts there; you can
        pause or change any of them before they go out.
      </p>
      <ul className="ob-connect-list">
        {providers.map((provider, index) => {
          const pieces = calendar.filter(
            (entry) => entry.channel.toLowerCase() === provider,
          ).length;
          const done = connected.has(provider);
          const account = overview.channels.find(
            (channel) => channel.provider.toLowerCase() === provider,
          );
          return (
            <motion.li
              key={provider}
              className="ob-connect-row"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * index }}
            >
              <ChannelIcon channel={provider} size={22} />
              <div className="ob-connect-text">
                <p className="ob-connect-name">{channelLabel(provider)}</p>
                <p className="ob-note">
                  {done
                    ? `Connected${account?.handle ? ` as @${account.handle}` : ""}`
                    : `Unlocks ${pieces} ${pieces === 1 ? "piece" : "pieces"} in your first four weeks`}
                </p>
              </div>
              {done ? (
                <span className="ob-tag runs">
                  <Check size={12} aria-hidden="true" /> Connected
                </span>
              ) : (
                <button
                  type="button"
                  className="ob-button ob-button-quiet"
                  disabled={pending !== null}
                  onClick={() => connect(provider)}
                >
                  {pending === provider ? (
                    <Loader2 size={14} className="ob-spin" aria-hidden="true" />
                  ) : null}
                  Connect
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>
      {error ? (
        <p className="ob-alert" role="alert">
          {/configured|unavailable|set up/i.test(error)
            ? "Connecting accounts isn't available here yet. Skip for now; you can connect later in Settings."
            : error}
        </p>
      ) : null}
      <p className="ob-note ob-safe">
        <Lock size={13} aria-hidden="true" />
        Cuso never posts without a plan you approved, and you can disconnect any
        time.
      </p>
      <div className="ob-footer">
        <button
          type="button"
          className="ob-button ob-button-lg"
          disabled={continuing}
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
          {allConnected ? "Continue" : "Skip for now"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
