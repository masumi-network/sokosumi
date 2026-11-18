"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { resolveTaskAssigneeFields } from "@/app/tasks/utils/coworker-options";
import type { AssigneePeopleLock } from "@/app/tasks/utils/task-property-options";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setTaskAssignee } from "@/lib/actions/task/property-action";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

import { AssigneeAvatar } from "./task-assignee-picker";
import { ROW_TRIGGER_CLASS } from "./task-status-picker";

const UNASSIGNED_VALUE = "__unassigned__";

interface TaskMetadataAssigneeFieldProps {
  taskId: string;
  /** Current assignee option id, or "" when unassigned. */
  assigneeId: string;
  /** Includes the current assignee even when it left the live list. */
  options: CoworkerOption[];
  peopleLock: AssigneePeopleLock;
  labels: { assignee: string; noAssignee: string };
}

export function TaskMetadataAssigneeField({
  taskId,
  assigneeId,
  options,
  peopleLock,
  labels,
}: TaskMetadataAssigneeFieldProps) {
  const t = useTranslations("App.Tasks.Detail.assigneeField");
  // Shows the pick until the action's revalidation lands, and falls back to
  // the server value by itself when the action fails.
  const [current, setCurrent] = useOptimistic(assigneeId);
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const [isPending, startTransition] = useTransition();

  const selected = options.find((option) => option.id === current) ?? null;
  const members = options.filter((option) => option.kind === "user");
  const agents = options.filter((option) => option.kind !== "user");
  const displayName = selected?.name ?? labels.noAssignee;
  const ariaLabel = `${labels.assignee}: ${displayName}`;

  function handleSelect(next: string) {
    setOpen(false);
    if (next === current) return;

    startTransition(async () => {
      setCurrent(next);
      try {
        const result = await setTaskAssignee({
          taskId,
          ...resolveTaskAssigneeFields(next, options),
        });
        if (!result.ok) {
          toast.error(t("updateError"));
        }
      } catch (error) {
        console.error("Failed to update task assignee", error);
        toast.error(t("updateError"));
      }
    });
  }

  function renderOption(option: CoworkerOption) {
    const isCurrent = option.id === current;
    return (
      <CommandItem
        key={option.id}
        value={option.id}
        keywords={[option.name, option.caption ?? ""]}
        disabled={peopleLock !== null && option.kind === "user"}
        data-current={isCurrent || undefined}
        onSelect={() => handleSelect(option.id)}
      >
        <span aria-hidden>
          <AssigneeAvatar option={option} size="row" />
        </span>
        <span className="flex-1 truncate">{option.name}</span>
        {isCurrent ? <Check className="size-4" aria-hidden /> : null}
      </CommandItem>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next && !isPending)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-expanded={open}
              aria-label={ariaLabel}
              aria-disabled={isPending || undefined}
              className={cn(
                "focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed",
                ROW_TRIGGER_CLASS,
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <AssigneeAvatar option={selected} size="compact" />
              </span>
              <span
                className={cn("truncate", !selected && "text-muted-foreground")}
              >
                {displayName}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">{ariaLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput
            autoFocus
            hideIcon
            placeholder={t("change")}
            aria-describedby={peopleLock ? hintId : undefined}
          />
          <CommandList className="touch-pan-y p-1">
            <CommandEmpty>{t("noMatches")}</CommandEmpty>
            <CommandItem
              value={UNASSIGNED_VALUE}
              keywords={[labels.noAssignee]}
              disabled={peopleLock === "agentRequired"}
              data-current={current === "" || undefined}
              onSelect={() => handleSelect("")}
            >
              <span aria-hidden>
                <AssigneeAvatar option={null} size="row" />
              </span>
              <span className="flex-1 truncate">{labels.noAssignee}</span>
              {current === "" ? <Check className="size-4" aria-hidden /> : null}
            </CommandItem>
            {members.length > 0 ? (
              <CommandGroup heading={t("membersGroup")}>
                {members.map(renderOption)}
              </CommandGroup>
            ) : null}
            {agents.length > 0 ? (
              <CommandGroup heading={t("agentsGroup")}>
                {agents.map(renderOption)}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        {peopleLock ? (
          <p
            id={hintId}
            className="text-muted-foreground border-t px-3 py-2 text-xs text-pretty"
          >
            {t(peopleLock === "private" ? "privateHint" : "agentRequiredHint")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
