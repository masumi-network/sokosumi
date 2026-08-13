import { RoomOpenLoadingView } from "@/app/chat/components/room-open-loading-view";

/**
 * Instant / soft-nav into a room: list skeleton only (no composer).
 * Real title + composer arrive together from RoomsClient after getRoom.
 * Composer-less so missing/invalid rooms never flash send UI before redirect.
 */
export default function ChatRoomLoading() {
  return <RoomOpenLoadingView />;
}
