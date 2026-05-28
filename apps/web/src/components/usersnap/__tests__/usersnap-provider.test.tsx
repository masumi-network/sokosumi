import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE } from "@/components/usersnap/usersnap-errors";
import { UsersnapProvider } from "@/components/usersnap/usersnap-provider";

const mockLoadSpace = vi.fn();
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
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("does not call loadSpace when the API key is missing", () => {
    render(
      <UsersnapProvider>
        <div>child</div>
      </UsersnapProvider>,
    );

    expect(mockLoadSpace).not.toHaveBeenCalled();
  });

  it("handles Usersnap widget load failures without throwing", async () => {
    mockLoadSpace.mockRejectedValue(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE);

    render(
      <UsersnapProvider usersnapSpaceApiKey="invalid-key">
        <div>child</div>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(mockLoadSpace).toHaveBeenCalledWith("invalid-key");
    });

    expect(console.warn).toHaveBeenCalledWith(
      "Usersnap widget failed to load:",
      USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE,
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("initializes Usersnap when loadSpace succeeds", async () => {
    const mockInit = vi.fn();
    mockLoadSpace.mockResolvedValue({ init: mockInit });

    render(
      <UsersnapProvider usersnapSpaceApiKey="valid-key">
        <div>child</div>
      </UsersnapProvider>,
    );

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalledWith({});
    });
  });
});
