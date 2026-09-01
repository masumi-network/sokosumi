"use client";

import { DeliverySegments } from "./delivery-controls";
import { GroupPanel, useOpenGroups } from "./group-panel";
import { GroupGlance } from "./group-summary";
import {
  type CategoryGroup,
  groupSummary,
  type SubjectChoice,
} from "./notification-model";
import { PresetSegments } from "./preset-controls";
import { SubjectRow } from "./subject-row";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * The subjects a covering subject speaks for, under it.
 *
 * Same rows as F1, ordered so containment is visible before it is read: every
 * message in your rooms comes first and the two it carries are indented beneath
 * it. The wide setting leads because it is the one that changes the others.
 */
function nest(group: CategoryGroup) {
  const parents = group.subjects.filter(
    (subject) => subject.spec.covers.length > 0,
  );
  const covered = new Set(parents.flatMap((parent) => parent.spec.covers));

  return group.subjects
    .filter((subject) => !covered.has(subject.spec.id))
    .map((subject) => ({
      subject,
      children: subject.spec.covers
        .map((id) =>
          group.subjects.find((candidate) => candidate.spec.id === id),
        )
        .filter((child): child is SubjectChoice => child !== undefined),
    }));
}

export function F4NestedSubjects({
  choices,
}: {
  choices: NotificationChoices;
}) {
  const open = useOpenGroups();

  return (
    <div className="divide-y rounded-lg border">
      {choices.groups.map((group) => (
        <GroupPanel
          key={group.id}
          open={open.isOpen(group.id)}
          onOpenChange={(next) => open.setOpen(group.id, next)}
          title={group.label}
          summary={groupSummary(group)}
          control={
            <>
              <GroupGlance group={group} />
              <PresetSegments
                group={group}
                choices={choices}
                onCustom={() => open.setOpen(group.id, true)}
              />
            </>
          }
        >
          <div className="divide-y">
            {nest(group).map(({ subject, children }) => (
              <div key={subject.spec.id} className="divide-y">
                <SubjectRow
                  subject={subject}
                  control={
                    <DeliverySegments subject={subject} choices={choices} />
                  }
                />
                {children.map((child) => (
                  <SubjectRow
                    key={child.spec.id}
                    subject={child}
                    indent
                    control={
                      <DeliverySegments subject={child} choices={choices} />
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </GroupPanel>
      ))}
    </div>
  );
}
