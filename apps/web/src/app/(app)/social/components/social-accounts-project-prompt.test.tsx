import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectSocialProvider } from "@sokosumi/core-client";
import {
  SOCIAL_BETA_ORGANIZATION_SLUG,
  SOCIAL_PUBLIC_PROVIDERS,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { SocialProviderAvailabilityProvider } from "@/contexts/social-provider-availability-context";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScope: () => ({
    projectId: null,
    switchHref: (id: string) => `/social?projectId=${id}`,
  }),
}));
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useScopeProjects: () => ({
    projects: [{ id: "marketing", name: "Marketing", logo: null }],
    pinnedIds: new Set(),
    isSearching: false,
    isPending: false,
    isSearchPending: false,
    isError: false,
    hasMore: false,
  }),
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden />,
}));

import { SocialAccountsProjectPrompt } from "./social-accounts-project-prompt";

const here = dirname(fileURLToPath(import.meta.url));

function setup(
  props: Parameters<typeof SocialAccountsProjectPrompt>[0] = {},
  enabledProviders: readonly ProjectSocialProvider[] = SOCIAL_PUBLIC_PROVIDERS,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialProviderAvailabilityProvider enabledProviders={enabledProviders}>
        <SocialAccountsProjectPrompt {...props} />
      </SocialProviderAvailabilityProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SocialAccountsProjectPrompt", () => {
  it("shows Coming soon badges in the utxo workspace with no project selected", () => {
    setup(
      {},
      socialProvidersForWorkspace({
        organizationSlug: SOCIAL_BETA_ORGANIZATION_SLUG,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Choose a project" }),
    ).toBeVisible();
    const primary = screen
      .getByRole("region", { name: "Social platforms" })
      .querySelector("ul");
    if (!primary) throw new Error("Primary platform track is missing");
    expect(
      [...primary.querySelectorAll("li p")].map((name) => name.textContent),
    ).toEqual(["X", "LinkedIn", "YouTube", "TikTok", "Instagram", "Facebook"]);
    expect(within(primary).getAllByText("Coming soon")).toHaveLength(3);
    expect(within(primary).getAllByText("Personal profile")).toHaveLength(1);
  });

  it("asks to choose a project before connecting", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Choose a project" }),
    ).toBeVisible();
    expect(screen.getByText("Then connect accounts.")).toBeVisible();
  });

  it("chooses a real project and opens its Accounts tab", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.queryByTestId("project-scope-workspace")).toBeNull();
    await user.click(screen.getByRole("option", { name: "Marketing" }));

    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=accounts",
    );
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("loops platforms once for readers and pauses on hover, focus, or touch", () => {
    setup();
    const region = screen.getByRole("region", { name: "Social platforms" });
    const tracks = region.querySelectorAll("ul");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.children).toHaveLength(SOCIAL_PROVIDERS.length);
    expect(tracks[1]?.children).toHaveLength(SOCIAL_PROVIDERS.length);
    expect(tracks[1]).toHaveAttribute("aria-hidden", "true");
    expect(tracks[1]).toHaveAttribute("inert");

    const primary = tracks[0];
    if (!primary) {
      throw new Error("Primary platform track is missing");
    }
    for (const track of tracks) {
      expect(
        [...track.querySelectorAll("li p")].map((name) => name.textContent),
      ).toEqual([
        "X",
        "LinkedIn",
        "YouTube",
        "TikTok",
        "Instagram",
        "Facebook",
      ]);
    }
    expect(within(primary).getByText("TikTok")).toBeVisible();
    expect(within(primary).getAllByText("Coming soon")).toHaveLength(3);
    for (const provider of SOCIAL_PROVIDERS) {
      const name = within(primary).getByText(provider.name);
      expect(name).toBeVisible();
      const card = name.parentElement;
      expect(card).not.toBeNull();
      if (!card) throw new Error("Platform card is missing");
      if (["tiktok", "instagram", "facebook"].includes(provider.id)) {
        expect(within(card).getByText("Coming soon")).toHaveAttribute(
          "data-slot",
          "badge",
        );
      } else {
        expect(within(card).queryByText("Coming soon")).toBeNull();
      }
    }
    expect(screen.getAllByText("TikTok")).toHaveLength(2);

    expect(
      screen.getByRole("button", { name: "Pause platforms" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next platforms" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Previous platforms" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Choose a project" }),
    ).toHaveClass("min-h-11");

    const marquee = tracks[0]?.parentElement;
    expect(marquee).toHaveClass("motion-safe:animate-social-platform-marquee");
    expect(marquee).toHaveClass(
      "motion-safe:[@media(hover:hover)]:group-hover:[animation-play-state:paused]",
    );
    expect(marquee).toHaveClass(
      "motion-safe:group-focus-within:[animation-play-state:paused]",
    );
    expect(marquee).toHaveClass(
      "motion-safe:group-active:[animation-play-state:paused]",
    );
    expect(tracks[1]).toHaveClass("motion-reduce:hidden");

    const scroller = screen.getByTestId("social-platform-marquee-track");
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveClass("overflow-x-auto");
    expect(scroller).toHaveClass("motion-safe:overflow-x-hidden");
    expect(scroller.querySelectorAll("li")).toHaveLength(
      SOCIAL_PROVIDERS.length * 2,
    );
    expect(
      [...scroller.querySelectorAll(".from-background")].length,
    ).toBeGreaterThanOrEqual(2);

    const globals = readFileSync(
      join(here, "../../../../app/globals.css"),
      "utf8",
    );
    expect(globals).toMatch(
      /--animate-social-platform-marquee:\s*auth-logo-marquee 40s linear infinite/,
    );
    expect(globals).toMatch(
      /@keyframes auth-logo-marquee\s*{[\s\S]*?translate3d\(-50%,\s*0,\s*0\)/,
    );
  });

  it("keeps Drafts as the destination and hides the account carousel", async () => {
    const user = userEvent.setup();
    setup({ kind: "drafts" });
    expect(
      screen.queryByRole("region", { name: "Social platforms" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    await user.click(screen.getByRole("option", { name: "Marketing" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=drafts",
    );
  });

  it("keeps Needs attention as the destination and hides the account carousel", async () => {
    const user = userEvent.setup();
    setup({ kind: "attention" });
    expect(
      screen.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Choose a project to see posts that failed or were missed.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Social platforms" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Choose a project" }));
    await user.click(screen.getByRole("option", { name: "Marketing" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=attention",
    );
  });

  it("keeps an unavailable-project notice and provides a replacement picker", () => {
    setup({
      notice: "That project is no longer available. Choose another project.",
    });
    expect(
      screen.getByText(/That project is no longer available/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose a project" }),
    ).toBeVisible();
  });
});
