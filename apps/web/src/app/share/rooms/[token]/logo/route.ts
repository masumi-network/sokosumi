import { proxyDataRoomBytes } from "@/lib/services/data-room-viewer.server";

/** The room's logo, shown on its sign-in page as well. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return proxyDataRoomBytes(
    `/share/rooms/${encodeURIComponent(token)}/logo`,
    undefined,
  );
}
