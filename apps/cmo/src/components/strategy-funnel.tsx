"use client";

import "./strategy-funnel.css";

import type { CmoOverview } from "@sokosumi/core-client";
import type { CSSProperties } from "react";

import { channelLabel } from "../lib/calendar";
import { channelInfo, channelKey } from "../lib/channels";
import { ChannelIcon } from "./channel-icon";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Stage = NonNullable<Strategy["funnel"]>[number];
type Proposal = NonNullable<Strategy["proposals"]>[number];

/**
 * How a stranger becomes a customer: one band per stage, narrowing toward
 * the sale, with the channels that do each job and the number that shows it.
 */
export function Funnel({ stages }: { stages: Stage[] }) {
  return (
    <ol className="fn">
      {stages.map((stage, index) => (
        <li
          key={stage.stage}
          className="fn-row"
          style={
            {
              "--fn-width": `${100 - index * (48 / Math.max(stages.length - 1, 1))}%`,
              "--fn-tint": `${88 - index * 18}%`,
            } as CSSProperties
          }
        >
          <div className={index < 2 ? "fn-band dark" : "fn-band"}>
            <b>{stage.name}</b>
          </div>
          <div className="fn-info">
            <p className="fn-goal">{stage.goal}</p>
            <p className="fn-meta">
              <span className="fn-icons">
                {[
                  ...new Set(
                    (stage.channels ?? []).map(
                      (channel) => channelKey(channel) ?? channel,
                    ),
                  ),
                ].map((channel) => (
                  <ChannelIcon key={channel} channel={channel} size={14} />
                ))}
              </span>
              <span>
                {stage.metric}
                {stage.target ? ` · ${stage.target}` : ""}
              </span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** What the owner adds so Cuso can run a proposed channel. */
export const ADD_TO_RUN: Record<string, string> = {
  connect: "Add the account",
  ad_account: "Connect an ad account and set a budget",
  mailing_list: "Add your mailing list",
  publish: "Nothing to add",
};

/** Channels Cuso runs that this plan leaves out until the owner adds them. */
export function Proposals({ proposals }: { proposals: Proposal[] }) {
  return (
    <ul className="fn-proposals">
      {proposals.map((proposal) => {
        const owner = channelInfo(proposal.channel)?.owner ?? "connect";
        return (
          <li key={proposal.channel}>
            <p className="fn-proposal-name">
              <ChannelIcon channel={proposal.channel} size={16} />
              {channelLabel(proposal.channel)}
              <span className="fn-proposal-count num">
                {proposal.perMonth} a month
              </span>
            </p>
            <p>{proposal.what}</p>
            <p className="note">{proposal.why}</p>
            <p className="fn-proposal-add">{ADD_TO_RUN[owner]}</p>
          </li>
        );
      })}
    </ul>
  );
}
