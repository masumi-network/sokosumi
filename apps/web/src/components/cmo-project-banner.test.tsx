import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderBanner() {
  vi.resetModules();
  const { CmoProjectBanner } = await import("./cmo-project-banner");
  render(<CmoProjectBanner projectId="project-1" />);
  return screen.getByRole("link", { name: /open/ });
}

describe("CmoProjectBanner", () => {
  it("says CMO manages the Project and opens it in CMO in a new tab", async () => {
    vi.stubEnv("NEXT_PUBLIC_CMO_APP_URL", undefined);
    const link = await renderBanner();

    expect(screen.getByText("title")).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "https://app.cmo.xyz/?project=project-1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("uses NEXT_PUBLIC_CMO_APP_URL when it is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_CMO_APP_URL", "https://cmo.example.com");
    const link = await renderBanner();

    expect(link).toHaveAttribute(
      "href",
      "https://cmo.example.com/?project=project-1",
    );
  });
});
