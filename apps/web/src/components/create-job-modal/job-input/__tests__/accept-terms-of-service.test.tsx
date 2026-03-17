import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { AcceptTermsOfService } from "@/components/create-job-modal/job-input/accept-terms-of-service";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

describe("AcceptTermsOfService", () => {
  it("renders DPA in the legal link order when present", () => {
    render(
      <AcceptTermsOfService
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: "https://example.com/dpa.pdf",
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["termsOfService", "privacyPolicy", "dpa", "legal"],
    );
  });

  it("omits DPA when it is missing", () => {
    render(
      <AcceptTermsOfService
        legal={{
          terms: "https://example.com/terms",
          privacyPolicy: "https://example.com/privacy",
          dpa: null,
          other: "https://example.com/legal",
        }}
      />,
    );

    expect(
      screen.getAllByRole("link").map((link) => link.textContent),
    ).toEqual(["termsOfService", "privacyPolicy", "legal"]);
    expect(screen.queryByText("dpa")).not.toBeInTheDocument();
  });
});
