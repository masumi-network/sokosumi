"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface TaskProjectSelectLabels {
  projectLabel: string;
  noneLabel: string;
  searchPlaceholder: string;
  emptyResults: string;
  placeholder?: string;
  projectCreate?: string;
  projectCreateNamed?: string;
}

interface TaskProjectSelectProps extends TaskProjectSelectLabels {
  projectOptions: ProjectFilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  onCreateProject?: (searchQuery: string) => void;
}

const NO_PROJECT_VALUE = "__no_project__";

export function TaskProjectSelect({
  projectOptions,
  value,
  onChange,
  projectLabel,
  noneLabel,
  searchPlaceholder,
  emptyResults,
  placeholder,
  projectCreate,
  projectCreateNamed,
  onCreateProject,
}: TaskProjectSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedProject = useMemo(
    () => projectOptions.find((project) => project.id === value) ?? null,
    [projectOptions, value],
  );
  const optionItems = useMemo(() => {
    if (!value || selectedProject) {
      return projectOptions;
    }

    return [{ id: value, name: value }, ...projectOptions];
  }, [projectOptions, selectedProject, value]);
  const selectedLabel =
    selectedProject?.name ?? (value ? value : (placeholder ?? noneLabel));

  function handleSelect(projectId: string | null) {
    onChange(projectId);
    setOpen(false);
  }

  function handleCreateProject() {
    if (!onCreateProject) return;
    const trimmedQuery = search.trim();
    onCreateProject(trimmedQuery);
    setOpen(false);
  }

  const createLabel = search.trim()
    ? projectCreateNamed?.replace("{name}", search.trim())
    : projectCreate;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={projectLabel}
          className="w-full justify-between gap-2"
        >
          <span
            className={cn(
              "truncate",
              value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selectedLabel}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command className="**:data-[slot=command-list]:max-h-72" shouldFilter>
          <CommandInput
            autoFocus
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyResults}</CommandEmpty>
            <CommandItem
              value={NO_PROJECT_VALUE}
              keywords={[noneLabel]}
              onSelect={() => handleSelect(null)}
            >
              <span className="flex-1 truncate">{noneLabel}</span>
              <Check
                className={cn(
                  "size-4",
                  value === null ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
            </CommandItem>
            {optionItems.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                keywords={[project.name]}
                onSelect={() => handleSelect(project.id)}
              >
                <span className="flex-1 truncate">{project.name}</span>
                <Check
                  className={cn(
                    "size-4",
                    project.id === value ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
              </CommandItem>
            ))}
            {onCreateProject && createLabel ? (
              <CommandItem
                forceMount
                value="__create_project__"
                keywords={[createLabel]}
                onSelect={handleCreateProject}
              >
                <span className="flex-1 truncate">{createLabel}</span>
              </CommandItem>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
