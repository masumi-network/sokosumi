import type { Newsletter } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  upload: vi.fn(),
  loadBrand: vi.fn(),
}));
vi.mock("@/lib/actions/newsletter/action", () => ({
  saveNewsletterSettings: mocks.save,
}));
vi.mock("@/lib/actions/newsletter/design-md", () => ({
  loadNewsletterBrandFromDesignMd: mocks.loadBrand,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: mocks.upload,
  getUserFileUploadErrorMessage: (_error: unknown, fallback: string) =>
    fallback,
}));

import type { NewsletterDesignMdOption } from "./newsletter-design-md-picker";
import { NewsletterSettingsForm } from "./newsletter-settings-form";

const NEWSLETTER: Newsletter = {
  id: "n1",
  projectId: "p1",
  workspaceId: "w1",
  contactListId: null,
  name: "Weekly news",
  senderName: "Ada",
  replyTo: "ada@example.com",
  brand: {
    logoUrl: "https://example.com/news.png",
    primaryColor: "#123456",
    accentColor: "#abc",
    fontFamily: "Georgia",
    footerText: "Thanks for reading",
  },
  welcomeEmailEnabled: true,
  welcomeSubject: "Welcome aboard",
  welcomeBody: "Here is your weekly news.",
  publicSlug: "weekly-news-123",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const DESIGN_PICKER = en.App.Projects.Newsletter.DesignPicker;

function renderForm(
  newsletter: Newsletter | null = null,
  designMdOptions?: NewsletterDesignMdOption[],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewsletterSettingsForm
        projectId="p1"
        projectName="Launch"
        projectLogo="https://example.com/project.png"
        newsletter={newsletter}
        designMdOptions={designMdOptions}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ ok: true, value: NEWSLETTER });
});

