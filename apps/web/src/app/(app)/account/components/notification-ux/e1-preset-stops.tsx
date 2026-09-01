"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { PresetSegments } from "./preset-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E1. D1 grown a second question.
 *
 * The stops are now presets over both ladders rather than delivery alone, so
 * "Everything" for chat means every message in your rooms and a banner, and one
 * press still settles the group. The glance on the right says how far the
 * breadth reaches and where it lands, which is the part a word cannot carry.
 */
export function E1PresetStops({ choices }: { choices: NotificationChoices }) {
  const groups = useOpenGroups();

  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          open={groups.isOpen(group.id)}
          onOpenChange={(next) => groups.setOpen(group.id, next)}
          title={group.label}
          summary={summaryLine(group, choices)}
          control={
            <>
              <GroupGlance group={group} choices={choices} />
              <PresetSegments
                group={group}
                choices={choices}
                onCustom={() => groups.setOpen(group.id, true)}
              />
            </>
          }
        >
          <GroupDetail group={group} choices={choices} />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
