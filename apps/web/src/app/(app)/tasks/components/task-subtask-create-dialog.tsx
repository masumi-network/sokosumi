"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskAssigneePicker } from "./task-assignee-picker";
import type { NewSubtaskDraft } from "./use-task-subtasks";

interface TaskSubtaskCreateDialogProps {
  assigneeOptions: CoworkerOption[];
  /** Resolves true when the dialog may close. */
  onSubmit: (draft: NewSubtaskDraft) => boolean | Promise<boolean>;
  onClose: () => void;
  /** Where focus goes on close; Radix's default is the opening element. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Asks for a new sub-task's name, and optionally a description, an assignee
 * and a due date.
 * Mount it only while open, so every opening starts empty.
 */
export function TaskSubtaskCreateDialog({
  assigneeOptions,
  onSubmit,
  onClose,
  onCloseAutoFocus,
}: TaskSubtaskCreateDialogProps) {
  const t = useTranslations("App.Tasks.Subtasks");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const nameId = useId();
  const descriptionId = useId();
  const assigneeFieldId = useId();
  const dueId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isPending) return;
    const draft: NewSubtaskDraft = {
      name: trimmed,
      description: description.trim() || null,
      assignee:
        assigneeOptions.find((option) => option.id === assigneeId) ?? null,
      dueOn: dueOn || null,
    };
    startTransition(async () => {
      if (await onSubmit(draft)) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          onSubmit={handleSubmit}
          className="flex max-h-[calc(100dvh-5rem)] flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>
          {/* Only the fields scroll. The assignee list portals into the
              dialog itself, so this overflow cannot clip it. The padding
              keeps focus rings inside the scroll area. */}
          <div className="-mx-1 min-h-0 space-y-4 overflow-y-auto px-1 py-1">
            <div className="space-y-2">
              <Label htmlFor={nameId}>{t("name")}</Label>
              <Input
                id={nameId}
                required
                autoFocus
                autoComplete="off"
                className="read-only:opacity-70"
                // readOnly, not disabled: a disabled field drops focus.
                readOnly={isPending}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={descriptionId}>{t("description")}</Label>
              <Textarea
                id={descriptionId}
                className="min-h-24 max-h-60 read-only:opacity-70"
                readOnly={isPending}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={assigneeFieldId}>{t("assignee")}</Label>
              <TaskAssigneePicker
                id={assigneeFieldId}
                value={assigneeId}
                options={assigneeOptions}
                labels={{
                  ariaLabel: t("assignee"),
                  unassigned: tNewTask("unassigned"),
                  unavailableAssignee: tNewTask("unavailableAssignee"),
                  searchPlaceholder: tNewTask("changeCoworker"),
                  noResults: tNewTask("noCoworkerMatches"),
                  agentsGroupLabel: tNewTask("coworker"),
                }}
                onSelect={setAssigneeId}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={dueId}>{t("dueOn")}</Label>
              <Input
                id={dueId}
                type="date"
                className="read-only:opacity-70"
                readOnly={isPending}
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={isPending}>
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
