"use client";

import { DeliverySwitch } from "./delivery-controls";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance } from "./group-summary";
import { groupSummary } from "./notification-model";
import { PresetChips } from "./preset-controls";
import { SubjectRow } from "./subject-row";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * A switch per subject, and the banner only after the switch is on.
 *
 * The plainest of the four: a reader who never wants a banner never meets that
 * control. The cost is that the banner appears and disappears as rows are
 * turned on, so the column of controls moves while you use it.
 */
export function F3SubjectSwitches({
  choices,
}: {
  choices: NotificationChoices;
}) {
  const open = useOpenGroups();

  return (
    <div className="divide-y rounded-lg border">
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          open={open.isOpen(group.id)}
          onOpenChange={(next) => open.setOpen(group.id, next)}
          title={group.label}
          summary={groupSummary(group)}
          control={
            <>
              <GroupGlance group={group} />
              <PresetChips group={group} choices={choices} />
            </>
          }
        >
          <div className="divide-y">
            {group.subjects.map((subject) => (
              <SubjectRow
                key={subject.spec.id}
                subject={subject}
                control={<DeliverySwitch subject={subject} choices={choices} />}
              />
            ))}
          </div>
        </GroupPanel>
      ))}
    </div>
  );
}
