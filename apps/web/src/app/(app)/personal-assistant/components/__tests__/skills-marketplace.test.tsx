import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SkillsMarketplace from "../skills-marketplace";

const { toastErrorMock, searchSkillsMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  searchSkillsMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.raw = (_key: string) => ({});
    return t;
  },
  useFormatter: () => ({
    number: (n: number) => String(n),
  }),
}));

vi.mock("@/lib/actions/hermes", () => ({
  getSkillDetailAction: vi.fn(),
  installSkillAction: vi.fn(),
  removeSkillAction: vi.fn(),
  searchSkillsAction: (...args: unknown[]) => searchSkillsMock(...args),
}));

const MARKETPLACE_URL = "/api/personal-assistant/skills-marketplace";

function catalogItem(
  overrides: { skillId?: string; slug?: string; name?: string } = {},
) {
  return {
    skillId: overrides.skillId ?? "skill-1",
    source: "skills-sh",
    slug: overrides.slug ?? "seo-kit",
    name: overrides.name ?? "SEO Kit",
    description: "Helps with SEO",
    installs: 100,
    curated: true,
  };
}

function okMarketplaceResponse(
  data: {
    marketing?: ReturnType<typeof catalogItem>[];
    installed?: unknown[];
    preinstalled?: unknown[];
  } = {},
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        marketing: data.marketing ?? [catalogItem()],
        installed: data.installed ?? [],
        preinstalled: data.preinstalled ?? [],
      },
    }),
  };
}

function failedMarketplaceResponse(status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ error: "Internal Server Error" }),
  };
}

describe("SkillsMarketplace", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toastErrorMock.mockReset();
    searchSkillsMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the marketing shelf after a successful catalog load", async () => {
    fetchMock.mockResolvedValue(okMarketplaceResponse());

    render(<SkillsMarketplace variant="onboarding" active />);

    expect(await screen.findByText("SEO Kit")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      MARKETPLACE_URL,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows inline unavailable + Retry on failed catalog load without toasting", async () => {
    fetchMock.mockResolvedValue(failedMarketplaceResponse());

    render(<SkillsMarketplace variant="onboarding" active={false} />);

    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("manual Retry re-fetches the catalog", async () => {
    // Keep inactive so the one-shot auto-retry does not consume the
    // second mock before the user clicks Retry.
    fetchMock
      .mockResolvedValueOnce(failedMarketplaceResponse())
      .mockResolvedValueOnce(okMarketplaceResponse());

    const user = userEvent.setup();
    render(<SkillsMarketplace variant="onboarding" active={false} />);

    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "retry" }));

    expect(await screen.findByText("SEO Kit")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("auto-retries once when becoming active after a failed hidden pre-warm", async () => {
    fetchMock
      .mockResolvedValueOnce(failedMarketplaceResponse())
      .mockResolvedValueOnce(okMarketplaceResponse());

    const { rerender } = render(
      <SkillsMarketplace variant="onboarding" active={false} />,
    );

    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<SkillsMarketplace variant="onboarding" active />);

    expect(await screen.findByText("SEO Kit")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not auto-retry-loop when the second load also fails", async () => {
    fetchMock.mockResolvedValue(failedMarketplaceResponse());

    const { rerender } = render(
      <SkillsMarketplace variant="onboarding" active={false} />,
    );

    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();

    rerender(<SkillsMarketplace variant="onboarding" active />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Stay on error UI; no further automatic retries after the one-shot.
    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown fetch as loadError without hanging the spinner", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    render(<SkillsMarketplace variant="settings" active />);

    expect(await screen.findByText("emptyCatalog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
    expect(screen.queryByText("title…")).not.toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
