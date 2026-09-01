"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GroupSubjects } from "./group-body";
import { GroupGlance } from "./group-summary";
import { LevelList } from "./level-controls";
import { type CategoryGroup, LEVEL_COPY } from "./notification-model";
import { ScopeLadder } from "./scope-controls";
import { SubjectList } from "./subject-list";
import { type NotificationChoices } from "./use-notification-choices";

const WORD =
  "text-primary decoration-primary/40 focus-visible:ring-ring/50 inline-flex items-center rounded-md font-medium underline decoration-dashed underline-offset-4 outline-none focus-visible:ring-[3px]";

/**
 * E9. The row is a sentence, and the two answers inside it are the controls.
 *
 * "Tell me about mentions of you, in Sokosumi and a banner." Reading the
 * setting and changing it are the same act, and the containment reads as
 * grammar rather than as a diagram. The risk is that an underlined word is a
 * weaker invitation than a button, so a reader may never notice it is one.
 *
 * The sentence cannot sit inside the row that opens the group: a button holding
 * two buttons is not a thing a browser can do. So this layout builds its own
 * row, with the chevron as a control of its own.
 */
export function E9EditableSentence({
  choices,
}: {
  choices: NotificationChoices;
}) {
  return (
    <SubjectList>
      {choices.groups.map((group) => (
        <Collapsible key={group.id}>
          <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm leading-5 font-medium">
                {group.label}
              </p>
              <Sentence group={group} choices={choices} />
            </div>
            <div className="flex shrink-0 items-center gap-3 sm:pt-1">
              <GroupGlance group={group} choices={choices} />
              <CollapsibleTrigger
                aria-label={`${group.label}, set each subject`}
                className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -m-1 rounded-md p-1 outline-none focus-visible:ring-[3px]"
              >
                <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
              </CollapsibleTrigger>
            </div>
          </div>
          <CollapsibleContent>
            <div className="bg-muted/20 border-t">
              <GroupSubjects group={group} choices={choices} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </SubjectList>
  );
}

function Sentence({
  group,
  choices,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
}) {
  const [open, setOpen] = useState<"what" | "where" | null>(null);
  const rung = group.rungs[choices.groupScope(group)];

  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm leading-6">
      Tell me about
      {group.rungs.length > 1 ? (
        <Popover
          open={open === "what"}
          onOpenChange={(next) => setOpen(next ? "what" : null)}
        >
          <PopoverTrigger className={WORD}>
            {rung?.label ?? group.label}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <ScopeLadder group={group} choices={choices} />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="text-foreground font-medium">
          {rung?.label ?? group.label}
        </span>
      )}
      <Popover
        open={open === "where"}
        onOpenChange={(next) => setOpen(next ? "where" : null)}
      >
        <PopoverTrigger className={WORD}>
          {LEVEL_COPY[choices.groupLevel(group)].inline}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <LevelList group={group} choices={choices} />
        </PopoverContent>
      </Popover>
    </p>
  );
}
