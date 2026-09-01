"use client";

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupSubjects } from "./group-body";
import { GroupPanel } from "./group-panel";
import { GroupGlance, summaryLine } from "./group-summary";
import {
  type CategoryGroup,
  GROUP_LEVELS,
  type GroupLevel,
  LEVEL_COPY,
  PRESET_COPY,
} from "./notification-model";
import { SubjectList } from "./subject-list";
import { type NotificationChoices } from "./use-notification-choices";

/**
 * E8. One menu, two headed sections: what, then where.
 *
 * Both questions are in one place, each answer is a full phrase, and the row
 * carries a single control however deep the ladder gets. It is also the only
 * layout where nothing is decidable without opening a menu first, and where the
 * two questions are invisible until then.
 */
export function E8OneMenu({ choices }: { choices: NotificationChoices }) {
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
              <BothMenu group={group} choices={choices} />
            </>
          }
        >
          <GroupSubjects group={group} choices={choices} />
        </GroupPanel>
      ))}
    </SubjectList>
  );
}

function BothMenu({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  const preset = choices.groupPreset(group);
  const scope = choices.groupScope(group);
  const level = choices.groupLevel(group);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${group.label} notifications`}
        className="border-input hover:bg-accent focus-visible:ring-ring/50 data-[state=open]:bg-accent inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-[3px]"
      >
        {PRESET_COPY[preset].label}
        <ChevronDown className="size-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {group.rungs.length > 1 ? (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-xs tracking-wide uppercase">
              What to tell you about
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(scope)}
              onValueChange={(next) => {
                void choices.setGroupScope(group, Number(next));
              }}
            >
              {group.rungs.map((rung, index) => (
                <DropdownMenuRadioItem key={rung.id} value={String(index)}>
                  {rung.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-muted-foreground text-xs tracking-wide uppercase">
          Where it arrives
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={level}
          onValueChange={(next) => {
            void choices.setGroupLevel(group, next as GroupLevel);
          }}
        >
          {GROUP_LEVELS.map((candidate) => (
            <DropdownMenuRadioItem key={candidate} value={candidate}>
              {LEVEL_COPY[candidate].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
