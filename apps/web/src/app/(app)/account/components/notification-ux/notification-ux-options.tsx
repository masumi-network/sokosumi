"use client";

import { Separator } from "@/components/ui/separator";
import { F1SubjectStops } from "./f1-subject-stops";
import { F2SubjectChannels } from "./f2-subject-channels";
import { F3SubjectSwitches } from "./f3-subject-switches";
import { F4NestedSubjects } from "./f4-nested-subjects";
import { PagePresets } from "./preset-controls";
import { useNotificationChoices } from "./use-notification-choices";

/**
 * Four layouts for the same preferences, on one page, so they can be compared
 * by using them rather than by reading about them.
 *
 * All four share one rule, which is the point of this round: everything you can
 * ask for is a row, every row appears once, and a row that another row already
 * carries says so instead of being drawn a second time. They differ only in the
 * control on the row and in how containment is shown.
 *
 * Scaffolding. One gets picked and the rest go with this file. The copy here is
 * English only: these are evaluation labels, not product strings.
 */
const OPTIONS = [
  {
    id: "F1",
    title: "Three stops per subject",
    pitch:
      "Off, in Sokosumi, banner. A covered row keeps its stops and greys out the ones below its cover, so the reader can see where “off” went.",
    render: F1SubjectStops,
  },
  {
    id: "F2",
    title: "Channels per subject",
    pitch:
      "The same rows with a tick per channel. The only shape that has somewhere to put email, which is not louder than a banner but elsewhere.",
    render: F2SubjectChannels,
  },
  {
    id: "F3",
    title: "A switch, then the banner",
    pitch:
      "Smallest control on the page. A reader who never wants a banner never meets it, at the price of a column that moves as rows go on.",
    render: F3SubjectSwitches,
  },
  {
    id: "F4",
    title: "Covered subjects nested",
    pitch:
      "Same rows as F1, ordered so containment is visible before it is read. Costs an indent level and puts the widest setting first.",
    render: F4NestedSubjects,
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
      <div className="bg-muted/40 space-y-3 rounded-lg border border-dashed p-4">
        <div className="space-y-1">
          <p className="text-sm leading-5 font-medium">
            One row per thing you can ask for
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            Threads, mentions and direct messages are separate rows and are
            chosen separately. Where one thing already carries another, the
            narrower row stays and reports its cover: every message in your
            rooms carries the mentions in those rooms, so that row says so
            rather than pretending to be independent. It can still be set{" "}
            <strong>louder</strong> than its cover, which is the combination
            worth having: every message in Sokosumi, a banner only when you are
            named.
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            A preset is a shortcut for the rows in a group, not a second
            setting. All four layouts edit the same preferences, so a change in
            one shows up in the others. Asking for a banner anywhere turns push
            on and requests the browser permission from that control. Push is
            currently {pushState}.
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            Marked <em>not stored yet</em>: threads you follow, every message in
            your rooms, every task update, every run status change, and the
            email channel. They are drawn so the covering rule can be judged
            with something to cover. What they change is remembered for this
            visit and not saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm leading-5 font-medium">Everything:</span>
          <PagePresets choices={choices} />
        </div>
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
