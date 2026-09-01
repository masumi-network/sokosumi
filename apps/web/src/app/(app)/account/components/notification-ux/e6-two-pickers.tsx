"use client";

import { GroupSubjects } from "./group-body";
import { GroupPanel } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { LevelSelect } from "./level-controls";
import { ScopeSelect } from "./scope-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E6. E3 with both questions as pickers instead of stops.
 *
 * The row keeps its width whatever the labels grow into, which is what happens
 * to "Every message in your rooms" in German. The choices are two clicks away
 * rather than on the surface, so comparing two groups means opening two menus.
 */
export function E6TwoPickers({ choices }: { choices: NotificationChoices }) {
  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          title={group.label}
          summary={summaryLine(group, choices)}
          control={
            <>
              <GroupGlance group={group} choices={choices} />
              <ScopeSelect group={group} choices={choices} />
              <LevelSelect group={group} choices={choices} />
            </>
          }
        >
          <GroupSubjects group={group} choices={choices} />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
