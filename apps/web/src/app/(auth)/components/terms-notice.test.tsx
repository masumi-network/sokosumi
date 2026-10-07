import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import TermsNotice from "./terms-notice";

vi.mock("next-intl", () => ({
  useTranslations: () => ({
    rich: (
      _key: string,
      tags: Record<string, (chunks: ReactNode) => ReactNode>,
    ) => (
      <>
        {tags.terms("Terms of Service")} {tags.privacy("Privacy Policy")}
      </>
    ),
  }),
}));

describe("TermsNotice", () => {
  it("links to the Terms of Service and the Privacy Policy", () => {
    render(<TermsNotice />);

    expect(
      screen.getByRole("link", { name: "Terms of Service" }),
    ).toHaveAttribute("href", "https://www.sokosumi.com/terms-of-service");
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "https://www.sokosumi.com/privacy-policy");
  });
});
