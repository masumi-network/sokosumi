import type { TaskFollower } from "@sokosumi/core-client";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { READ_RECEIPT_FACE_CAP } from "@/components/chat/read-receipt-faces";
import { BotFace, botFaceSeed } from "@/components/soko-bot/bot-face";
import { PropertyRow } from "./task-metadata";

/** A follower's Soko Bot; the person when their bot is gone. */
function FollowerFace({ follower }: { follower: TaskFollower }) {
  if (!follower.sokoBot) {
    return (
      <AssigneeAvatar assignee={{ ...follower.user, kind: "user" }} size="sm" />
    );
  }
  return (
    <BotFace
      imageUrl={follower.sokoBot.avatarImageUrl}
      avatarCode={follower.sokoBot.avatarCode}
      seed={botFaceSeed(follower.sokoBot, follower.user.id)}
      orbSize={40}
      avatarSize={20}
      className="size-5"
    />
  );
}

/**
 * Whose Soko Bot follows the Task, for the other people on it. The viewer's
 * own follow shows on the follow button, not here.
 */
export function TaskMetadataFollowersRow({
  followers,
  viewerId,
  labels,
}: {
  followers: TaskFollower[];
  viewerId: string | null;
  labels: { followedBy: string; followerBot: (name: string) => string };
}) {
  const others = followers.filter(({ user }) => user.id !== viewerId);
  if (others.length === 0) return null;
  // A follower whose bot is gone shows as themselves, so is named so too.
  const nameOf = (follower: TaskFollower) =>
    follower.sokoBot
      ? labels.followerBot(follower.user.name)
      : follower.user.name;
  const faces = others.slice(0, READ_RECEIPT_FACE_CAP);
  const remainingCount = others.length - faces.length;

  return (
    <PropertyRow
      label={labels.followedBy}
      value={others.map(nameOf).join(", ")}
      icon={<FollowerFace follower={others[0]} />}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {faces.slice(1).map((follower) => (
          <FollowerFace key={follower.user.id} follower={follower} />
        ))}
        {remainingCount > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            +{remainingCount}
          </span>
        ) : null}
        {faces.length === 1 ? (
          <span className="truncate">{nameOf(others[0])}</span>
        ) : null}
      </span>
    </PropertyRow>
  );
}