describe("NewsletterSettingsForm", () => {
  it("preserves signup overrides when shared settings are saved", async () => {
    const signupForm = {
      accentColor: "#123456",
      buttonShape: "pill" as const,
      spacing: "compact" as const,
    };
    renderForm({ ...NEWSLETTER, brand: { ...NEWSLETTER.brand, signupForm } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({
          signupForm: expect.objectContaining(signupForm),
        }),
      }),
    );
  });

  it("prefills the project name and logo and validates before saving", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByLabelText("Newsletter name")).toHaveValue("Launch");
    expect(screen.getByLabelText("Sender name")).toHaveValue("Launch");
    expect(
      screen.getByRole("heading", { name: "Set up your newsletter" }),
    ).toBeInTheDocument();
    // The logo is an upload, not a URL field; the project logo is already set.
    expect(screen.queryByRole("textbox", { name: "Logo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Primary color")).toHaveTextContent("Default");
    expect(screen.getByText("From Launch")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Welcome email subject"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Reply-to email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("loads all saved fields without signup controls", () => {
    renderForm(NEWSLETTER);
    for (const [label, value] of [
      ["Newsletter name", NEWSLETTER.name],
      ["Sender name", NEWSLETTER.senderName],
      ["Reply-to email", NEWSLETTER.replyTo],
      ["Footer text", NEWSLETTER.brand.footerText],
      ["Welcome email subject", NEWSLETTER.welcomeSubject],
      ["Welcome email body", NEWSLETTER.welcomeBody],
    ] as const)
      expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(screen.getByLabelText("Primary color")).toHaveTextContent("#123456");
    expect(screen.getByLabelText("Accent color")).toHaveTextContent("#abc");
    expect(
      screen.queryByRole("heading", { name: "Set up your newsletter" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Font family" }),
    ).toHaveTextContent("Georgia");
    expect(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    ).toBeChecked();
    expect(
      screen.queryByRole("heading", { name: "Signup form" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Public archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: NEWSLETTER.publicSlug }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(NEWSLETTER.publicSlug),
    ).not.toBeInTheDocument();
  });

  it("uploads a logo and saves its public URL with the settings", async () => {
    const user = userEvent.setup();
    mocks.upload.mockResolvedValue({
      publicUrl: "https://cdn.example.com/new-logo.png",
    });
    const { container } = renderForm(NEWSLETTER);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input missing");
    await user.upload(
      input,
      new File(["logo"], "logo.png", { type: "image/png" }),
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(
      await screen.findByText("You have unsaved changes."),
    ).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        projectId: "p1",
        values: expect.objectContaining({
          logoUrl: "https://cdn.example.com/new-logo.png",
        }),
      }),
    );
  });

  it("clears the logo and a color to blank", async () => {
    const user = userEvent.setup();
    renderForm(NEWSLETTER);
    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Clear primary color" }),
    );
    expect(screen.getByLabelText("Primary color")).toHaveTextContent("Default");

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        projectId: "p1",
        values: expect.objectContaining({
          logoUrl: "",
          primaryColor: "",
          accentColor: "#abc",
        }),
      }),
    );
  });

  it("previews the welcome email while it is on", async () => {
    const user = userEvent.setup();
    renderForm(NEWSLETTER);
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent(NEWSLETTER.welcomeSubject ?? "");
    expect(preview).toHaveTextContent("Thanks for reading");
    await user.click(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    );
    expect(preview).not.toHaveTextContent(NEWSLETTER.welcomeSubject ?? "");
  });

  it("saves welcome content, shows a toast, and finishes setup", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(
      screen.getByLabelText("Reply-to email"),
      "TEAM@Example.com",
    );
    await user.click(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(screen.getByLabelText("Welcome email subject")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Welcome email body")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(mocks.save).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Welcome email subject"), "Hello");
    await user.type(
      screen.getByLabelText("Welcome email body"),
      "Welcome to our newsletter.",
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        projectId: "p1",
        values: expect.objectContaining({
          name: "Launch",
          senderName: "Launch",
          replyTo: "team@example.com",
          logoUrl: "https://example.com/project.png",
          welcomeEmailEnabled: true,
          welcomeSubject: "Hello",
          welcomeBody: "Welcome to our newsletter.",
        }),
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith("Newsletter settings saved");
    expect(mocks.refresh).toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Set up your newsletter" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Signup form" }),
    ).not.toBeInTheDocument();
  });

  it("preserves welcome text when the welcome email is toggled off and on", async () => {
    const user = userEvent.setup();
    renderForm(NEWSLETTER);
    await user.click(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    );
    expect(
      screen.queryByLabelText("Welcome email body"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    );
    expect(screen.getByLabelText("Welcome email body")).toHaveValue(
      NEWSLETTER.welcomeBody,
    );
  });

  it("shows server field errors and keeps edits for retry", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({
      ok: false,
      error: {
        message: "Check the highlighted fields and save again.",
        fieldErrors: { replyTo: ["Enter a valid email address."] },
      },
    });
    renderForm(NEWSLETTER);
    await user.clear(screen.getByLabelText("Sender name"));
    await user.type(screen.getByLabelText("Sender name"), "New sender");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the highlighted fields and save again.",
    );
    expect(screen.getByLabelText("Reply-to email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Sender name")).toHaveValue("New sender");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("keeps values after an unexpected action failure", async () => {
    const user = userEvent.setup();
    mocks.save.mockRejectedValue(new Error("Connection closed"));
    renderForm(NEWSLETTER);
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Failed to save newsletter settings. Try again.",
    );
    expect(screen.getByLabelText("Newsletter name")).toHaveValue(
      NEWSLETTER.name,
    );
  });

  describe("design picker", () => {
    const OPTIONS: NewsletterDesignMdOption[] = [
      { source: "workspace", label: "Acme" },
      { source: "project", label: "Launch" },
    ];

    async function choose(option: string) {
      const user = userEvent.setup();
      await user.click(
        screen.getByRole("combobox", { name: DESIGN_PICKER.label }),
      );
      await user.click(screen.getByRole("option", { name: option }));
      return user;
    }

    it("shows nothing when there is no design to pick", () => {
      renderForm(NEWSLETTER, []);
      expect(screen.queryByText(DESIGN_PICKER.label)).toBeNull();
    });

    it("fills only what the design names, as an unsaved edit the user can tweak", async () => {
      mocks.loadBrand.mockResolvedValue({
        ok: true,
        value: {
          primaryColor: "#cc0000",
          fontFamily: "Verdana",
          logoUrl: "https://cdn.example.com/acme.png",
        },
      });
      renderForm(NEWSLETTER, OPTIONS);
      const user = await choose("Launch");

      expect(mocks.loadBrand).toHaveBeenCalledWith({
        projectId: "p1",
        source: "project",
      });
      await waitFor(() =>
        expect(screen.getByLabelText("Primary color")).toHaveTextContent(
          "#cc0000",
        ),
      );
      expect(
        screen.getByRole("combobox", { name: "Font family" }),
      ).toHaveTextContent("Verdana");
      // Not in the design, so still the saved values.
      expect(screen.getByLabelText("Accent color")).toHaveTextContent("#abc");
      expect(screen.getByLabelText("Footer text")).toHaveValue(
        "Thanks for reading",
      );
      expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
      expect(mocks.save).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole("button", { name: "Clear primary color" }),
      );
      await user.click(screen.getByRole("button", { name: "Save settings" }));
      await waitFor(() =>
        expect(mocks.save).toHaveBeenCalledWith({
          projectId: "p1",
          values: expect.objectContaining({
            primaryColor: "",
            accentColor: "#abc",
            fontFamily: "Verdana",
            logoUrl: "https://cdn.example.com/acme.png",
          }),
        }),
      );
    });

    it("can apply the same design again over later tweaks", async () => {
      mocks.loadBrand.mockResolvedValue({
        ok: true,
        value: { primaryColor: "#cc0000" },
      });
      renderForm(NEWSLETTER, OPTIONS);
      const user = await choose("Acme");
      await waitFor(() =>
        expect(screen.getByLabelText("Primary color")).toHaveTextContent(
          "#cc0000",
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("combobox", { name: DESIGN_PICKER.label }),
        ).toHaveTextContent(DESIGN_PICKER.placeholder),
      );
      await user.click(
        screen.getByRole("button", { name: "Clear primary color" }),
      );
      await choose("Acme");
      await waitFor(() =>
        expect(screen.getByLabelText("Primary color")).toHaveTextContent(
          "#cc0000",
        ),
      );
      expect(mocks.loadBrand).toHaveBeenCalledTimes(2);
    });

    it("blocks a second pick while one is loading", async () => {
      let finish: (value: unknown) => void = () => undefined;
      mocks.loadBrand.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      renderForm(NEWSLETTER, OPTIONS);
      await choose("Acme");
      const trigger = screen.getByRole("combobox", {
        name: DESIGN_PICKER.label,
      });
      expect(trigger).toBeDisabled();
      expect(trigger).toHaveAttribute("aria-busy", "true");
      finish({ ok: true, value: { primaryColor: "#cc0000" } });
      await waitFor(() => expect(trigger).toBeEnabled());
    });

    it.each([
      [
        "the action fails",
        () =>
          mocks.loadBrand.mockResolvedValue({
            ok: false,
            error: { message: DESIGN_PICKER.error },
          }),
        DESIGN_PICKER.error,
      ],
      [
        "the request breaks",
        () => mocks.loadBrand.mockRejectedValue(new Error("Connection closed")),
        DESIGN_PICKER.error,
      ],
      [
        "the design names nothing",
        () => mocks.loadBrand.mockResolvedValue({ ok: true, value: {} }),
        DESIGN_PICKER.empty,
      ],
    ])("keeps the form as it is when %s", async (_name, arrange, message) => {
      arrange();
      renderForm(NEWSLETTER, OPTIONS);
      await choose("Acme");
      await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(message));
      expect(screen.getByLabelText("Primary color")).toHaveTextContent(
        "#123456",
      );
      expect(screen.queryByText("You have unsaved changes.")).toBeNull();
    });
  });

  it.each([
    ["de", de],
    ["es", es],
  ] as const)(
    "uses %s labels and validation messages",
    async (locale, messages) => {
      const user = userEvent.setup();
      const copy = messages.App.Projects.Newsletter;
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NewsletterSettingsForm
            projectId="p1"
            projectName="Launch"
            projectLogo={null}
            newsletter={null}
          />
        </NextIntlClientProvider>,
      );
      await user.click(screen.getByRole("button", { name: copy.save }));
      expect(
        await screen.findByText(copy.Validation.email),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(copy.fields.replyTo)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  );
});
