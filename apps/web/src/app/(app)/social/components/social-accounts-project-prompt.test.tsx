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
  openProjectScope: vi.fn(),
  openScopeCreate: vi.fn(),
  setScopeCreateOpen: vi.fn(),
  hasAnyScopeProject: vi.fn(),
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
  usePrefetchScopeProjects: () => () => undefined,
  useHasAnyScopeProject: mocks.hasAnyScopeProject,
}));
vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: mocks.openProjectScope,
  openScopeCreate: mocks.openScopeCreate,
  setScopeCreateOpen: mocks.setScopeCreateOpen,
}));

/** What the prompt asked the header's selector for, most recently. */
function lastRequest(): {
  required?: boolean;
  reason?: string;
  onSelect?: (projectId: string) => void;
} {
  const request = mocks.openProjectScope.mock.lastCall?.[0];
  if (!request) throw new Error("The project selector was not opened");
  return request;
}

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
  mocks.hasAnyScopeProject.mockReturnValue({
    isPending: false,
    hasProjects: true,
  });
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
    ).toEqual(["X", "Instagram", "LinkedIn", "Facebook", "YouTube", "TikTok"]);
    expect(within(primary).getAllByText("Coming soon")).toHaveLength(1);
    expect(within(primary).getAllByText("Personal profile")).toHaveLength(1);
  });

  it("asks to choose a project before connecting", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Choose a project" }),
    ).toBeVisible();
    expect(screen.getByText("Then connect accounts.")).toBeVisible();
  });

  it("keeps the selector closed in an empty workspace and seeds a required create request", async () => {
    const user = userEvent.setup();
    mocks.hasAnyScopeProject.mockReturnValue({
      isPending: false,
      hasProjects: false,
    });
    setup();
    expect(mocks.openProjectScope).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Create project" });
    await user.click(button);

    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Then connect accounts.",
    });
    expect(mocks.openScopeCreate).toHaveBeenCalledExactlyOnceWith(button);
    expect(mocks.openProjectScope.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openScopeCreate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("opens only the selector when Select project is clicked with autoOpen disabled", async () => {
    const user = userEvent.setup();
    setup({ autoOpen: false });
    expect(mocks.openProjectScope).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Select project" });
    await user.click(button);

    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Then connect accounts.",
    });
    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(mocks.openScopeCreate).not.toHaveBeenCalled();
  });

  it.each(["accounts", "drafts", "attention"] as const)(
    "shows Select project on %s without opening the selector on navigation",
    (kind) => {
      setup({ kind });

      expect(
        screen.getByRole("button", { name: "Select project" }),
      ).toBeVisible();
      expect(mocks.openProjectScope).not.toHaveBeenCalled();
      expect(mocks.openScopeCreate).not.toHaveBeenCalled();
    },
  );

  it("opens the selector on arrival when explicitly requested", () => {
    setup({ autoOpen: true });
    expect(mocks.openProjectScope).toHaveBeenCalledOnce();
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Then connect accounts.",
    });
    expect(screen.queryByTestId("project-scope-select-button")).toBeNull();
  });

  it.each(["accounts", "drafts", "attention"] as const)(
    "shows a Create project button on %s in an empty workspace without opening the selector",
    (kind) => {
      mocks.hasAnyScopeProject.mockReturnValue({
        isPending: false,
        hasProjects: false,
      });
      setup({ kind });
      expect(
        screen.getByRole("button", { name: "Create project" }),
      ).toBeVisible();
      expect(mocks.openProjectScope).not.toHaveBeenCalled();
    },
  );

  it("uses the selected project to open its Accounts tab", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Select project" }));

    expect(lastRequest().required).toBe(true);
    lastRequest().onSelect?.("marketing");

    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=accounts",
    );
    // No list of its own: the header's selector is the only one.
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
        "Instagram",
        "LinkedIn",
        "Facebook",
        "YouTube",
        "TikTok",
      ]);
    }
    expect(within(primary).getByText("TikTok")).toBeVisible();
    expect(within(primary).getAllByText("Coming soon")).toHaveLength(1);
    for (const provider of SOCIAL_PROVIDERS) {
      const name = within(primary).getByText(provider.name);
      expect(name).toBeVisible();
      const card = name.parentElement;
      expect(card).not.toBeNull();
      if (!card) throw new Error("Platform card is missing");
      if (!SOCIAL_PUBLIC_PROVIDERS.some((id) => id === provider.id)) {
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
    expect(screen.getByTestId("social-post-fan")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Select project" }));
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Choose a project to see and finish its drafts.",
    });
    lastRequest().onSelect?.("marketing");
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
    expect(screen.getByTestId("social-post-fan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select project" }));
    expect(lastRequest()).toMatchObject({
      required: true,
      reason: "Choose a project to see posts that failed or were missed.",
    });
    lastRequest().onSelect?.("marketing");
    expect(mocks.push).toHaveBeenCalledWith(
      "/social?projectId=marketing&tab=attention",
    );
  });

  it("keeps an unavailable-project notice as the reason when selecting a project", async () => {
    const user = userEvent.setup();
    setup({
      notice: "That project is no longer available. Choose another project.",
    });
    expect(
      screen.getByText(/That project is no longer available/),
    ).toBeVisible();
    expect(mocks.openProjectScope).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Select project" }));

    expect(lastRequest().reason).toBe(
      "That project is no longer available. Choose another project.",
    );
  });
});
