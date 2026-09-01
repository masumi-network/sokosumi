"use client";

import { DeliverySegments } from "./delivery-controls";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance } from "./group-summary";
import { groupSummary } from "./notification-model";
import { PresetSegments } from "./preset-controls";
import { SubjectRow } from "./subject-row";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * One row per subject, one three-stop control per row.
 *
 * The preset on the closed row is a shortcut for the rows inside, never a
 * second setting: pressing "Important" writes every row, and changing any row
 * afterwards turns the preset custom. Nothing is named in two places.
 */
export function F1SubjectStops({ choices }: { choices: NotificationChoices }) {
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
              <PresetSegments
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
                control={
                  <DeliverySegments subject={subject} choices={choices} />
                }
              />
            ))}
          </div>
        </GroupPanel>
      ))}
    </div>
  );
}
