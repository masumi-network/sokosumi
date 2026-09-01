"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { LevelList } from "./level-controls";
import { PresetSegments } from "./preset-controls";
import { SubjectList } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * E5. The two ladders, spelled out, and no per-subject chips at all.
 *
 * Both questions are answered in prose with a sentence under every option, and
 * the fine control is simply gone. If the ladder is the right model, this is
 * the honest version of it: chat is one breadth and one delivery, not four
 * subjects with six switches.
 *
 * The thing to test is whether anything is missing. If nothing is, this is the
 * one to ship.
 */
export function E5TwoQuestions({ choices }: { choices: NotificationChoices }) {
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
          <GroupDetail
            group={group}
            choices={choices}
            levelControl={<LevelList group={group} choices={choices} />}
            subjects={false}
          />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}
