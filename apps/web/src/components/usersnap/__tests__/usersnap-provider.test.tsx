import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersnapProvider } from "@/components/usersnap/usersnap-provider";
import { useUsersnapApi } from "@/components/usersnap/useUsersnapAPI";

const mockLoadSpace = vi.fn();
const mockInit = vi.fn();

vi.mock("@usersnap/browser", () => ({
  loadSpace: (...args: unknown[]) => mockLoadSpace(...args),
}));

let mockSession: { user?: { id: string; email: string } } | null = null;

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    useSession: () => ({ data: mockSession }),
  },
}));

function UsersnapConsumer() {
  const api = useUsersnapApi();
  return <div data-testid="usersnap-api">{api ? "loaded" : "missing"}</div>;
}

describe("UsersnapProvider", () => {
  beforeEach(() => {
    mockLoadSpace.mockReset();
    mockInit.mockReset();
    mockSession = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does not call loadSpace when the API key is missing", () => {
    render(
      <UsersnapProvider>
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    expect(mockLoadSpace).not.toHaveBeenCalled();
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    mockSession = {
      user: {
        id: "user-1",
        email: "user@example.com",
      },
    };
    mockLoadSpace.mockResolvedValue({ init: mockInit });

    render(
      <UsersnapProvider usersnapSpaceApiKey="space-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(mockLoadSpace).toHaveBeenCalledWith("space-key");
    });

    expect(mockInit).toHaveBeenCalledWith({
      user: {
        email: "user@example.com",
        userId: "user-1",
      },
    });
  });

  it("handles Usersnap load failures without throwing", async () => {
    const loadError =
      "Failed to load the widget: Wrong API key or paused project";
    mockLoadSpace.mockRejectedValue(loadError);

    render(
      <UsersnapProvider usersnapSpaceApiKey="invalid-key">
        <UsersnapConsumer />
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledWith(
        "Usersnap widget failed to load:",
        loadError,
      );
    });

    expect(mockInit).not.toHaveBeenCalled();
  });
});
