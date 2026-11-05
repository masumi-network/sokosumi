import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_SOKOSUMI_URL: "https://preview.example.com",
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { NewsletterSignupCard } from "./newsletter-signup-card";

const clipboard = vi.fn();
const SIGNUP_URL = `https://preview.example.com/n/${PUBLIC_NEWSLETTER_SLUG}`;
beforeEach(() => {
  vi.clearAllMocks();
  clipboard.mockResolvedValue(undefined);
});

describe("NewsletterSignupCard", () => {
  it("opens the hosted page and copies the URL and iframe code separately", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NewsletterSignupCard publicSlug={PUBLIC_NEWSLETTER_SLUG} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Signup form" }),
    ).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open signup page" });
    expect(open).toHaveAttribute("href", SIGNUP_URL);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    const hosted = screen.getByRole("region", { name: "Hosted signup page" });
    expect(within(hosted).getByText(SIGNUP_URL)).toBeInTheDocument();
    await user.click(within(hosted).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith(SIGNUP_URL));
    const embed = screen.getByRole("region", { name: "Embed code" });
    await user.click(within(embed).getByRole("button", { name: "Copy" }));
    const snippet = within(embed).getByText(/<iframe/).textContent;
    await waitFor(() => expect(clipboard).toHaveBeenLastCalledWith(snippet));
    expect(snippet).toContain(`src="${SIGNUP_URL}/embed"`);
    expect(snippet).toContain('title="Newsletter signup"');
    expect(snippet).toContain('width="100%"');
    expect(
      screen.getByRole("link", { name: "Public archive" }),
    ).toHaveAttribute("href", `/n/${PUBLIC_NEWSLETTER_SLUG}/archive`);
  });

  it.each([
    ["de", de],
    ["es", es],
  ] as const)(
    "uses real %s settings copy and an accessible iframe title",
    (locale, messages) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <NewsletterSignupCard publicSlug={PUBLIC_NEWSLETTER_SLUG} />
        </NextIntlClientProvider>,
      );
      const copy = messages.App.Projects.Newsletter.SignupForm;
      expect(
        screen.getByRole("heading", { name: copy.title }),
      ).toBeInTheDocument();
      expect(screen.getByText(copy.description)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: copy.open })).toHaveAttribute(
        "href",
        SIGNUP_URL,
      );
      expect(screen.getByText(/<iframe/)).toHaveTextContent(
        `title="${copy.embedTitle}"`,
      );
    },
  );

  it("encodes slug characters in both destinations", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NewsletterSignupCard publicSlug={'news/"&'} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Open signup page" }),
    ).toHaveAttribute("href", "https://preview.example.com/n/news%2F%22%26");
    expect(screen.getByText(/<iframe/)).toHaveTextContent(
      'src="https://preview.example.com/n/news%2F%22%26/embed"',
    );
  });
});
