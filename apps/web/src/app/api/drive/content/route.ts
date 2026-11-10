import type { NextRequest } from "next/server";
import { proxyCoreFileContent } from "@/lib/clients/utils/proxy-core-file-content";

/** A Drive file by pathname: the way to a data room's private files. */
export async function GET(request: NextRequest) {
  const incoming = request.nextUrl.searchParams;
  const pathname = incoming.get("pathname");
  if (!pathname) return new Response(null, { status: 404 });
  const forwarded = new URLSearchParams({ pathname });
  if (incoming.get("download") === "true") forwarded.set("download", "true");
  return proxyCoreFileContent(
    request,
    `/drive/files/content?${forwarded.toString()}`,
  );
}
