"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export interface TaskboardVisualProps {
  avatarAlt: string;
  avatarUrl: string;
  coworkerName: string;
  taskTitle: string;
  todoLabel: string;
  inProgressLabel: string;
}

export function TaskboardVisual({
  avatarAlt,
  avatarUrl,
  coworkerName,
  taskTitle,
  todoLabel,
  inProgressLabel,
}: TaskboardVisualProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const taskCard = (
    <div className="bg-background rounded-md border p-2.5 shadow-sm">
      <p className="text-[0.6875rem] font-medium">{taskTitle}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="relative size-4 overflow-hidden rounded-full">
          <Image
            src={avatarUrl}
            alt={avatarAlt}
            fill
            className="object-cover"
          />
        </div>
        <span className="text-muted-foreground text-[0.625rem]">
          {coworkerName}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-[280px] justify-center gap-3">
        <div className="flex-1">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="bg-muted-foreground/40 size-1.5 rounded-full" />
            <span className="text-muted-foreground text-[0.625rem] font-medium tracking-wider uppercase">
              {todoLabel}
            </span>
          </div>
          <div className="border-border/50 min-h-[100px] rounded-lg border border-dashed p-1.5">
            <div
              className={`transition-all duration-700 ${
                phase >= 1 && phase < 2
                  ? "translate-y-0 opacity-100"
                  : phase >= 2
                    ? "-translate-y-1 opacity-0"
                    : "translate-y-2 opacity-0"
              }`}
            >
              {taskCard}
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="mb-2.5 flex items-center gap-1.5">
            <span className="bg-primary size-1.5 rounded-full" />
            <span className="text-muted-foreground text-[0.625rem] font-medium tracking-wider uppercase">
              {inProgressLabel}
            </span>
          </div>
          <div className="border-border/50 min-h-[100px] rounded-lg border border-dashed p-1.5">
            <div
              className={`transition-all duration-700 ${
                phase >= 2
                  ? "translate-x-0 opacity-100"
                  : "-translate-x-2 opacity-0"
              }`}
            >
              {taskCard}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
