"use client";

import { Sparkles } from "lucide-react";

import type { CoworkerOption } from "@/lib/types/coworker";

interface AgentDetailProps {
  option: CoworkerOption;
  examplesTitle: string;
}

export function AgentDetail({ option, examplesTitle }: AgentDetailProps) {
  const examples = option.profile?.examples ?? [];
  const description = option.description;

  if (examples.length === 0 && !description) return null;

  const title = examplesTitle.replace("{name}", option.name);

  return (
    <div className="bg-muted/40 rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary size-4 shrink-0" aria-hidden />
        <p className="text-sm leading-tight font-medium">{title}</p>
      </div>

      {examples.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {examples.map((example) => (
            <li
              key={example}
              className="bg-background/70 text-foreground/80 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug"
            >
              <span
                className="bg-primary/60 mt-[5px] size-1.5 shrink-0 rounded-full"
                aria-hidden
              />
              <span>{example}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {description ? (
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          {description}
        </p>
      ) : null}
    </div>
  );
}
