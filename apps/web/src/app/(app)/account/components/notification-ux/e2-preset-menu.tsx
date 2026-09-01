"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { PresetMenu } from "./preset-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E2. D3 grown a second question.
 *
 * One menu holds both tiers: the presets, then the way into the two ladders.
 * Each preset says what it means for this group, which a stop on a row has no
 * room for. The row itself stays the quietest here: a name, a sentence, a
 * glance, one small control.
 */
export function E2PresetMenu({ choices }: { choices: NotificationChoices }) {
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
          hideChevron
          control={
            <>
              <GroupGlance group={group} choices={choices} />
              <PresetMenu
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
