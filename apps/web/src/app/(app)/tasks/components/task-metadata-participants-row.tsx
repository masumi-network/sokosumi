import type { TaskParticipant } from "@sokosumi/core-client";
import { UsersRound } from "lucide-react";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { PropertyRow } from "./task-metadata";

/** The Participants property: who takes part, by @ or by joining. */
export function TaskMetadataParticipantsRow({
  participants,
  labels,
}: {
  participants: TaskParticipant[];
  labels: { participants: string; noParticipants: string };
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

  return (
    <PropertyRow
      label={labels.participants}
      value={participants.map(({ user }) => user.name).join(", ")}
      icon={
        <AssigneeAvatar
          assignee={{ ...participants[0].user, kind: "user" }}
          size="sm"
        />
      }
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {faces.slice(1).map(({ user }) => (
          <AssigneeAvatar
            key={user.id}
            assignee={{ ...user, kind: "user" }}
            size="sm"
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
