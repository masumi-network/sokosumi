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
}));
vi.mock("@/lib/actions/newsletter/action", () => ({
  saveNewsletterSettings: mocks.save,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

import { NewsletterSettingsForm } from "./newsletter-settings-form";

const NEWSLETTER: Newsletter = {
  id: "n1",
  projectId: "p1",
  workspaceId: "w1",
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

function renderForm(newsletter: Newsletter | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewsletterSettingsForm
        projectId="p1"
        projectName="Launch"
        projectLogo="https://example.com/project.png"
        newsletter={newsletter}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ ok: true, value: NEWSLETTER });
});

describe("NewsletterSettingsForm", () => {
  it("prefills the project name and logo and validates before saving", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByLabelText("Newsletter name")).toHaveValue("Launch");
    expect(screen.getByLabelText("Sender name")).toHaveValue("Launch");
    expect(screen.getByLabelText("Logo URL")).toHaveValue(
      "https://example.com/project.png",
    );
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

  it("loads all saved fields and displays the public address as text", () => {
    renderForm(NEWSLETTER);
    for (const [label, value] of [
      ["Newsletter name", NEWSLETTER.name],
      ["Sender name", NEWSLETTER.senderName],
      ["Reply-to email", NEWSLETTER.replyTo],
      ["Logo URL", NEWSLETTER.brand.logoUrl],
      ["Primary color", NEWSLETTER.brand.primaryColor],
      ["Accent color", NEWSLETTER.brand.accentColor],
      ["Footer text", NEWSLETTER.brand.footerText],
      ["Welcome email subject", NEWSLETTER.welcomeSubject],
      ["Welcome email body", NEWSLETTER.welcomeBody],
    ] as const)
      expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(
      screen.getByRole("combobox", { name: "Font family" }),
    ).toHaveTextContent("Georgia");
    expect(
      screen.getByRole("switch", { name: "Send a welcome email" }),
    ).toBeChecked();
    expect(screen.getByText(NEWSLETTER.publicSlug)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Public archive" }),
    ).toHaveAttribute("href", `/n/${NEWSLETTER.publicSlug}/archive`);
    expect(
      screen.queryByRole("link", { name: NEWSLETTER.publicSlug }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(NEWSLETTER.publicSlug),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ] as const)(
    "rejects HTTP logos with an inline HTTPS error in %s before saving",
    async (locale, messages) => {
      const user = userEvent.setup();
      const copy = messages.App.Projects.Newsletter;
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NewsletterSettingsForm
            projectId="p1"
            projectName="Launch"
            projectLogo={null}
            newsletter={NEWSLETTER}
          />
        </NextIntlClientProvider>,
      );
      await user.clear(screen.getByLabelText(copy.fields.logoUrl));
      await user.type(
        screen.getByLabelText(copy.fields.logoUrl),
        "http://example.com/logo.png",
      );
      await user.click(screen.getByRole("button", { name: copy.save }));

      expect(await screen.findByText(copy.Validation.url)).toBeInTheDocument();
      expect(screen.getByLabelText(copy.fields.logoUrl)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it("saves welcome content, shows a toast, and displays the new public address", async () => {
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
    expect(screen.getByText(NEWSLETTER.publicSlug)).toBeInTheDocument();
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
