import { connection } from "next/server";
import { Suspense } from "react";
import { DriveListSkeleton } from "@/app/drive/components/drive-list-skeleton";
import { DataRoomClient } from "./data-room-client";

interface DataRoomPageProps {
  params: Promise<{ id: string }>;
}

async function DataRoomContent({ params }: DataRoomPageProps) {
  await connection();
  const { id } = await params;
  return <DataRoomClient roomId={id} />;
}

/** One data room for its owner: people, activity, questions, order, settings. */
export default function DataRoomPage({ params }: DataRoomPageProps) {
  return (
    <Suspense fallback={<DriveListSkeleton viewMode="list" />}>
      <DataRoomContent params={params} />
    </Suspense>
  );
}
