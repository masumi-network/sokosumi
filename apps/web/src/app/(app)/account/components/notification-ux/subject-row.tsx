"use client";

import { cn } from "@/lib/utils";
import { type SubjectChoice, subjectNote } from "./notification-model";

/**
 * One subject, one line, one control.
 *
 * Everything selectable in a group is a row like this and appears exactly once.
 * The round before this one drew a breadth ladder above the same subjects and
 * the panel said "mentions" twice, in two shapes, with two ways to change it.
 *
 * Containment is written under the name instead of being a second control: the
 * row for mentions stays where it was, still says what it is, and reports which
 * setting is already carrying it.
 */
export function SubjectRow({
  subject,
  control,
  indent = false,
}: {
  subject: SubjectChoice;
  control: React.ReactNode;
  indent?: boolean;
}) {
  const covered = subject.coveredBy !== null && !subject.louder;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5",
        indent && "pl-10",
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm leading-5",
            covered && "text-muted-foreground",
          )}
        >
          {subject.spec.label}
          {subject.stored ? null : (
            <span className="text-muted-foreground ml-2 text-xs whitespace-nowrap">
              not stored yet
            </span>
          )}
        </p>
        <p className="text-muted-foreground truncate text-sm leading-5">
          {subjectNote(subject)}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
