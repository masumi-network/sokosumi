"use client";

import { GroupSubjects } from "./group-body";
import { GroupPanel } from "./group-panel";
import { summaryLine } from "./group-summary";
import { LevelSegments } from "./level-controls";
import { ScopeSelect } from "./scope-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E3. No presets. Both questions are on the row, in the order they are asked.
 *
 * Nothing is hidden and nothing is named for the reader, so there is no preset
 * that has to be trusted or unpicked. The cost is real: two controls per group
 * is twice the decision, and a group with no ladder shows only one of them,
 * which makes the rows stop lining up.
 */
export function E3TwoLadders({ choices }: { choices: NotificationChoices }) {
  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          title={group.label}
          summary={summaryLine(group, choices)}
          control={
            <>
              <ScopeSelect group={group} choices={choices} />
              <LevelSegments group={group} choices={choices} />
            </>
          }
        >
          <GroupSubjects group={group} choices={choices} />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
