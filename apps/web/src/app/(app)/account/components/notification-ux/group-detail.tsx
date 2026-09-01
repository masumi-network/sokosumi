"use client";

import { GroupSubjects } from "./group-body";
import { LevelSegments } from "./level-controls";
import type { CategoryGroup } from "./notification-model";
import { ScopeLadder } from "./scope-controls";
import type { NotificationChoices } from "./use-notification-choices";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 px-4 py-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </p>
      {children}
    </section>
  );
}

/**
 * What an opened group holds: the two questions, in the order they are asked.
 *
 * **What** comes first because it decides which subjects exist at all, and
 * **where** second because it only has meaning once something is listened for.
 * The per-subject chips come last, for the reader who wants one of them to
 * differ from the rest.
 *
 * Shared, so the ten layouts differ on the closed row rather than on the inside
 * of the fold. Where one deliberately differs, it says so.
 */
export function GroupDetail({
  group,
  choices,
  header,
  levelControl,
  subjects = true,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  /** Sits above both questions, for a layout that puts presets inside. */
  header?: React.ReactNode;
  levelControl?: React.ReactNode;
  subjects?: boolean;
}) {
  const hasLadder = group.rungs.length > 1;

  return (
    <>
      {header ? <Section title="Start from">{header}</Section> : null}
      {hasLadder ? (
        <Section title="What to tell you about">
          <ScopeLadder group={group} choices={choices} />
        </Section>
      ) : null}
      <div className={header || hasLadder ? "border-t" : undefined}>
        <Section title="Where it arrives">
          {levelControl ?? <LevelSegments group={group} choices={choices} />}
        </Section>
      </div>
      {subjects ? (
        <div className="border-t">
          <GroupSubjects
            group={group}
            choices={choices}
            muted={choices.groupLevel(group) === "OFF"}
          />
        </div>
      ) : null}
    </>
  );
}
