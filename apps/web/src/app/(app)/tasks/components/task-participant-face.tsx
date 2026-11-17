import type { TaskParticipant } from "@sokosumi/core-client";
import { Bot } from "lucide-react";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";

/**
 * A participant's face. A small Soko Bot mark sits on it while their own bot
 * follows the Task for them.
 */
export function TaskParticipantFace({
  participant: { user, followsWithSokoBot },
}: {
  participant: TaskParticipant;
}) {
  return (
    <span className="relative inline-flex">
      <AssigneeAvatar assignee={{ ...user, kind: "user" }} size="sm" />
      {followsWithSokoBot ? (
        <span
          data-testid={`task-participant-bot-mark-${user.id}`}
          className="bg-background ring-border absolute -right-1 -bottom-1 inline-flex size-3 items-center justify-center rounded-full ring-1"
          aria-hidden
        >
          <Bot className="text-foreground size-2.5" />
        </span>
      ) : null}
    </span>
  );
}
