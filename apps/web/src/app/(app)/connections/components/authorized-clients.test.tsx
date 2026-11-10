import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthAuthorizedClients } from "./authorized-clients";

const mockGetConsents = vi.fn();
const mockPublicClient = vi.fn();
const mockRevoke = vi.fn();

// Stable like next-intl's own `t`: the component refetches when `t` changes.
const t = (key: string, values?: Record<string, unknown>) =>
  values?.name ? `${key}:${values.name}` : key;

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Feb 10, 2026" }),
  useTranslations: () => t,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/oauth/action", () => ({
  revokeOAuthClientAccess: (...args: unknown[]) => mockRevoke(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      getConsents: (...args: unknown[]) => mockGetConsents(...args),
      publicClient: (...args: unknown[]) => mockPublicClient(...args),
    },
  },
}));

describe("OAuthAuthorizedClients", () => {
  beforeEach(() => {
    mockGetConsents.mockReset();
    mockGetConsents.mockResolvedValue({
      data: [
        {
          id: "consent-1",
          clientId: "client-1",
          createdAt: "2026-02-10T00:00:00.000Z",
        },
      ],
      error: null,
    });
    mockPublicClient.mockReset();
    mockPublicClient.mockResolvedValue({
      data: { client_name: "Claude" },
      error: null,
    });
    mockRevoke.mockReset();
    mockRevoke.mockResolvedValue({ ok: true, value: undefined });
  });

  it("names an app the viewer authorized but does not own", async () => {
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(mockPublicClient).toHaveBeenCalledWith({
      query: { client_id: "client-1" },
    });
  });

  it("asks before revoking, names the app, and revokes on confirm", async () => {
    const user = userEvent.setup();
    render(<OAuthAuthorizedClients />);

    await user.click(
      await screen.findByRole("button", { name: "revokeAccess" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("confirmRevoke:Claude");
    expect(mockRevoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mockRevoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "revokeAccess" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      Array.from(confirm.querySelectorAll("button")).find(
        (button) => button.textContent === "revokeAccess",
      ) as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(mockRevoke).toHaveBeenCalledWith("consent-1", "client-1"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Claude")).not.toBeInTheDocument(),
    );
  });
});
