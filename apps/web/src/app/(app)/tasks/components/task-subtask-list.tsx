"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/core-client";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { taskHref } from "@/app/tasks/utils/task-href";
import {
  isAgentSubtask,
  SUBTASK_LIST_LIMIT,
  type SubtaskRow,
} from "@/app/tasks/utils/task-subtask-row";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { moveIdToSlot } from "@/lib/utils/move-id";
import { AssigneeAvatar } from "./assignee-avatar";
import { TaskDetailLink } from "./task-detail-link";
import { TaskDueBadge } from "./task-due-badge";
import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskSubtaskProgress } from "./task-subtask-progress";
import { useTaskSubtasks } from "./use-task-subtasks";

interface TaskSubtaskListProps {
  parentTaskId: string;
  initialRows: SubtaskRow[];
  readOnly: boolean;
}

/**
 * A Task's sub-tasks as an ordered checklist. Drag a row by its handle, or
 * focus the handle and press Arrow Up or Down (Alt+Arrow anywhere in the
 * row) to move it.
 */
export function TaskSubtaskList({
  parentTaskId,
  initialRows,
  readOnly,
}: TaskSubtaskListProps) {
  const t = useTranslations("App.Tasks.Subtasks");
  const tTasks = useTranslations("App.Tasks");
  const { rows, setStatus, move, add } = useTaskSubtasks({
    parentTaskId,
    initialRows,
    personalAssistantFallback: tTasks("personalAssistant"),
    onError: () => toast.error(t("changeError")),
  });
  const [draftName, setDraftName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [reopening, setReopening] = useState<SubtaskRow | null>(null);
  const [reopenComment, setReopenComment] = useState("");
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const ids = rows.map((row) => row.id);
  const completed = rows.filter(
    (row) => row.status === TaskStatus.COMPLETED,
  ).length;

  function moveTo(id: string, next: string[]) {
    if (next === ids) return;
    move(id, next);
    setAnnouncement(
      t("movedTo", { position: next.indexOf(id) + 1, total: next.length }),
    );
    // React moves the row's node, which can drop focus on the way.
    requestAnimationFrame(() => handles.current.get(id)?.focus());
  }

  function moveBy(id: string, step: -1 | 1) {
    const neighbour = ids[ids.indexOf(id) + step];
    if (neighbour) moveTo(id, moveIdToSlot(ids, id, neighbour));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const id = String(active.id);
    moveTo(id, moveIdToSlot(ids, id, String(over.id)));
  }

  function toggle(row: SubtaskRow) {
    if (row.status !== TaskStatus.COMPLETED) {
      setStatus(row.id, TaskStatus.COMPLETED);
    } else if (isAgentSubtask(row)) {
      // Its Coworker or Soko Bot would run again: ask what to fix first.
      setReopenComment("");
      setReopening(row);
    } else {
      setStatus(row.id, TaskStatus.READY);
    }
  }

  function closeReopen(target?: typeof TaskStatus.READY | "DRAFT") {
    if (reopening && target) {
      setStatus(
        reopening.id,
        target === "DRAFT" ? TaskStatus.DRAFT : TaskStatus.READY,
        target === "DRAFT" ? undefined : reopenComment.trim(),
      );
    }
    setReopening(null);
    setReopenComment("");
  }

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    add(name);
    setDraftName("");
  }

  return (
    <section className="space-y-2" aria-labelledby="task-subtasks-title">
      <div className="flex items-center gap-2">
        <h2
          id="task-subtasks-title"
          className="text-muted-foreground text-xs font-medium"
        >
          {t("title")}
        </h2>
        <TaskSubtaskProgress progress={{ completed, total: rows.length }} />
      </div>
      {rows.length > 0 ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <ol className="space-y-0.5">
            {rows.map((row, index) => (
              <SubtaskItem
                key={row.id}
                row={row}
                readOnly={readOnly}
                onToggle={() => toggle(row)}
                onMoveUp={index > 0 ? () => moveBy(row.id, -1) : undefined}
                onMoveDown={
                  index < rows.length - 1 ? () => moveBy(row.id, 1) : undefined
                }
                handleRef={(node) => {
                  if (node) handles.current.set(row.id, node);
                  else handles.current.delete(row.id);
                }}
              />
            ))}
          </ol>
        </DndContext>
      ) : null}
      {rows.length >= SUBTASK_LIST_LIMIT ? (
        <p className="text-muted-foreground text-xs">
          {t("truncated", { count: SUBTASK_LIST_LIMIT })}
        </p>
      ) : null}
      {readOnly ? null : (
        <form onSubmit={handleAdd}>
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={t("addPlaceholder")}
            aria-label={t("add")}
            className="h-8 text-sm"
          />
        </form>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <TaskReopenToReadyDialog
        open={reopening !== null}
        onOpenChange={(open) => {
          if (!open) closeReopen();
        }}
        assigneeName={reopening?.assignee?.name ?? ""}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={() => closeReopen(TaskStatus.READY)}
        onReopenAsDraft={() => closeReopen("DRAFT")}
      />
    </section>
  );
}

interface SubtaskItemProps {
  row: SubtaskRow;
  readOnly: boolean;
  onToggle: () => void;
  /** Absent on the first / last row. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  handleRef: (node: HTMLButtonElement | null) => void;
}

function SubtaskItem({
  row,
  readOnly,
  onToggle,
  onMoveUp,
  onMoveDown,
  handleRef,
}: SubtaskItemProps) {
  const t = useTranslations("App.Tasks.Subtasks");
  const locked = readOnly || row.isPending === true;
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    disabled: locked,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: row.id,
    disabled: locked,
  });
  const done = row.status === TaskStatus.COMPLETED;
  const agentName =
    row.assignee && isAgentSubtask(row) ? row.assignee.name : null;

  function moveFor(event: KeyboardEvent, needsAlt: boolean) {
    if (needsAlt && !event.altKey) return;
    const move =
      event.key === "ArrowUp"
        ? onMoveUp
        : event.key === "ArrowDown"
          ? onMoveDown
          : undefined;
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  }

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      style={
        transform
          ? { transform: `translate3d(0, ${Math.round(transform.y)}px, 0)` }
          : undefined
      }
      onKeyDown={locked ? undefined : (event) => moveFor(event, true)}
      aria-busy={row.isPending || undefined}
      className={cn(
        "hover:bg-quinary flex min-h-9 items-center gap-2 rounded-md px-1",
        isDragging && "bg-background relative z-10 shadow-md",
        isOver && !isDragging && "bg-quinary",
        row.isPending && "opacity-60",
      )}
    >
      {readOnly ? null : (
        <button
          ref={handleRef}
          type="button"
          {...listeners}
          disabled={locked}
          onKeyDown={(event) => moveFor(event, false)}
          aria-label={t("reorderHandle", { name: row.name })}
          className={cn(
            "text-muted-foreground hover:text-foreground focus-visible:ring-ring relative flex size-6 shrink-0 touch-none items-center justify-center rounded-sm outline-hidden after:absolute after:-inset-2 focus-visible:ring-2 disabled:opacity-50",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}
      <Checkbox
        checked={done}
        disabled={locked}
        onCheckedChange={onToggle}
        aria-label={t("toggleLabel", { name: row.name })}
        title={
          done && agentName
            ? t("agentDoneHint", { assignee: agentName })
            : undefined
        }
      />
      {row.identifier ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {row.identifier}
        </span>
      ) : null}
      {row.isPending ? (
        <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
      ) : (
        <TaskDetailLink
          href={taskHref(row)}
          title={row.name}
          className={cn(
            "min-w-0 flex-1 truncate text-sm hover:underline",
            done && "text-muted-foreground line-through",
          )}
        >
          {row.name}
        </TaskDetailLink>
      )}
      <TaskSubtaskProgress progress={row.subtaskProgress} />
      {row.dueOn ? (
        <TaskDueBadge dueOn={row.dueOn} status={row.status} />
      ) : null}
      {row.assignee ? <AssigneeAvatar assignee={row.assignee} /> : null}
    </li>
  );
}
