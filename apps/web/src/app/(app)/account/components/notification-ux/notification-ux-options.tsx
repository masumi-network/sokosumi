"use client";

import { Separator } from "@/components/ui/separator";
import { E1PresetStops } from "./e1-preset-stops";
import { E2PresetMenu } from "./e2-preset-menu";
import { E3TwoLadders } from "./e3-two-ladders";
import { E4GlanceOnly } from "./e4-glance-only";
import { E5TwoQuestions } from "./e5-two-questions";
import { E6TwoPickers } from "./e6-two-pickers";
import { E7PresetChips } from "./e7-preset-chips";
import { E8OneMenu } from "./e8-one-menu";
import { E9EditableSentence } from "./e9-editable-sentence";
import { E10PagePreset } from "./e10-page-preset";
import { useNotificationChoices } from "./use-notification-choices";

/**
 * Ten layouts for the same preferences, on one page, so they can be compared by
 * using them rather than by reading about them.
 *
 * All ten ask the same two questions per group: what to tell you about, and
 * where it arrives. They differ in whether a preset answers both at once, in
 * what the closed row shows without being opened, and in how much of the detail
 * survives inside the fold.
 *
 * Scaffolding. One gets picked and the rest go with this file. The copy here is
 * English only: these are evaluation labels, not product strings.
 */
const OPTIONS = [
  {
    id: "E1",
    title: "Presets as stops, with a glance",
    pitch:
      "D1 grown a second question. One press settles the group; the meter and icons say how far it reaches.",
    render: E1PresetStops,
  },
  {
    id: "E2",
    title: "Presets in a menu",
    pitch:
      "D3 grown a second question. Each preset says what it means for this group. Quietest row here.",
    render: E2PresetMenu,
  },
  {
    id: "E3",
    title: "Both ladders on the row",
    pitch:
      "No presets, nothing named for you. Two controls per group, and rows that stop lining up.",
    render: E3TwoLadders,
  },
  {
    id: "E4",
    title: "The row reports, the panel decides",
    pitch:
      "Readable top to bottom without touching anything. No change without opening something.",
    render: E4GlanceOnly,
  },
  {
    id: "E5",
    title: "Two questions, no per-subject chips",
    pitch:
      "The honest version of the ladder: one breadth, one delivery, and the fine control gone. Test what you miss.",
    render: E5TwoQuestions,
  },
  {
    id: "E6",
    title: "Both ladders as pickers",
    pitch:
      "The row keeps its width in any language. Comparing two groups means opening two menus.",
    render: E6TwoPickers,
  },
  {
    id: "E7",
    title: "Presets as chips that wrap",
    pitch:
      "Room to grow a fifth preset, because nothing has to fit on one line. Tallest of the ten.",
    render: E7PresetChips,
  },
  {
    id: "E8",
    title: "One menu, two headed sections",
    pitch:
      "One control per row however deep the ladder gets. Both questions are invisible until it opens.",
    render: E8OneMenu,
  },
  {
    id: "E9",
    title: "A sentence you edit",
    pitch:
      "Reading it and changing it are the same act. An underlined word is a weak invitation.",
    render: E9EditableSentence,
  },
  {
    id: "E10",
    title: "One answer for everything, then exceptions",
    pitch:
      "Same four words at both levels. Goes custom the moment any group differs, which is immediately.",
    render: E10PagePreset,
  },
] as const;

export function NotificationUxOptions() {
  const choices = useNotificationChoices();

  if (choices.isLoading || choices.groups.length === 0) {
    return null;
  }

  const push = choices.push;
  let pushState = "off for the account";
  if (push.isSupported === false) {
    pushState = "not supported in this browser";
  } else if (push.isBlocked) {
    pushState = "blocked by this browser";
  } else if (push.isAccountEnabled) {
    pushState = push.isDeviceEnabled
      ? "on, and this browser is subscribed"
      : "on for the account, this browser is not subscribed";
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted/40 space-y-1 rounded-lg border border-dashed p-4">
        <p className="text-sm leading-5 font-medium">
          Two questions per group, and ten ways to ask them
        </p>
        <p className="text-muted-foreground text-sm leading-6">
          Every group now answers <strong>what</strong> to tell you about and{" "}
          <strong>where</strong> it arrives. The first is a ladder whose rungs
          contain each other: every message in your rooms already carries the
          mentions, so the rungs under the one you pick show as included rather
          than as switches that would have to disagree. A preset is a name for
          one rung and one delivery together.
        </p>
        <p className="text-muted-foreground text-sm leading-6">
          All ten edit the same preferences, so a change in one shows up in the
          others. Asking for a banner anywhere turns push on and requests the
          browser permission from that control. Push is currently {pushState}.
        </p>
        <p className="text-muted-foreground text-sm leading-6">
          Marked <em>not stored yet</em>: threads you follow, every message in
          your rooms, every task update, every run status change, and the email
          channel. They are drawn so the ladders can be judged at the length
          they will really have. What they change is remembered for this visit
          and not saved.
        </p>
      </div>

      {OPTIONS.map((option) => {
        const Render = option.render;

        return (
          <div key={option.id} className="space-y-3">
            <Separator />
            <div>
              <p className="text-sm leading-5 font-medium">
                {option.id}. {option.title}
              </p>
              <p className="text-muted-foreground text-sm leading-6">
                {option.pitch}
              </p>
            </div>
            <Render choices={choices} />
          </div>
        );
      })}
    </div>
  );
}
