import type { PublicNewsletter } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { PUBLIC_NEWSLETTER, PUBLIC_NEWSLETTER_SLUG } from "@/test/newsletter";
import { NewsletterSignup } from "./signup";

const subscribe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/newsletter/signup", () => ({
  subscribeToNewsletter: subscribe,
}));

const BRAND: PublicNewsletter["brand"] = {
  primaryColor: "#123456",
  accentColor: "#abcdef",
  backgroundColor: "#f4f4f4",
  buttonTextColor: "#111111",
  fontFamily: "Georgia",
  logoUrl: "https://example.com/logo.png",
  headerImageUrl: "https://example.com/header.png",
  buttonShape: "pill",
  headerAlign: "center",
  spacing: "roomy",
};

function view(brand = BRAND, embed = false, preview = false) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <NewsletterSignup
        newsletter={{ ...PUBLIC_NEWSLETTER, brand }}
        slug={PUBLIC_NEWSLETTER_SLUG}
        embed={embed}
        preview={preview}
      />
    </NextIntlClientProvider>
  );
}

describe("branded newsletter signup", () => {
  it.each([false, true])(
    "uses the shared brand on the hosted page and embed (embed: %s)",
    (embed) => {
      const { container } = render(view(BRAND, embed));
      const surface = container.querySelector("[data-newsletter-signup]");
      expect(surface).toHaveStyle({
        backgroundColor: BRAND.backgroundColor,
        fontFamily: "Georgia",
      });
      expect(surface?.firstElementChild).toHaveStyle({
        color: BRAND.primaryColor,
      });
      expect(surface?.firstElementChild).toHaveClass("p-11");
      const button = screen.getByRole("button", { name: "Subscribe" });
      expect(button).toHaveStyle({
        backgroundColor: BRAND.accentColor,
        color: BRAND.buttonTextColor,
      });
      expect(button).toHaveClass("rounded-full");
      expect(button.closest("form")).toHaveClass("space-y-6");
      expect(
        container.querySelector(`img[src="${BRAND.logoUrl}"]`),
      ).toBeInTheDocument();
      expect(
        container.querySelector(`img[src="${BRAND.headerImageUrl}"]`),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 1 }).parentElement,
      ).toHaveClass("text-center");
    },
  );

  it("changes only chosen fields and falls back to subsequent shared edits when overrides are removed", () => {
    const brand: PublicNewsletter["brand"] = {
      ...BRAND,
      signupForm: {
        accentColor: "#fedcba",
        buttonShape: "square",
        spacing: "compact",
      },
    };
    const { container, rerender } = render(view(brand));
    expect(screen.getByRole("button", { name: "Subscribe" })).toHaveStyle({
      backgroundColor: "#fedcba",
      color: BRAND.buttonTextColor,
    });
    expect(screen.getByRole("button", { name: "Subscribe" })).toHaveClass(
      "rounded-none",
    );
    expect(
      container.querySelector("[data-newsletter-signup]")?.firstElementChild,
    ).toHaveClass("p-5");
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveClass(
      "text-center",
    );
    rerender(view({ ...brand, accentColor: "#eeeeee", signupForm: {} }));
    expect(screen.getByRole("button", { name: "Subscribe" })).toHaveStyle({
      backgroundColor: "#eeeeee",
    });
    expect(screen.getByRole("button", { name: "Subscribe" })).toHaveClass(
      "rounded-full",
    );
    expect(
      container.querySelector("[data-newsletter-signup]")?.firstElementChild,
    ).toHaveClass("p-11");
    expect(BRAND.accentColor).toBe("#abcdef");
  });

  it("makes preview forms inert and never subscribes even on a programmatic submit", () => {
    const { container } = render(view(BRAND, false, true));
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("inert");
    if (!form) throw new Error("Missing preview form");
    fireEvent.submit(form);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
