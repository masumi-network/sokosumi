import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LEGAL_URLS } from "@/lib/constants/legal-urls";

import { LegalLinks } from "./legal-links";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("LegalLinks", () => {
  it("lists every policy in one order, each opening in a new tab", () => {
    render(<LegalLinks />);

    const links = screen.getAllByRole("link");
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["termsOfServices", LEGAL_URLS.TERMS_OF_SERVICE],
      ["privacyPolicy", LEGAL_URLS.PRIVACY_POLICY],
      ["imprint", LEGAL_URLS.IMPRINT],
      ["acceptableUse", LEGAL_URLS.ACCEPTABLE_USE],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("gives each link a target at least 24px tall", () => {
    render(<LegalLinks />);

    // WCAG 2.5.8: a bare text-sm link is 20px tall on a phone.
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("min-h-6");
    }
  });
});
