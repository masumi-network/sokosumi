import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

type ShareOfVoice = NonNullable<ProjectSeoWorkspace["shareOfVoice"]>;
type Week = ShareOfVoice["weeks"][number];

export type SeoShareRow = {
  kind: "site" | "competitor" | "others" | "unattributed";
  /** The competitor's domain; null for the other rows. */
  domain: string | null;
  share: number;
  /** Share now minus the share of the week before, 0 to 1; null without that week. */
  change: number | null;
};

/**
 * The card of the newest week: the site, the confirmed competitors by share, then everyone else and the results
 * the read could not name, when they have a share. The change compares with the week before that has data.
 */
export function seoShareOfVoiceCard(
  shareOfVoice: ProjectSeoWorkspace["shareOfVoice"],
) {
  const weeks = shareOfVoice?.weeks ?? [];
  const latest = weeks.at(-1);
  if (!shareOfVoice || !latest) return null;
  const previous: Week | undefined = weeks.at(-2);
  const rivalBefore = (domain: string) =>
    previous?.competitors.find((row) => row.domain === domain)?.share;
  const rows: SeoShareRow[] = [
    {
      kind: "site",
      domain: null,
      share: latest.site,
      change: previous ? latest.site - previous.site : null,
    },
    ...[...latest.competitors]
      .sort((a, b) => b.share - a.share || a.domain.localeCompare(b.domain))
      .map((row) => {
        const before = rivalBefore(row.domain);
        return {
          kind: "competitor" as const,
          domain: row.domain,
          share: row.share,
          change: before === undefined ? null : row.share - before,
        };
      }),
    ...(latest.others
      ? [
          {
            kind: "others" as const,
            domain: null,
            share: latest.others,
            change: null,
          },
        ]
      : []),
    ...(latest.unattributed
      ? [
          {
            kind: "unattributed" as const,
            domain: null,
            share: latest.unattributed,
            change: null,
          },
        ]
      : []),
  ];
  return {
    weekStart: latest.weekStart,
    reads: latest.reads,
    previousWeek: previous?.weekStart ?? null,
    ctrSource: shareOfVoice.ctrSource,
    rows,
    /** The site's share per week, newest first, for the table under the card. */
    siteWeeks: [...weeks]
      .reverse()
      .map((week) => ({ weekStart: week.weekStart, share: week.site })),
  };
}
