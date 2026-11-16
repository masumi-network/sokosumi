interface DataRoomLayoutProps {
  children: React.ReactNode;
}

// No Sokosumi header or sign-up prompt: people in a data room see only the room.
export default function DataRoomLayout({ children }: DataRoomLayoutProps) {
  return (
    <main className="min-h-dvh pt-[env(safe-area-inset-top)]">{children}</main>
  );
}
