import type { TaskParticipant } from "@sokosumi/core-client";
import { UsersRound } from "lucide-react";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { PropertyRow } from "./task-metadata";
import { TaskParticipantFace } from "./task-participant-face";

/** The Participants property: faces, with the bot mark on followers. */
export function TaskMetadataParticipantsRow({
  participants,
  labels,
}: {
  participants: TaskParticipant[];
  labels: {
    participants: string;
    noParticipants: string;
    followsWithSokoBot: string;
  };
}) {
  if (participants.length === 0) {
    return (
      <PropertyRow
        label={labels.participants}
        value={labels.noParticipants}
        icon={<UsersRound className="text-muted-foreground size-4" />}
      >
        <span className="text-muted-foreground truncate">
          {labels.noParticipants}
        </span>
      </PropertyRow>
    );
  }
  const faces = participants.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = participants.length - faces.length;
  const names = participants
    .map(({ user, followsWithSokoBot }) =>
      followsWithSokoBot
        ? `${user.name} (${labels.followsWithSokoBot})`
        : user.name,
    )
    .join(", ");

  return (
    <PropertyRow
      label={labels.participants}
      value={names}
      icon={<TaskParticipantFace participant={participants[0]} />}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {faces.slice(1).map((participant) => (
          <TaskParticipantFace
            key={participant.user.id}
            participant={participant}
          />
        ))}
        {remainingCount > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            +{remainingCount}
          </span>
        ) : null}
        {faces.length === 1 ? (
          <span className="truncate">{participants[0].user.name}</span>
        ) : null}
      </span>
    </PropertyRow>
  );
}
