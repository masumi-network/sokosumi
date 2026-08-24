import type { Session } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hydrateSessionMock = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    hydrateSession: (...args: unknown[]) => hydrateSessionMock(...args),
  },
}));

import { AuthSessionHydrator } from "@/app/components/auth-session-hydrator.client";

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

describe("AuthSessionHydrator", () => {
  beforeEach(() => {
    hydrateSessionMock.mockReset();
  });

  it("seeds the Better Auth client with the server session during render", () => {
    render(<AuthSessionHydrator session={session} />);

    expect(hydrateSessionMock).toHaveBeenCalledTimes(1);
    expect(hydrateSessionMock).toHaveBeenCalledWith(session);
  });
});
