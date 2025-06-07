"use client";

import { InvitationErrorCard } from "./components/invitation";

export default function InvitationError({
  error: _error,
  reset: _reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container flex items-center justify-center px-8 py-12">
      <InvitationErrorCard />
    </div>
  );
}
