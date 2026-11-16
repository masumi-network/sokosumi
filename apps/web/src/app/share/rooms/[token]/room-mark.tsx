import { LockKeyhole } from "lucide-react";

/** The room's logo when the owner chose one, a lock otherwise. */
export function RoomMark({
  token,
  hasLogo,
}: {
  token: string;
  hasLogo: boolean;
}) {
  if (hasLogo)
    return (
      <img
        src={`/share/rooms/${encodeURIComponent(token)}/logo`}
        alt=""
        className="size-10 shrink-0 rounded-lg object-contain"
      />
    );
  return (
    <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
      <LockKeyhole aria-hidden className="size-5" />
    </span>
  );
}
