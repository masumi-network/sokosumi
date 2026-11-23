"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { type CmoVolumeLevel, cmoMonthAtLevel } from "@sokosumi/utils";

import { channelLabel } from "../lib/calendar";
import { madeByNetwork, newsletterIssues } from "../lib/strategy";
import { ChannelIcon } from "./channel-icon";
import "./plan-sizes.css";

type Strategy = NonNullable<CmoOverview["strategy"]>;

/** The CMO plans, smallest first, and the level each makes of a month. */
const PLANS: { level: CmoVolumeLevel; name: string }[] = [
  { level: "steady", name: "Starter" },
  { level: "active", name: "Growth" },
  { level: "all_in", name: "Scale" },
];

/**
 * What each plan makes of this strategy, per network: posts a month on
 * Starter, Growth and Scale, from the same split Core makes
 * (`cmoMonthAtLevel`), the busiest network first.
 */
export function PlanSizes({ strategy }: { strategy: Strategy }) {
  const plans = PLANS.map(({ level, name }) => {
    const { made, videos } = cmoMonthAtLevel(strategy.calendar, level);
    const counts = new Map(
      madeByNetwork(strategy.calendar, made).map(({ key, posts }) => [
        key,
        posts,
      ]),
    );
    // Issues count as posts in "Up to N posts", so the total matches it.
    const issues = newsletterIssues(strategy.calendar, made);
    if (issues > 0) counts.set("newsletter", issues);
    return { name, counts, videos };
  });
  // One short video goes out on TikTok, Reels and Shorts and counts on each,
  // so NMKR's Instagram read 95 on Starter beside YouTube's 68: say so.
  const shared = strategy.calendar.some(
    (entry) =>
      (entry.alsoOn?.length ?? 0) > 0 &&
      !strategy.calendar.some((copy) => copy.videoOf === entry.id),
  );
  const top = plans.at(-1);
  if (!top || top.counts.size === 0) return null;
  const networks = [...top.counts.keys()];
  const total = (counts: Map<string, number>) =>
    [...counts.values()].reduce((sum, posts) => sum + posts, 0);
  return (
    <section className="card plan-sizes" aria-labelledby="plan-sizes-head">
      <h2 id="plan-sizes-head">What each plan makes</h2>
      <p className="note">
        Posts a month on each plan. You pick your plan in the next step.
      </p>
      <table className="plan-sizes-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Network</span>
            </th>
            {plans.map((plan) => (
              <th key={plan.name} scope="col">
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {networks.map((key) => (
            <tr key={key}>
              <th scope="row">
                <span className="plan-sizes-network">
                  <ChannelIcon channel={key} size={16} />
                  {channelLabel(key)}
                </span>
              </th>
              {plans.map((plan) => (
                <td key={plan.name} className="num">
                  {plan.counts.get(key) ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All</th>
            {plans.map((plan) => (
              <td key={plan.name} className="num">
                {total(plan.counts)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      {shared ? (
        <p className="note">
          Each short video goes out on TikTok, Instagram (as a Reel) and YouTube
          (as a Short) at once, so it counts on each. Instagram adds its picture
          posts. New videos a month:{" "}
          {plans.map((plan) => `${plan.name} ${plan.videos}`).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}
