import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { JobDetailsFooter } from "@/components/jobs/job-details/job-details-footer";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("JobDetailsFooter", () => {
  it("renders DPA alongside the existing legal links", () => {
    render(
      <JobDetailsFooter
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: "https://example.com/dpa.pdf",
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["termsAndConditions", "privacyPolicy", "dpa", "customerSupport"],
    );
  });

  it("omits DPA when the link is not present", () => {
    render(
      <JobDetailsFooter
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: null,
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(screen.queryByText("dpa")).not.toBeInTheDocument();
  });
});
