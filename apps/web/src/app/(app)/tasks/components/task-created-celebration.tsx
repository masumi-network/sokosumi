"use client";

import { ArrowRight, Check, Clock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { COLUMN_STATUS_COLORS } from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import { ConfettiBurst } from "@/components/ui/confetti-burst";
import { cn } from "@/lib/utils";

type CelebrationTaskStatus = "DRAFT" | "QUEUED" | "READY";

type CelebrationColumnId = "backlog" | "todo" | "celebration-scheduled";

/** Matches removed kanban `scheduled` column dot color for unchanged celebration UI. */
const CELEBRATION_SCHEDULED_DOT = "bg-primary";

interface TaskCreatedCelebrationProps {
  name: string;
  status: CelebrationTaskStatus;
  statusLabel: string;
  scheduleLabel?: string;
  labels: {
    taskCreated: string;
    taskCreatedHint?: string;
    goToTask: string;
    createAnother?: string;
  };
  onGoToTask: () => void;
  onCreateAnother?: () => void;
}

// A 3-column slice of the real kanban board (matching its column dot colors).
// A DRAFT task lands in "Backlog", READY in "To Do", QUEUED in "Scheduled".
const COLUMNS: Array<{ id: CelebrationColumnId; dot: string }> = [
  { id: "backlog", dot: COLUMN_STATUS_COLORS.backlog },
  { id: "todo", dot: COLUMN_STATUS_COLORS.todo },
  { id: "celebration-scheduled", dot: CELEBRATION_SCHEDULED_DOT },
];

const STATUS_COLUMN_INDEX: Record<CelebrationTaskStatus, number> = {
  DRAFT: 0,
  READY: 1,
  QUEUED: 2,
};

const STATUS_CARD_STYLES: Record<
  CelebrationTaskStatus,
  { badge: string; dot: string }
> = {
  DRAFT: {
    badge: "bg-muted text-muted-foreground",
    dot: "bg-gray-400",
  },
  READY: {
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: COLUMN_STATUS_COLORS.todo,
  },
  QUEUED: {
    badge: "bg-primary/10 text-primary",
    dot: CELEBRATION_SCHEDULED_DOT,
  },
};

export function TaskCreatedCelebration({
  name,
  status,
  statusLabel,
  scheduleLabel,
  labels,
  onGoToTask,
  onCreateAnother,
}: TaskCreatedCelebrationProps) {
  const reduceMotion = useReducedMotion();
  const targetIndex = STATUS_COLUMN_INDEX[status];
  const cardStyles = STATUS_CARD_STYLES[status];
  const isQueued = status === "QUEUED";
  const confettiLeft = `${((targetIndex + 0.5) / COLUMNS.length) * 100}%`;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6 py-10 text-center md:px-8">
      {/* Mini taskboard — the new task drops into its column */}
      <div className="relative w-full max-w-md">
        {/* Confetti over the landing column */}
        {reduceMotion ? null : (
          <ConfettiBurst
            className="pointer-events-none absolute top-10 z-10"
            style={{ left: confettiLeft }}
          />
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {COLUMNS.map((col, index) => {
            const isTarget = index === targetIndex;
            return (
              <div
                key={col.id}
                className="border-border/60 bg-muted/30 flex flex-col gap-2 rounded-xl border p-2"
              >
                {/* Column header */}
                <div className="flex items-center gap-1.5 px-0.5 pt-0.5">
                  <span className={cn("size-1.5 rounded-full", col.dot)} />
                  <span className="bg-muted-foreground/30 h-1.5 w-8 rounded-full" />
                </div>

                {isTarget ? (
                  <motion.div
                    className="border-border bg-background relative space-y-1.5 rounded-lg border p-2 text-left shadow-sm"
                    initial={
                      reduceMotion ? false : { y: -18, scale: 0.95, opacity: 0 }
                    }
                    animate={{ y: 0, scale: 1, opacity: 1 }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            type: "spring",
                            stiffness: 360,
                            damping: 22,
                            delay: 0.15,
                          }
                    }
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-medium",
                        cardStyles.badge,
                      )}
                    >
                      <span
                        className={cn(
                          "size-1 rounded-full",
                          cardStyles.dot,
                          isQueued && !reduceMotion && "animate-pulse",
                        )}
                      />
                      {statusLabel}
                    </span>
                    <p className="text-foreground line-clamp-2 text-[11px] leading-snug font-medium">
                      {name}
                    </p>
                    {isQueued && scheduleLabel ? (
                      <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-[9px] leading-none">
                        <Clock className="size-2.5 shrink-0" aria-hidden />
                        <span className="truncate">{scheduleLabel}</span>
                      </div>
                    ) : null}
                    {/* Settle highlight */}
                    {reduceMotion ? null : (
                      <motion.span
                        aria-hidden
                        className="ring-primary/50 pointer-events-none absolute inset-0 rounded-lg ring-2"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 0.9, delay: 0.3 }}
                      />
                    )}
                    {/* Status pop */}
                    <motion.span
                      aria-hidden
                      className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full shadow-sm"
                      initial={reduceMotion ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : {
                              type: "spring",
                              stiffness: 500,
                              damping: 18,
                              delay: 0.55,
                            }
                      }
                    >
                      {isQueued ? (
                        <Clock className="size-2.5" strokeWidth={2.5} />
                      ) : (
                        <Check className="size-2.5" strokeWidth={3} />
                      )}
                    </motion.span>
                  </motion.div>
                ) : (
                  <div className="border-border/40 bg-muted/40 space-y-1.5 rounded-lg border p-2 opacity-50">
                    <span className="bg-muted-foreground/30 block h-1 w-6 rounded-full" />
                    <span className="bg-muted-foreground/20 block h-1 w-full rounded-full" />
                  </div>
                )}

                {/* Faint card to give each column some weight */}
                <div className="border-border/40 bg-muted/30 space-y-1.5 rounded-lg border p-2 opacity-40">
                  <span className="bg-muted-foreground/30 block h-1 w-6 rounded-full" />
                  <span className="bg-muted-foreground/20 block h-1 w-3/4 rounded-full" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <motion.div
        className="space-y-2"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.6, duration: 0.4 }}
      >
        <h3 className="text-foreground text-lg font-semibold tracking-tight">
          {labels.taskCreated}
        </h3>
        {labels.taskCreatedHint ? (
          <p className="text-muted-foreground text-sm">
            {labels.taskCreatedHint}
          </p>
        ) : null}
      </motion.div>

      <motion.div
        className="flex w-full max-w-xs flex-col gap-2"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.68, duration: 0.4 }}
      >
        <Button type="button" className="w-full" onClick={onGoToTask}>
          {labels.goToTask}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        {onCreateAnother ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onCreateAnother}
          >
            {labels.createAnother}
          </Button>
        ) : null}
      </motion.div>
    </div>
  );
}
