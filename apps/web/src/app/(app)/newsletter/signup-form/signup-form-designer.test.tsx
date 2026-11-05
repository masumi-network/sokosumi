import type { Newsletter } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type AbstractIntlMessages,
  createTranslator,
  NextIntlClientProvider,
} from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  newsletterBrandFromValues,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";
import { NewsletterSignupDesigner } from "./signup-form-designer";

const mocks = vi.hoisted(() => ({ save: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/actions/newsletter/action", () => ({
  saveNewsletterSettings: mocks.save,
}));
vi.mock("@/lib/actions/newsletter/signup", () => ({
  subscribeToNewsletter: mocks.subscribe,
}));
vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: vi.fn(),
  getUserFileUploadErrorMessage: (_error: unknown, fallback: string) =>
    fallback,
}));
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_SOKOSUMI_URL: "https://preview.example.com",
  }),
}));

const BRANDED: Newsletter = {
  ...NEWSLETTER,
  brand: {
    ...NEWSLETTER.brand,
    accentColor: "#abcdef",
    buttonTextColor: "#111111",
    buttonShape: "pill",
    headerAlign: "center",
    spacing: "roomy",
  },
};
const VALIDATION_MESSAGES: AbstractIntlMessages = en;

function renderDesigner(
  newsletter = BRANDED,
  locale: "en" | "de" | "es" = "en",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ en, de, es }[locale]}>
      <NewsletterSignupDesigner
        newsletter={newsletter}
        projectId={NEWSLETTER_PROJECT_ID}
      />
    </NextIntlClientProvider>,
  );
}

function previewButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-newsletter-signup] button[type=submit]",
  );
  if (!button) throw new Error("Missing preview button");
  return button;
}

async function setColor(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string,
) {
  await user.click(screen.getByLabelText(label));
  const input = screen.getByPlaceholderText("#000000");
  await user.clear(input);
  await user.type(input, value);
  await user.keyboard("{Escape}");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ ok: true, value: BRANDED });
});

describe("newsletter signup designer", () => {
  it("uses shared design by default and previews unsaved overrides in both formats", async () => {
    const user = userEvent.setup();
    const { container } = renderDesigner();
    expect(
      screen.getByRole("button", { name: "Shared newsletter design" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#abcdef",
      color: "#111111",
    });
    expect(previewButton(container)).toHaveClass("rounded-full");
    await setColor(user, "Button color", "#123456");
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    expect(mocks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Newsletter signup" }));
    expect(
      container.querySelector("[data-newsletter-embed]"),
    ).toBeInTheDocument();
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    expect(
      container.querySelector("[data-newsletter-signup] form"),
    ).toHaveAttribute("inert");
    expect(container.querySelector("form form")).toBeNull();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("saves through existing newsletter settings and reloads the same design", async () => {
    const user = userEvent.setup();
    const { container, unmount } = renderDesigner();
    await setColor(user, "Button color", "#123456");
    await user.click(screen.getByRole("button", { name: "Save design" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
      values: expect.objectContaining({
        name: BRANDED.name,
        senderName: BRANDED.senderName,
        replyTo: BRANDED.replyTo,
        accentColor: "#abcdef",
        welcomeEmailEnabled: false,
        signupForm: expect.objectContaining({ accentColor: "#123456" }),
      }),
    });
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    const values = newsletterSettingsSchema(
      createTranslator({
        locale: "en",
        messages: VALIDATION_MESSAGES,
        namespace: "App.Projects.Newsletter.Validation",
      }),
    ).parse(mocks.save.mock.calls[0][0].values);
    unmount();
    const reloaded = renderDesigner({
      ...BRANDED,
      brand: newsletterBrandFromValues(values),
    });
    expect(previewButton(reloaded.container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    expect(screen.getByLabelText("Button color")).toHaveTextContent("#123456");
  });

  it("keeps explicit overrides through shared edits and resets them to the current shared brand", async () => {
    const user = userEvent.setup();
    const { container } = renderDesigner({
      ...BRANDED,
      brand: {
        ...BRANDED.brand,
        signupForm: {
          accentColor: "#123456",
          buttonShape: "square",
          spacing: "compact",
        },
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Shared newsletter design" }),
    );
    await setColor(user, "Accent color", "#fedcba");
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    expect(previewButton(container)).toHaveClass("rounded-none");
    await user.click(
      screen.getByRole("button", { name: "Reset to shared design" }),
    );
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#fedcba",
    });
    expect(previewButton(container)).toHaveClass("rounded-full");
    expect(previewButton(container).closest("form")).toHaveClass("space-y-6");
    await user.click(screen.getByRole("button", { name: "Save design" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][0].values.signupForm).toEqual({
      accentColor: "",
      buttonTextColor: "",
      buttonShape: "",
      headerAlign: "",
      spacing: "",
    });
  });

  it("previews layout overrides and returns one choice to shared without clearing the others", async () => {
    const user = userEvent.setup();
    const { container } = renderDesigner();
    const copy = en.App.Projects.Newsletter;
    for (const [label, option] of [
      [copy.fields.buttonShape, copy.Design.buttonShape.square],
      [copy.fields.headerAlign, copy.Design.headerAlign.left],
      [copy.fields.spacing, copy.Design.spacing.compact],
    ] as const) {
      await user.click(screen.getByRole("combobox", { name: label }));
      await user.click(screen.getByRole("option", { name: option }));
    }
    expect(previewButton(container)).toHaveClass("rounded-none");
    expect(previewButton(container).closest("form")).toHaveClass("space-y-3");
    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "Subscribe to Project news",
      }).parentElement,
    ).not.toHaveClass("text-center");
    await user.click(
      screen.getByRole("combobox", { name: copy.fields.buttonShape }),
    );
    await user.click(
      screen.getByRole("option", { name: copy.SignupForm.useShared }),
    );
    expect(previewButton(container)).toHaveClass("rounded-full");
    expect(previewButton(container).closest("form")).toHaveClass("space-y-3");
  });

  it("keeps edits on a failed save and lets the author discard them", async () => {
    const user = userEvent.setup();
    mocks.save.mockResolvedValue({
      ok: false,
      error: { message: en.App.Projects.Newsletter.error },
    });
    const { container } = renderDesigner();
    await setColor(user, "Button color", "#123456");
    await user.click(screen.getByRole("button", { name: "Save design" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.App.Projects.Newsletter.error,
    );
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#123456",
    });
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(previewButton(container)).toHaveStyle({
      backgroundColor: "#abcdef",
    });
  });

  it.each(["de", "es"] as const)(
    "renders translated %s customization and preview controls",
    (locale) => {
      renderDesigner(BRANDED, locale);
      const copy = { de, es }[locale].App.Projects.Newsletter.SignupForm;
      expect(
        screen.getByRole("heading", { name: copy.customize }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: copy.embedTitle }),
      ).toBeInTheDocument();
      expect(screen.getByText(copy.previewNote)).toBeInTheDocument();
    },
  );
});
