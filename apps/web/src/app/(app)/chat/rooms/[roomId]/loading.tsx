import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";

/**
 * Instant / soft-nav into a room: list skeleton + disabled composer chrome.
 * Real title + live composer arrive from RoomsClient after getRoom.
 */
export default function ChatRoomLoading() {
  return <RoomOpenLoadingView />;
}
