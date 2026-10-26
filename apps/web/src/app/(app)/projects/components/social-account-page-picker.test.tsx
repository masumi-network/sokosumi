import type {
  ProjectSocialConnection,
  ProjectSocialConnectionPages,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addProjectSocialConnectionPage,
  listProjectSocialConnectionPages,
} from "@/lib/actions/project/action";
import messages from "../../../../../messages/en.json";
import { SocialAccountPagePicker } from "./social-account-page-picker";

vi.mock("@/lib/actions/project/action", () => ({
  addProjectSocialConnectionPage: vi.fn(),
  listProjectSocialConnectionPages: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const listMock = vi.mocked(listProjectSocialConnectionPages);
const addMock = vi.mocked(addProjectSocialConnectionPage);

const PERSON: ProjectSocialConnection = {
  id: "person-row",
  provider: "linkedin",
  externalHandle: null,
  displayName: "Ada Example",
  avatarUrl: null,
  subscriptionType: null,
  accountType: "personal",
  status: "active",
  connectedAt: new Date("2026-10-01T10:00:00.000Z"),
  disconnectedAt: null,
};

const PAGE_URN = "urn:li:organization:777";

function pages(
  value: Partial<ProjectSocialConnectionPages> = {},
): Awaited<ReturnType<typeof listProjectSocialConnectionPages>> {
  return {
    ok: true,
    value: {
      status: "available",
      pages: [
        {
          externalAccountId: PAGE_URN,
          name: "Example Company",
          handle: "example-company",
          logoUrl: null,
          socialConnectionId: null,
        },
      ],
      ...value,
    },
  };
}

function renderPicker(onAdded = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <SocialAccountPagePicker
          projectId="project-1"
          connection={PERSON}
          onOpenChange={vi.fn()}
          onAdded={onAdded}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onAdded };
}

describe("SocialAccountPagePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the personal profile while pages load", () => {
    listMock.mockReturnValue(new Promise(() => {}));
    renderPicker();

    expect(screen.getByRole("dialog", { name: "Post as" })).toBeVisible();
    expect(screen.getByText("Ada Example")).toBeVisible();
    expect(screen.getByText("Personal profile")).toBeVisible();
    expect(
      screen.getAllByTestId("social-account-page-skeleton"),
    ).not.toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your LinkedIn pages…",
    );
  });

  it("adds an administered page as its own account", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(pages());
    addMock.mockResolvedValue({
      ok: true,
      value: {
        ...PERSON,
        id: "page-row",
        displayName: "Example Company",
        accountType: "organization",
      },
    });
    const { onAdded } = renderPicker();

    const row = await screen.findByTestId(`social-account-page-${PAGE_URN}`);
    expect(within(row).getByText("Company page")).toBeVisible();
    await user.click(
      within(row).getByRole("button", { name: "Add Example Company" }),
    );

    expect(addMock).toHaveBeenCalledWith({
      projectId: "project-1",
      socialConnectionId: "person-row",
      externalAccountId: PAGE_URN,
    });
    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: "page-row" }),
      ),
    );
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).getByText("Added")).toBeVisible();
  });

  it("marks pages already in the project as added", async () => {
    listMock.mockResolvedValue(
      pages({
        pages: [
          {
            externalAccountId: PAGE_URN,
            name: "Example Company",
            handle: null,
            logoUrl: null,
            socialConnectionId: "page-row",
          },
        ],
      }),
    );
    renderPicker();

    const row = await screen.findByTestId(`social-account-page-${PAGE_URN}`);
    expect(within(row).getByText("Added")).toBeVisible();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("says so when the member administers no pages", async () => {
    listMock.mockResolvedValue(pages({ pages: [] }));
    renderPicker();

    expect(
      await screen.findByText("You don't administer any LinkedIn pages."),
    ).toBeVisible();
  });

  it("explains a missing LinkedIn permission", async () => {
    listMock.mockResolvedValue(
      pages({ status: "permission_missing", pages: [] }),
    );
    renderPicker();

    expect(
      await screen.findByTestId("social-account-page-permission-missing"),
    ).toHaveTextContent(
      "Posting as a company page needs extra LinkedIn permission.",
    );
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
  });

  it("offers a retry when the pages cannot load", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });
    listMock.mockResolvedValueOnce(pages());
    renderPicker();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't load your LinkedIn pages.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByTestId(`social-account-page-${PAGE_URN}`),
    ).toBeVisible();
  });
});
