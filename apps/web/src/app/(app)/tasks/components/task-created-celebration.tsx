"use client";

import { ArrowRight, Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TaskCreatedCelebrationProps {
  name: string;
  status: "DRAFT" | "READY";
  statusLabel: string;
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
// A new READY task lands in "To Do", a DRAFT in "Backlog".
const COLUMNS = [
  { id: "backlog", dot: "bg-muted-foreground" },
  { id: "todo", dot: "bg-blue-500" },
  { id: "in-progress", dot: "bg-amber-500" },
];

// Small confetti burst over the landing column — deterministic (no hydration jitter).
const CONFETTI = [
  { x: -34, y: -30, c: "#6400FF", s: 6 },
  { x: -14, y: -44, c: "#00a4fa", s: 5 },
  { x: 10, y: -46, c: "#fa008c", s: 6 },
  { x: 30, y: -34, c: "#ffd300", s: 5 },
  { x: -40, y: -8, c: "#0afa14", s: 5 },
  { x: 40, y: -10, c: "#ff6400", s: 6 },
  { x: -22, y: -52, c: "#6400FF", s: 4 },
  { x: 22, y: -52, c: "#00a4fa", s: 4 },
  { x: 0, y: -56, c: "#fa008c", s: 5 },
];

export function TaskCreatedCelebration({
  name,
  status,
  statusLabel,
  labels,
  onGoToTask,
  onCreateAnother,
}: TaskCreatedCelebrationProps) {
  const reduceMotion = useReducedMotion();
  const targetIndex = status === "DRAFT" ? 0 : 1;
  const cardDot = status === "DRAFT" ? "bg-gray-400" : "bg-blue-500";
  const cardBadge =
    status === "DRAFT"
      ? "bg-muted text-muted-foreground"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  const confettiLeft = `${((targetIndex + 0.5) / COLUMNS.length) * 100}%`;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6 py-10 text-center md:px-8">
      {/* Mini taskboard — the new task drops into its column */}
      <div className="relative w-full max-w-md">
        {/* Confetti over the landing column */}
        {reduceMotion ? null : (
          <div
            aria-hidden
            className="pointer-events-none absolute top-10 z-10"
            style={{ left: confettiLeft }}
          >
            {CONFETTI.map((p) => (
              <motion.span
                key={`${p.c}-${p.x}-${p.y}`}
                className="absolute rounded-[2px]"
                style={{ width: p.s, height: p.s, backgroundColor: p.c }}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  x: p.x,
                  y: p.y,
                  scale: [0, 1, 1, 0.5],
                }}
                transition={{ duration: 0.8, delay: 0.42, ease: "easeOut" }}
              />
            ))}
          </div>
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
                        cardBadge,
                      )}
                    >
                      <span className={cn("size-1 rounded-full", cardDot)} />
                      {statusLabel}
                    </span>
                    <p className="text-foreground line-clamp-2 text-[11px] leading-snug font-medium">
                      {name}
                    </p>
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
                    {/* Check pop */}
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
                      <Check className="size-2.5" strokeWidth={3} />
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
