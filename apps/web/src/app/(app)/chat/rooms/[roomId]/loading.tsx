import DefaultLoading from "@/components/default-loading";

/**
 * Full-page spinner for Instant / soft-nav into a room.
 * Real header + composer paint after room meta (progressive shell); only the
 * message list skeletons. Instant does not fake composer chrome (CLS).
 */
export default function ChatRoomLoading() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}
