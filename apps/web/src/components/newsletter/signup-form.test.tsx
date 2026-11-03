import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("@/lib/actions/newsletter/signup", () => ({
  subscribeToNewsletter: mocks.subscribe,
}));

import { NewsletterSignupForm } from "./signup-form";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewsletterSignupForm slug={PUBLIC_NEWSLETTER_SLUG} />
    </NextIntlClientProvider>,
  );
}

async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), "reader@example.com");
  await user.click(screen.getByRole("checkbox"));
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.subscribe.mockResolvedValue({
    ok: true,
    value: { status: "check_your_inbox" },
  });
});

describe("NewsletterSignupForm", () => {
  it("validates email and explicit consent before subscribing and focuses the first error", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(
      await screen.findByText(en.PublicNewsletter.Signup.invalidEmail),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.PublicNewsletter.Signup.consentRequired),
    ).toBeInTheDocument();
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(email).toHaveFocus());
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("submits optional name and hidden honeypot, then announces confirmation without another submit button", async () => {
    const { container } = renderForm();
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).not.toBeVisible();
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(
      screen.queryByRole("textbox", { name: "Website" }),
    ).not.toBeInTheDocument();
    const user = await fillForm();
    await user.type(screen.getByLabelText("Name (optional)"), "Ada");
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        en.PublicNewsletter.Signup.success,
      ),
    );
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith({
      slug: PUBLIC_NEWSLETTER_SLUG,
      values: {
        email: "reader@example.com",
        name: "Ada",
        consent: true,
        website: "",
      },
    });
    expect(
      screen.queryByRole("button", { name: "Subscribe" }),
    ).not.toBeInTheDocument();
  });

  it("shows server email errors beside the input and retains values for retry", async () => {
    mocks.subscribe.mockResolvedValue({
      ok: false,
      error: {
        message: en.PublicNewsletter.Signup.invalidEmail,
        fieldErrors: {
          email: [en.PublicNewsletter.Signup.invalidEmail],
          name: [en.PublicNewsletter.Signup.invalidName],
        },
      },
    });
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.PublicNewsletter.Signup.invalidEmail,
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "reader@example.com",
    );
    expect(screen.getByLabelText("Email address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Email address")).toHaveFocus();
  });

  it("shows rate limiting and permits a retry", async () => {
    mocks.subscribe.mockResolvedValueOnce({
      ok: false,
      error: { message: en.PublicNewsletter.Signup.rateLimit },
    });
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.PublicNewsletter.Signup.rateLimit,
    );
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        en.PublicNewsletter.Signup.success,
      ),
    );
  });

  it("keeps the submit label while pending and prevents duplicate submissions", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.subscribe.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderForm();
    const user = await fillForm();
    const button = screen.getByRole("button", { name: "Subscribe" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Subscribe");
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ ok: true, value: { status: "check_your_inbox" } });
    });
  });

  it("preserves the form after an unexpected action failure", async () => {
    mocks.subscribe.mockRejectedValue(new Error("Connection lost"));
    renderForm();
    const user = await fillForm();
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      en.PublicNewsletter.Signup.error,
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "reader@example.com",
    );
  });

  it.each([
    ["de", de],
    ["es", es],
  ] as const)(
    "renders translated %s labels, validation and confirmation",
    async (locale, messages) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NewsletterSignupForm slug={PUBLIC_NEWSLETTER_SLUG} />
        </NextIntlClientProvider>,
      );
      const user = userEvent.setup();
      const copy = messages.PublicNewsletter;
      await user.click(screen.getByRole("button", { name: copy.subscribe }));
      expect(
        await screen.findByText(copy.Signup.invalidEmail),
      ).toBeInTheDocument();
      await user.type(
        screen.getByLabelText(copy.Signup.email),
        "reader@example.com",
      );
      await user.click(
        screen.getByRole("checkbox", { name: copy.Signup.consent }),
      );
      await user.click(screen.getByRole("button", { name: copy.subscribe }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          copy.Signup.success,
        ),
      );
    },
  );

  it("keeps signup and settings message paths in parity across all shipped locales", () => {
    for (const messages of [de, es]) {
      expect(Object.keys(messages.PublicNewsletter.Signup).sort()).toEqual(
        Object.keys(en.PublicNewsletter.Signup).sort(),
      );
      expect(
        Object.keys(messages.App.Projects.Newsletter.SignupForm).sort(),
      ).toEqual(Object.keys(en.App.Projects.Newsletter.SignupForm).sort());
      expect(messages.PublicNewsletter.Signup.consent).not.toBe(
        en.PublicNewsletter.Signup.consent,
      );
      expect(messages.App.Projects.Newsletter.SignupForm.description).not.toBe(
        en.App.Projects.Newsletter.SignupForm.description,
      );
    }
  });
});
