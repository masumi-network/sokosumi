import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSpaceMock = vi.fn();
const useSessionMock = vi.fn();

vi.mock("@usersnap/browser", () => ({
  loadSpace: (...args: unknown[]) => loadSpaceMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    useSession: () => useSessionMock(),
  },
}));

import { UsersnapContext } from "../usersnap-context";
import { UsersnapProvider } from "../usersnap-provider";

describe("UsersnapProvider", () => {
  beforeEach(() => {
    loadSpaceMock.mockReset();
    useSessionMock.mockReturnValue({ data: null });
  });

  it("does not leave an unhandled rejection when loadSpace fails with a Usersnap config error", async () => {
    const unhandledRejections: unknown[] = [];
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    loadSpaceMock.mockRejectedValue(
      "Failed to load the widget: Wrong API key or paused project",
    );

    let contextValue: unknown;
    render(
      <UsersnapProvider usersnapSpaceApiKey="test-space-key">
        <UsersnapContext.Consumer>
          {(value) => {
            contextValue = value;
            return null;
          }}
        </UsersnapContext.Consumer>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(loadSpaceMock).toHaveBeenCalledWith("test-space-key");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandledRejections).toEqual([]);
    expect(contextValue).toBeNull();

    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    const initMock = vi.fn();
    loadSpaceMock.mockResolvedValue({ init: initMock });

    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
    });

    let contextValue: unknown;
    render(
      <UsersnapProvider usersnapSpaceApiKey="test-space-key">
        <UsersnapContext.Consumer>
          {(value) => {
            contextValue = value;
            return null;
          }}
        </UsersnapContext.Consumer>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(contextValue).not.toBeNull();
    });

    expect(initMock).toHaveBeenCalledWith({
      user: {
        email: "user@example.com",
        userId: "user-1",
      },
    });
  });
});
