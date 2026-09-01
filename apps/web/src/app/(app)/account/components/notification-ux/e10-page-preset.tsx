"use client";

import { GroupDetail } from "./group-detail";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import { PRESET_COPY } from "./notification-model";
import { PagePresets, PresetSegments } from "./preset-controls";
import { SubjectList } from "./subject-list";
import { type NotificationChoices } from "./use-notification-choices";

/**
 * E10. One answer for everything, then the groups that disagree with it.
 *
 * The same four words at both levels, so nothing new is learned to use the top
 * row. A reader who wants the same thing everywhere presses once and leaves;
 * everyone else treats the groups below as exceptions. The cost is two ways to
 * say one thing, and a page control that goes custom as soon as any group
 * differs, which for most accounts is immediately.
 */
export function E10PagePreset({ choices }: { choices: NotificationChoices }) {
  const groups = useOpenGroups();
  const active = choices.pagePreset();

  return (
    <div className="space-y-3">
      <div className="bg-card flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm leading-5 font-medium">Everything</p>
          <p className="text-muted-foreground text-sm leading-6">
            {active === "CUSTOM"
              ? "Set per group, below."
              : PRESET_COPY[active].hint}
          </p>
        </div>
        <PagePresets choices={choices} />
      </div>

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
    </div>
  );
}
