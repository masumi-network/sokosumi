"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { PresetList } from "./preset-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E4. The closed row reports and never decides.
 *
 * Four lines, each with a reach meter and two channel icons: the page can be
 * read top to bottom without touching anything, and there is no small target to
 * hit by mistake. Inside, the presets come first and the ladders after, so the
 * quick answer is still the first thing offered.
 */
export function E4GlanceOnly({ choices }: { choices: NotificationChoices }) {
  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          title={group.label}
          summary={summaryLine(group, choices)}
          control={<GroupGlance group={group} choices={choices} />}
        >
          <GroupDetail
            group={group}
            choices={choices}
            header={<PresetList group={group} choices={choices} />}
          />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
