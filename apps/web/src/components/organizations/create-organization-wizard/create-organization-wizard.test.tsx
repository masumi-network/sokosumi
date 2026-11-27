import { expectConsole } from "@sokosumi/utils/test-console";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleSelectWorkspaceMock = vi.fn();
const createOrganizationWorkspaceActionMock = vi.fn();
const organizationUpdateMock = vi.fn();
const resolveOrganizationSiteIconMock = vi.fn();
const createOrganizationInviteLinkMock = vi.fn();
const onOrganizationReadyMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: false,
    handleSelectWorkspace: (...args: unknown[]) =>
      handleSelectWorkspaceMock(...args),
    whenSettled: () => Promise.resolve(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const brandGeneration: {
  status: string;
  onCompleted?: (designMd: unknown) => void;
} = { status: "idle" };

vi.mock("@/components/design-md/use-design-md-generation", () => ({
  useDesignMdGeneration: (options: {
    onCompleted?: (designMd: unknown) => void;
  }) => {
    brandGeneration.onCompleted = options.onCompleted;
    return {
      status: brandGeneration.status,
      generate: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

vi.mock("@/lib/actions/organization/action", () => ({
  createOrganizationWorkspaceAction: (...args: unknown[]) =>
    createOrganizationWorkspaceActionMock(...args),
  inviteOrganizationMembersBulk: vi.fn(),
}));
vi.mock("@/lib/actions/organization/invite-link-action", () => ({
  createOrganizationInviteLink: (...args: unknown[]) =>
    createOrganizationInviteLinkMock(...args),
}));
vi.mock("@/lib/actions/organization/site-icon-action", () => ({
  resolveOrganizationSiteIcon: (...args: unknown[]) =>
    resolveOrganizationSiteIconMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      update: (...args: unknown[]) => organizationUpdateMock(...args),
    },
  },
}));

const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

import { CreateOrganizationWizard } from "./create-organization-wizard";

function WizardHarness({
  onOrganizationReady,
}: {
  onOrganizationReady?: (organizationId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <CreateOrganizationWizard
      open={open}
      onOpenChange={setOpen}
      onOrganizationReady={onOrganizationReady}
    />
  );
}

describe("CreateOrganizationWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brandGeneration.status = "idle";
    createOrganizationWorkspaceActionMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org-1" },
    });
    organizationUpdateMock.mockResolvedValue({ error: null });
    resolveOrganizationSiteIconMock.mockResolvedValue({
      ok: false,
    });
    createOrganizationInviteLinkMock.mockResolvedValue({
      ok: false,
    });
  });

  it("shows the name and website errors together, each on its own field", async () => {
    const user = userEvent.setup();
    render(<WizardHarness />);

    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    const name = screen.getByLabelText("Details.nameLabel");
    const url = screen.getByLabelText("Details.urlLabel");
    expect(name).toHaveAccessibleDescription("Details.nameInvalid");
    expect(url).toHaveAccessibleDescription("Details.urlInvalid");
    expect(screen.getAllByRole("alert").map((el) => el.textContent)).toEqual([
      "Details.nameInvalid",
      "Details.urlInvalid",
    ]);

    await user.type(name, "Acme");
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    expect(name).not.toHaveAccessibleDescription();
    expect(url).toHaveAccessibleDescription("Details.urlInvalid");
    expect(createOrganizationWorkspaceActionMock).not.toHaveBeenCalled();
  });

  it("keeps the invite link labeled while it loads", async () => {
    const user = userEvent.setup();
    createOrganizationInviteLinkMock.mockReturnValue(new Promise(() => {}));
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(screen.getByLabelText("Details.nameLabel"), "Acme");
    await user.type(screen.getByLabelText("Details.urlLabel"), "acme.com");
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await screen.findByText("Logo.title");
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));

    const link = screen.getByRole("textbox", { name: "Invite.linkLabel" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).toHaveAccessibleDescription("Invite.linkHint");
    expect(screen.getByRole("button", { name: "Invite.copy" })).toBeDisabled();
  });

  it("does not complete when dismissed before create", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.click(screen.getByTestId("create-org-wizard-back"));

    expect(onOrganizationReadyMock).not.toHaveBeenCalled();
    expect(createOrganizationWorkspaceActionMock).not.toHaveBeenCalled();
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("creates the organization on name + URL and completes on Finish", async () => {
    const user = userEvent.setup();
    createOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { url: "https://example.com/join/team" },
    });
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledWith({
      name: "Acme",
      websiteUrl: "https://acme.com/",
    });

    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));

    const link = await screen.findByRole("textbox", {
      name: "Invite.linkLabel",
    });
    expect(link).toHaveValue("https://example.com/join/team");
    expect(link).toHaveAttribute("readonly");
    expect(link).toHaveAccessibleDescription("Invite.linkHint");

    const emails = screen.getByRole("textbox", { name: "Invite.emailsLabel" });
    expect(emails).toHaveAccessibleDescription("Invite.emailsHint");
    await user.type(emails, "alex@example.com");
    expect(emails).toHaveAccessibleName("Invite.emailsLabel");
    expect(screen.getByText("Invite.emailsLabel")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Nav.finish/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("opens the brand guidelines explanation on a click, so a tap works too", async () => {
    const user = userEvent.setup();
    render(<WizardHarness />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));

    expect(screen.queryByText("Brand.tooltip")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Brand.title" }));

    const help = await screen.findByRole("dialog", { name: "Brand.title" });
    expect(help.textContent).toContain("Brand.tooltip");
  });

  /** Walks to the Brand step and completes generation with `look`. */
  async function showBrandLook(look: Record<string, unknown>) {
    const user = userEvent.setup();
    render(<WizardHarness />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));

    brandGeneration.status = "completed";
    act(() => {
      brandGeneration.onCompleted?.({
        extractionId: "1",
        look,
        previewUrl: "https://www.masumi.network/tools/design-md?cached=1",
        url: "https://blob.example/design-md/acme.md",
      });
    });

    return user;
  }

  it.each([
    [
      "shows the saved colours, fonts, tone and voice in plain words",
      {
        colors: ["#5850ec"],
        fonts: ["Inter"],
        tone: "plain and confident",
        voice: "Prefer **short sentences.** Use `plain` words.",
      },
      [
        "#5850ec",
        "Inter",
        "plain and confident",
        "Prefer short sentences. Use plain words.",
      ],
    ],
    [
      "says the guidelines are saved when none of it can be shown",
      { colors: [], fonts: [], tone: null, voice: null },
      ["Brand.noSummary"],
    ],
  ])("%s", async (_, look, texts) => {
    await showBrandLook(look);

    for (const text of texts) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText("DESIGN.md")).toBeNull();
    // Setup never sends the owner to another site to read them.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("previews a long voice and opens the rest in place", async () => {
    const voice =
      "Written in full sentences with no exclamations, no marketing vocabulary and no calls to emotion. Sentences state a rule, then a restriction.";
    const user = await showBrandLook({
      colors: [],
      fonts: [],
      tone: "formal and precise",
      voice,
    });

    // The label sits on the first line, beside a short preview.
    expect(screen.getByText("Brand.voice").parentElement).toHaveClass(
      "items-start",
    );
    const toggle = screen.getByText("Brand.voiceShowAll").closest("summary");
    expect(toggle?.textContent).toContain(
      "Written in full sentences with no exclamations…",
    );
    const details = toggle?.closest("details");
    expect(details?.open).toBe(false);

    // A tap or Enter on the summary shows all of it, still in setup.
    await user.click(toggle as HTMLElement);
    expect(details?.open).toBe(true);
    expect(screen.getByText(voice)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();

    // The same summary closes it again.
    await user.click(toggle as HTMLElement);
    expect(details?.open).toBe(false);
  });

  it.each([
    ["shows 48 characters whole", `${"word ".repeat(9)}end`, null],
    [
      "previews from 49 characters",
      `${"word ".repeat(9)}ends`,
      `${"word ".repeat(8)}word…`,
    ],
    [
      "never splits a character when no word fits",
      `${"x".repeat(47)}\u{1F680}\u{1F680} then more`,
      `${"x".repeat(47)}\u{1F680}…`,
    ],
  ])("%s", async (_, voice, preview) => {
    await showBrandLook({ colors: [], fonts: [], tone: null, voice });

    const toggle = screen.queryByText("Brand.voiceShowAll")?.closest("summary");
    if (preview === null) {
      expect(toggle).toBeFalsy();
      expect(screen.getByText(voice)).toBeVisible();
    } else {
      expect(toggle?.textContent).toBe(
        `${preview} Brand.voiceShowAllBrand.voiceShowLess`,
      );
    }
  });

  it("shows a short voice whole, with nothing to open", async () => {
    await showBrandLook({
      colors: [],
      fonts: [],
      tone: "plain and calm",
      voice: "Short sentences. No jargon.",
    });

    expect(screen.getByText("Short sentences. No jargon.")).toBeVisible();
    expect(screen.queryByText("Brand.voiceShowAll")).toBeNull();
  });

  it.each(["Close", "Finish"])(
    "selects and closes via %s without onOrganizationReady, even while selection is pending",
    async (method) => {
      const user = userEvent.setup();
      handleSelectWorkspaceMock.mockReturnValue(new Promise<void>(() => {}));
      render(<WizardHarness />);

      await user.type(
        screen.getByPlaceholderText("Details.namePlaceholder"),
        "Acme",
      );
      await user.type(
        screen.getByPlaceholderText("Details.urlPlaceholder"),
        "acme.com",
      );
      await user.click(screen.getByRole("button", { name: /Nav.next/i }));

      await waitFor(() => {
        expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
      });

      if (method === "Finish") {
        await user.click(
          screen.getByRole("button", { name: /Nav.skipForNow/i }),
        );
        await user.click(
          screen.getByRole("button", { name: /Nav.finishSetup/i }),
        );
        await user.click(screen.getByRole("button", { name: /Nav.finish$/i }));
      } else {
        await user.click(screen.getByRole("button", { name: /close/i }));
      }

      expect(handleSelectWorkspaceMock).toHaveBeenCalledWith("org-1", {
        shouldRedirectAgentJobsBasePath: false,
      });
      expect(onOrganizationReadyMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("completes the created organization when the dialog is dismissed after step 0", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
  });

  it("stays open on Finish while onOrganizationReady leaves", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finish/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nav.finish/i })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onOrganizationReadyMock).toHaveBeenCalledOnce();
  });

  it("shows the ready step while leaving when dismissed after create", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nav.finish/i })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("lets logo and brand steps advance empty", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    // The pressed button left with its step; focus starts at the new title.
    expect(screen.getByRole("heading", { name: "Logo.title" })).toHaveFocus();
    // No logo: one drop target, no empty tile offering to replace nothing.
    expect(
      await screen.findByRole("button", { name: "Logo.dropzone" }),
    ).toHaveAccessibleDescription("Logo.uploadHint");
    expect(
      screen.queryByRole("button", { name: /Logo.replace/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));
    expect(screen.getByRole("heading", { name: "Brand.title" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /Nav.back/i }));
    expect(screen.getByRole("heading", { name: "Logo.title" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /Nav.skipForNow/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    expect(screen.getByRole("heading", { name: "Invite.title" })).toHaveFocus();
  });

  it("says a rejected logo failed in the page's language, not FileUpload's English", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    const dropzone = await screen.findByRole("button", {
      name: "Logo.dropzone",
    });
    const [inputId] = (dropzone.getAttribute("aria-controls") ?? "").split(" ");
    const input = document.getElementById(inputId ?? "") as HTMLInputElement;
    await user.upload(
      input,
      new File(["not a logo"], "notes.txt", { type: "text/plain" }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Logo.uploadError");
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith("File type not accepted");
    expect(organizationUpdateMock).not.toHaveBeenCalled();
  });

  it("offers to replace a found logo and continues instead of skipping", async () => {
    resolveOrganizationSiteIconMock.mockResolvedValue({
      ok: true,
      value: { url: "https://acme.com/icon.png" },
    });
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    expect(
      await screen.findAllByRole("button", { name: "Logo.replace" }),
    ).not.toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Logo.dropzone" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    expect(screen.getByText("Brand.title")).toBeTruthy();
  });

  async function submitDetails() {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);
    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    return user;
  }

  it("offers sign in when the person is signed out", async () => {
    createOrganizationWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await submitDetails();

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Errors.createFailed",
        expect.objectContaining({
          action: expect.objectContaining({
            label: "Errors.unauthorizedAction",
          }),
        }),
      );
    });
    expect(onOrganizationReadyMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "shows Core's message at the organization limit",
      {
        code: "ORGANIZATION_LIMIT_REACHED",
        message: "You have reached the maximum number of organizations",
      },
      "You have reached the maximum number of organizations",
    ],
    [
      "falls back to the generic message",
      { code: "INTERNAL_SERVER_ERROR" },
      "Errors.createFailed",
    ],
  ])("%s in the dialog", async (_label, error, message) => {
    createOrganizationWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error,
    });
    await submitDetails();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByText("Details.title")).toBeTruthy();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(onOrganizationReadyMock).not.toHaveBeenCalled();
  });

  /**
   * A server action that throws reaches the browser as React's redacted error
   * #441. The toast it raised was gone before anyone looked, and the dialog
   * just sat there, so the error belongs in the dialog next to Continue.
   */
  it("shows a thrown create in the dialog and clears it on a retry", async () => {
    expectConsole("error", "Failed to create organization");
    createOrganizationWorkspaceActionMock
      .mockRejectedValueOnce(new Error("Minified React error #441"))
      .mockResolvedValueOnce({ ok: true, value: { organizationId: "org-1" } });
    const user = await submitDetails();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Errors.createFailed",
    );
    const next = screen.getByRole("button", { name: /Nav.next/i });
    expect(next).toBeEnabled();

    await user.click(next);

    expect(await screen.findByText("Logo.title")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledTimes(2);
  });
});
