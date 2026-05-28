import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE } from "../usersnap-errors";
import { UsersnapProvider } from "../usersnap-provider";

const mockLoadSpace = vi.fn();
const mockInit = vi.fn();
const mockUseSession = vi.fn();

vi.mock("@usersnap/browser", () => ({
  loadSpace: (...args: unknown[]) => mockLoadSpace(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    useSession: () => mockUseSession(),
  },
}));

describe("UsersnapProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({ data: null });
    mockLoadSpace.mockResolvedValue({ init: mockInit });
  });

  it("does not call loadSpace when the API key is missing", () => {
    render(
      <UsersnapProvider>
        <div>child</div>
      </UsersnapProvider>,
    );

    expect(mockLoadSpace).not.toHaveBeenCalled();
  });

  it("initializes Usersnap with the session user after load", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
    });

    render(
      <UsersnapProvider usersnapSpaceApiKey="space-key">
        <div>child</div>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(mockLoadSpace).toHaveBeenCalledWith("space-key");
      expect(mockInit).toHaveBeenCalledWith({
        user: {
          userId: "user-1",
          email: "user@example.com",
        },
      });
    });
  });

  it("swallows Usersnap widget configuration rejections", async () => {
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);

    mockLoadSpace.mockRejectedValue(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE);

    render(
      <UsersnapProvider usersnapSpaceApiKey="invalid-key">
        <div>child</div>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(mockLoadSpace).toHaveBeenCalledWith("invalid-key");
    });

    expect(mockInit).not.toHaveBeenCalled();
    expect(unhandledRejection).not.toHaveBeenCalled();

    process.off("unhandledRejection", unhandledRejection);
  });
});
