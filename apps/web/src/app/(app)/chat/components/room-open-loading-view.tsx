import { RoomMessageListSkeleton } from "@/app/chat/components/room-message-list-skeleton";
import { RoomShellLayout } from "@/app/chat/components/room-shell-layout";

/**
 * Instant / Suspense fallback for `/chat/rooms/[roomId]`.
 *
 * Composer-less on purpose: missing/invalid rooms redirect after this shell.
 * Mounting a fake composer here flashes send UI for nonexistent rooms and lets
 * an `empty:before` bone win mobile LCP before real chrome. Real title +
 * composer arrive together from RoomsClient after `getRoom`.
 */
export function RoomOpenLoadingView(): React.ReactElement {
  return (
    <RoomShellLayout
      testId="chat-room-loading"
      dataSlot="chat-room-open-loading"
      reserveDesktopHeader
      desktopHeader={null}
      listContent={<RoomMessageListSkeleton />}
      composer={null}
    />
  );
}
