import type { Session } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session: Session = {
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    image: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    termsAccepted: true,
    marketingOptIn: false,
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-02-01T00:00:00.000Z",
    token: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeOrganizationId: "org-a",
  },
};

const sessionStore = vi.hoisted(() => {
  const emptySnapshot = {
    data: null as Session | null,
    isPending: true,
  };
  let snapshot = emptySnapshot;
  const listeners = new Set<() => void>();

  return {
    emptySnapshot,
    reset() {
      snapshot = emptySnapshot;
      listeners.clear();
    },
    hydrateSession(next: Session) {
      snapshot = { data: next, isPending: false };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(onStoreChange: () => void) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getServerSnapshot() {
      return emptySnapshot;
    },
  };
});

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    hydrateSession: (next: Session) => sessionStore.hydrateSession(next),
  },
}));

import { AuthSessionHydrator } from "@/app/components/auth-session-hydrator.client";

function SessionProbe() {
  const { data, isPending } = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );

  return (
    <div>
      <span data-testid="pending">{String(isPending)}</span>
      <span data-testid="org">
        {data?.session.activeOrganizationId ?? "none"}
      </span>
    </div>
  );
}

describe("AuthSessionHydrator", () => {
  beforeEach(() => {
    sessionStore.reset();
  });

  it("seeds useSession before paint so a sibling sees the RSC session", () => {
    render(
      <>
        <AuthSessionHydrator session={session} />
        <SessionProbe />
      </>,
    );

    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    expect(screen.getByTestId("org")).toHaveTextContent("org-a");
  });
});
