import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  setActive: vi.fn(),
  preferred: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  mint: vi.fn(),
  send: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/setup",
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      setActive: mocks.setActive,
      update: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));
vi.mock("@/lib/actions/organization/action", () => ({
  createOrganizationWorkspaceAction: mocks.create,
  updatePreferredOrganization: mocks.preferred,
  inviteOrganizationMembersBulk: mocks.send,
}));
vi.mock("@/lib/actions/organization/invite-link-action", () => ({
  createOrganizationInviteLink: mocks.mint,
}));
vi.mock("@/lib/actions/organization/site-icon-action", () => ({
  resolveOrganizationSiteIcon: vi.fn().mockResolvedValue({ ok: false }),
}));
vi.mock("@/lib/actions/workspace-gate/action", () => ({
  createPersonalWorkspaceAction: vi.fn(),
}));
vi.mock("@/lib/auth/persist-user-name", () => ({
  persistFirstAndLastName: vi.fn(),
}));
vi.mock("@/components/design-md/use-design-md-generation", () => ({
  useDesignMdGeneration: () => ({
    status: "idle",
    generate: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toast, success: vi.fn() } }));

import { IdentityOnboardingForm } from "./identity-onboarding-form.client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
async function openWizard() {
  const user = userEvent.setup();
  render(
    <IdentityOnboardingForm
      initialName="Ada Lovelace"
      initialFirstName="Ada"
      initialLastName="Lovelace"
      askName={false}
      workspaceReady={false}
      returnUrl="/chat/join/abc?ref=mail"
    />,
  );
  await user.click(screen.getByRole("radio", { name: /organizationTitle/i }));
  await user.click(screen.getByTestId("workspace-gate-identity-submit"));
  await user.type(
    screen.getByPlaceholderText("Details.namePlaceholder"),
    "Acme",
  );
  await user.type(
    screen.getByPlaceholderText("Details.urlPlaceholder"),
    "acme.com",
  );
  return user;
}
async function openCreatedWizard() {
  const user = await openWizard();
  await user.click(screen.getByRole("button", { name: /Nav.next/i }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  return user;
}
async function reachReady() {
  const user = await openCreatedWizard();
  await user.click(screen.getByRole("button", { name: /Nav.next/i }));
  await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
  return user;
}
describe("IdentityOnboardingForm navigation", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.create.mockResolvedValue({
      ok: true,
      value: { organizationId: "org-1" },
    });
    mocks.setActive.mockResolvedValue({ data: null, error: null });
    mocks.preferred.mockResolvedValue({
      ok: true,
      value: { organizationId: "org-1" },
    });
    mocks.mint.mockResolvedValue({
      ok: true,
      value: { url: "https://example.test/invite" },
    });
    mocks.send.mockResolvedValue({
      ok: true,
      value: { results: [{ status: "sent" }] },
    });
    vi.spyOn(window.location, "replace").mockImplementation(mocks.replace);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  it("keeps ready dialog locked through activation and preference before invite return navigation", async () => {
    const activation = deferred<{ data: null; error: null }>();
    const preference = deferred<{
      ok: true;
      value: { organizationId: string };
    }>();
    mocks.setActive.mockReturnValue(activation.promise);
    mocks.preferred.mockReturnValue(preference.promise);
    const user = await reachReady();
    await user.type(
      screen.getByPlaceholderText("Invite.emailsPlaceholder"),
      "colleague@example.test",
    );
    expect(
      screen.getByRole("button", { name: /Invite.sendInvites/i }),
    ).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Nav.finish$/i }));
    const finish = screen.getByRole("button", { name: /Nav.finish$/i });
    expect(
      screen.getByPlaceholderText("Invite.emailsPlaceholder"),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Invite.sendInvites/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Invite.copy/i })).toBeDisabled();
    expect(finish).toHaveAttribute("aria-busy", "true");
    expect(
      finish.querySelector('[data-slot="button-loading-bar"]'),
    ).toBeTruthy();
    expect(mocks.preferred).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.setActive).toHaveBeenCalledOnce();
    await act(() => activation.resolve({ data: null, error: null }));
    expect(mocks.preferred).toHaveBeenCalledWith({ organizationId: "org-1" });
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(() =>
      preference.resolve({ ok: true, value: { organizationId: "org-1" } }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/chat/join/abc?ref=mail");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("deduplicates Finish and close events before state batches", async () => {
    mocks.setActive.mockReturnValue(new Promise(() => {}));
    await reachReady();
    const finish = screen.getByRole("button", { name: /Nav.finish$/i });
    const close = screen.getByRole("button", { name: "Close" });
    act(() => {
      finish.click();
      close.click();
    });
    expect(mocks.setActive).toHaveBeenCalledOnce();
  });
  it("deduplicates two Esc events before state batches", async () => {
    mocks.setActive.mockReturnValue(new Promise(() => {}));
    await openCreatedWizard();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(mocks.setActive).toHaveBeenCalledOnce();
    expect(mocks.mint).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Nav.finish$/i }),
    ).toHaveAttribute("aria-busy", "true");
  });
  it.each(["in-band", "rejection"])(
    "retries %s selection errors and completes after preference failure",
    async (errorKind) => {
      if (errorKind === "in-band")
        mocks.setActive.mockResolvedValueOnce({
          data: null,
          error: { message: "temporary" },
        });
      else mocks.setActive.mockRejectedValueOnce(new Error("temporary"));
      mocks.setActive.mockResolvedValueOnce({ data: null, error: null });
      mocks.preferred.mockRejectedValue(new Error("preference offline"));
      const user = await reachReady();
      await user.click(screen.getByRole("button", { name: /Nav.finish$/i }));
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
      expect(mocks.setActive).toHaveBeenCalledTimes(2);
      expect(mocks.preferred).toHaveBeenCalledOnce();
      expect(mocks.toast).not.toHaveBeenCalled();
    },
  );
  it.each(["Close", "Escape"])(
    "dismisses via %s after creation into ready without minting invites",
    async (method) => {
      mocks.setActive.mockReturnValue(new Promise(() => {}));
      const user = await openCreatedWizard();
      if (method === "Close")
        await user.click(screen.getByRole("button", { name: "Close" }));
      else await user.keyboard("{Escape}");
      expect(mocks.setActive).toHaveBeenCalledOnce();
      expect(mocks.mint).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Nav.finish$/i }),
      ).toHaveAttribute("aria-busy", "true");
    },
  );
  it("lets invites send before leaving and blocks same-batch sends after Finish", async () => {
    mocks.setActive.mockReturnValue(new Promise(() => {}));
    const user = await reachReady();
    const emails = screen.getByPlaceholderText("Invite.emailsPlaceholder");
    await user.type(emails, "colleague@example.test");
    await user.click(
      screen.getByRole("button", { name: /Invite.sendInvites/i }),
    );
    await waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    await user.type(emails, "second@example.test");
    const finish = screen.getByRole("button", { name: /Nav.finish$/i });
    const send = screen.getByRole("button", { name: /Invite.sendInvites/i });
    act(() => {
      finish.click();
      send.click();
    });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it("leaves after both activation attempts fail, preserving the caller fallback", async () => {
    mocks.setActive.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const user = await reachReady();
    await user.click(screen.getByRole("button", { name: /Nav.finish$/i }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
    expect(mocks.setActive).toHaveBeenCalledTimes(2);
    expect(mocks.preferred).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith("organizationActivateError");
  });
  it.each(["Close", "Escape"])(
    "cancels via %s before creation and resets on reopen",
    async (method) => {
      const user = await openWizard();
      if (method === "Close")
        await user.click(screen.getByRole("button", { name: "Close" }));
      else await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.setActive).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
      await user.click(screen.getByTestId("workspace-gate-identity-submit"));
      expect(
        screen.getByPlaceholderText("Details.namePlaceholder"),
      ).toHaveValue("");
      expect(screen.getByPlaceholderText("Details.urlPlaceholder")).toHaveValue(
        "",
      );
    },
  );
  it("allows retry after creation fails", async () => {
    mocks.create.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    const user = await openCreatedWizard();
    expect(mocks.toast).toHaveBeenCalledWith("Errors.createFailed");
    expect(mocks.setActive).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
  });
  it("blocks dismissal as creation starts before React renders pending state", async () => {
    const creation = deferred<{
      ok: true;
      value: { organizationId: string };
    }>();
    mocks.create.mockImplementationOnce(() => {
      screen.getByRole("button", { name: "Close" }).click();
      return creation.promise;
    });
    await openCreatedWizard();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.setActive).not.toHaveBeenCalled();
    await act(() =>
      creation.resolve({ ok: true, value: { organizationId: "org-1" } }),
    );
    expect(screen.getByRole("button", { name: /Nav.next/i })).toBeTruthy();
  });
  it("blocks retrying a failed invite link after Finish, including before render", async () => {
    mocks.mint.mockResolvedValue({ ok: false });
    mocks.setActive.mockReturnValue(new Promise(() => {}));
    await reachReady();
    const retry = await screen.findByRole("button", {
      name: /Invite.regenerate/i,
    });
    expect(retry).not.toBeDisabled();
    const finish = screen.getByRole("button", { name: /Nav.finish$/i });
    act(() => {
      finish.click();
      retry.click();
    });
    expect(mocks.mint).toHaveBeenCalledOnce();
    expect(retry).toBeDisabled();
  });
});
