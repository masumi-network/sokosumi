"use client";

import { DeliveryMenu } from "./delivery-controls";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance } from "./group-summary";
import { groupSummary } from "./notification-model";
import { PresetMenu } from "./preset-controls";
import { SubjectRow } from "./subject-row";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * The same rows, with channels you tick instead of a loudness you slide.
 *
 * Worth comparing against F1 because email is not louder than a banner, it is
 * elsewhere. If email ever sends, this shape already has a place to put it and
 * the three stops do not.
 */
export function F2SubjectChannels({
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
              <PresetMenu
                group={group}
                choices={choices}
                onCustom={() => open.setOpen(group.id, true)}
              />
            </>
          }
        >
          <div className="divide-y">
            {group.subjects.map((subject) => (
              <SubjectRow
                key={subject.spec.id}
                subject={subject}
                control={<DeliveryMenu subject={subject} choices={choices} />}
              />
            ))}
          </div>
        </GroupPanel>
      ))}
    </div>
  );
}
