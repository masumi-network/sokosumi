import type { Session } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { Activity } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hydrateSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    hydrateSession: hydrateSessionMock,
  },
}));

import { useAuthSessionHydration } from "./use-auth-session-hydration";

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

function Hydrator({
  nextSession,
  registerRenderedUser,
}: {
  nextSession: Session;
  registerRenderedUser: ((userId: string) => void) | null;
}) {
  useAuthSessionHydration(nextSession, registerRenderedUser);
  return null;
}

describe("useAuthSessionHydration", () => {
  beforeEach(() => {
    hydrateSessionMock.mockReset();
  });

  it("registers the rendered user and hydrates authClient before paint and on Activity reveal", () => {
    const registerRenderedUser = vi.fn();

    const { rerender } = render(
      <Activity mode="visible">
        <Hydrator
          nextSession={session}
          registerRenderedUser={registerRenderedUser}
        />
      </Activity>,
    );

    expect(registerRenderedUser).toHaveBeenCalledWith("user-1");
    expect(hydrateSessionMock).toHaveBeenCalledWith(session);

    rerender(
      <Activity mode="hidden">
        <Hydrator
          nextSession={session}
          registerRenderedUser={registerRenderedUser}
        />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Hydrator
          nextSession={session}
          registerRenderedUser={registerRenderedUser}
        />
      </Activity>,
    );

    expect(registerRenderedUser).toHaveBeenCalledTimes(2);
    expect(hydrateSessionMock).toHaveBeenCalledTimes(2);
  });

  it("does not hydrate during SSR", () => {
    const registerRenderedUser = vi.fn();
    renderToString(
      <Hydrator
        nextSession={session}
        registerRenderedUser={registerRenderedUser}
      />,
    );

    expect(registerRenderedUser).not.toHaveBeenCalled();
    expect(hydrateSessionMock).not.toHaveBeenCalled();
  });
});
