import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import {
  DATA_ROOM_SESSION_COOKIE,
  readDataRoom,
} from "@/lib/services/data-room-viewer.server";
import { RoomMark } from "./room-mark";
import { RoomSignIn } from "./room-sign-in";
import { RoomViewer } from "./room-viewer";

export const instant = false;

interface DataRoomPageProps {
  params: Promise<{ token: string }>;
}

async function load(params: DataRoomPageProps["params"]) {
  await connection();
  const { token } = await params;
  const session = (await cookies()).get(DATA_ROOM_SESSION_COOKIE)?.value;
  return { token, room: await readDataRoom(token, session) };
}

export async function generateMetadata({
  params,
}: DataRoomPageProps): Promise<Metadata> {
  const { room } = await load(params);
  const t = await getTranslations("Share.Room");
  return {
    title: room ? room.title : t("notFoundTitle"),
    // A data room is for the people let in, never for search engines.
    robots: { index: false, follow: false },
  };
}

export default async function DataRoomPage({ params }: DataRoomPageProps) {
  const { token, room } = await load(params);
  if (!room) return notFound();
  const t = await getTranslations("Share.Room");

  if (room.state === "in") return <RoomViewer token={token} room={room} />;

  return (
    <div className="container mx-auto flex justify-center p-4 md:px-8 md:py-10">
      <section className="bg-card-background w-full max-w-md rounded-xl border p-5 md:p-6">
        <header className="mb-5 flex min-w-0 items-center gap-3">
          <RoomMark token={token} hasLogo={room.hasLogo} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{room.title}</h1>
            <p className="text-muted-foreground text-sm">{t("dataRoom")}</p>
          </div>
        </header>
        {room.state === "out" ? (
          <RoomSignIn token={token} />
        ) : (
          <p className="text-muted-foreground text-sm" role="status">
            {room.state === "expired" ? t("expired") : t("closed")}
          </p>
        )}
      </section>
    </div>
  );
}
