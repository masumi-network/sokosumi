import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPasswordWithToken } from "@/lib/actions/auth/action";
import { signOut } from "@/lib/auth/auth.client";

import ResetPasswordForm from "./form";

const { push, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams.current,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/actions/auth/action", () => ({
  resetPasswordWithToken: vi.fn(),
}));
vi.mock("@/lib/auth/auth.client", () => ({ signOut: vi.fn() }));

const OAUTH_QUERY = "client_id=cmo&exp=1900000000&sig=abc%2B%2F%3D";

async function submitNewPassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Fields.Password.label"), "N3wPass!x");
  await user.type(
    screen.getByLabelText("Fields.ConfirmPassword.label"),
    "N3wPass!x",
  );
  await user.click(screen.getByRole("button", { name: "submit" }));
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.current = new URLSearchParams();
    vi.mocked(resetPasswordWithToken).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(signOut).mockResolvedValue({
      data: { success: true },
      error: null,
    });
  });

  it("labels both fields as a new password for password managers", () => {
    render(<ResetPasswordForm />);

    for (const label of [
      "Fields.Password.label",
      "Fields.ConfirmPassword.label",
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute(
        "autocomplete",
        "new-password",
      );
    }
  });

  it("sends the person to sign in afterwards", async () => {
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/signin"));
    expect(toast.success).toHaveBeenCalledWith("success");
  });

  // Core ended every session, but a signed-in browser still holds the session
  // cookie cache, which would bounce sign-in into the app on a dead session.
  it("clears this browser's ended session before sign-in", async () => {
    const order: string[] = [];
    vi.mocked(signOut).mockImplementation(async () => {
      order.push("signOut");
      return { data: { success: true }, error: null };
    });
    push.mockImplementation(() => order.push("push"));
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() => expect(order).toEqual(["signOut", "push"]));
  });

  it("still opens sign-in when there was no session to clear", async () => {
    vi.mocked(signOut).mockRejectedValue(new Error("no session"));
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/signin"));
  });

  it("keeps where the person was going", async () => {
    searchParams.current = new URLSearchParams("returnUrl=/chat");
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/signin?returnUrl=%2Fchat"),
    );
  });

  it("hands the invitation back to sign-in, which locks its address", async () => {
    searchParams.current = new URLSearchParams(
      "returnUrl=/accept-invitation/inv_1&invitationId=inv_1",
    );
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/signin?returnUrl=%2Faccept-invitation%2Finv_1&invitationId=inv_1",
      ),
    );
  });

  // A CMO sign-in started the reset; signing in again must lead back to CMO.
  it("hands the signed OAuth request back to sign-in", async () => {
    searchParams.current = new URLSearchParams(OAUTH_QUERY);
    render(<ResetPasswordForm />);

    await submitNewPassword();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/signin?${OAUTH_QUERY}`),
    );
  });

  it("offers a new link when the reset fails", async () => {
    searchParams.current = new URLSearchParams(OAUTH_QUERY);
    vi.mocked(resetPasswordWithToken).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    render(<ResetPasswordForm />);

    await submitNewPassword();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("error");
    expect(
      screen.getByRole("link", { name: "requestNewLink" }),
    ).toHaveAttribute("href", `/forgot-password?${OAUTH_QUERY}`);
    expect(push).not.toHaveBeenCalled();
  });
});
