"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { PresetChips } from "./preset-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E7. The presets sit under the title at every width, as chips that wrap.
 *
 * A row of stops has to fit; a row of chips does not, so the fourth one drops
 * to a second line instead of squeezing the other three. That makes this the
 * only layout with room to grow a fifth preset, and the tallest of the ten.
 */
export function E7PresetChips({ choices }: { choices: NotificationChoices }) {
  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          stack
          title={group.label}
          summary={
            <span className="flex items-center gap-3">
              <span className="truncate">{summaryLine(group, choices)}</span>
              <GroupGlance group={group} choices={choices} />
            </span>
          }
          control={<PresetChips group={group} choices={choices} />}
        >
          <GroupDetail group={group} choices={choices} />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
