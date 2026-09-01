"use client";

import { ChannelChip } from "./channel-chip";
import type { CategoryGroup } from "./notification-model";
import { SubjectRowShell } from "./subject-list";
import type { NotificationChoices } from "./use-notification-choices";

/**
 * The subjects the breadth ladder currently includes, with a chip per channel.
 *
 * Only the in-scope ones. A subject the reader has excluded is off in every
 * channel, so drawing its chips would offer a way to contradict the ladder one
 * row under the ladder itself.
 */
export function GroupSubjects({
  group,
  choices,
  muted = false,
}: {
  group: CategoryGroup;
  choices: NotificationChoices;
  /** Dims the rows of a group that is off, without taking them away. */
  muted?: boolean;
}) {
  const subjects = choices.inScope(group);
  // A group of one subject and no ladder is that subject: repeating its name as
  // a heading and again as a row label reads as two settings.
  const named = subjects.length > 1 || group.rungs.length > 1;

  return (
    <>
      {subjects.map((subject) => (
        <SubjectRowShell
          key={subject.category}
          title={named ? subject.label : null}
          description={named ? null : group.description}
          muted={muted}
          controls={subject.channels.map((channel) => (
            <ChannelChip
              key={channel.channel}
              channel={channel.channel}
              label={channel.label}
              state={channel.enabled ? "on" : "off"}
              disabled={!channel.available}
              reason={channel.unavailableReason}
              busy={channel.saving}
              ariaLabel={`${named ? subject.label : group.label}, ${channel.label}`}
              onToggle={(next) => {
                void choices.setChannel(
                  subject.category,
                  channel.channel,
                  next,
                );
              }}
            />
          ))}
        />
      ))}
    </>
  );
}
