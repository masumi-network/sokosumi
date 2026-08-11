import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";

/**
 * Instant / soft-nav into a room: real composer chrome + message-list skeleton.
 * No full-page spinner. Room-aware header/composer swap in after meta loads.
 */
export default function ChatRoomLoading() {
  return <RoomOpenLoadingView />;
}
