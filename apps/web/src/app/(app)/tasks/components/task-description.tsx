import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { parseMentions } from "@/lib/utils/mention-parser";

interface TaskDescriptionProps {
  title: string;
  description?: string | null;
  // Map keeps mention lookups O(1) while parsing.
  agentNameById?: Map<string, string>;
}

function renderDescription(
  description: string,
  agentNameById: Map<string, string>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const matches = parseMentions(description);
  let lastIndex = 0;

  for (const match of matches) {
    const matchIndex = match.start;

    if (matchIndex > lastIndex) {
      nodes.push(
        <Fragment key={`text-${lastIndex}-${matchIndex}`}>
          {description.slice(lastIndex, matchIndex)}
        </Fragment>,
      );
    }
    const directName = agentNameById.get(match.id);
    const resolvedId = directName !== undefined ? match.id : null;
    const agentName = resolvedId ? agentNameById.get(resolvedId) : undefined;

    if (resolvedId && agentName) {
      nodes.push(
        <Link
          key={`${resolvedId}-${matchIndex}`}
          href={`/agents/${resolvedId}/jobs`}
          className="text-primary font-medium hover:underline"
        >
          @{agentName}
        </Link>,
      );
    } else {
      nodes.push(
        <Fragment key={`text-${match.start}-${match.end}`}>
          {description.slice(match.start, match.end)}
        </Fragment>,
      );
    }

    lastIndex = match.end;
  }

  if (lastIndex < description.length) {
    nodes.push(
      <Fragment key={`text-${lastIndex}-${description.length}`}>
        {description.slice(lastIndex)}
      </Fragment>,
    );
  }

  return nodes;
}

export function TaskDescription({
  title,
  description,
  agentNameById = new Map<string, string>(),
}: TaskDescriptionProps) {
  const content = description
    ? renderDescription(description, agentNameById)
    : "—";

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm leading-6">{content}</p>
    </div>
  );
}
