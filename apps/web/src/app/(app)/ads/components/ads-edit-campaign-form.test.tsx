import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdCampaign, editAdCampaign } from "@/lib/actions/ads/action";
import {
  EMPTY_GOOGLE_VALUES,
  type GoogleFormValues,
} from "@/lib/ads/google-form-values";
import type { GoogleTargeting } from "@/lib/ads/targeting";
import messages from "../../../../../messages/en.json";
import { EditGoogleCampaignForm } from "./ads-campaign-form";

const { pushMock, toastSuccessMock, uploadMock, sizes } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadMock: vi.fn(),
  /** Natural sizes by file name; the browser reads them from the pixels. */
  sizes: new Map<string, { width: number; height: number }>(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/actions/ads/action", () => ({
  createAdCampaign: vi.fn(),
  editAdCampaign: vi.fn(),
  listAdMarketKeywords: vi.fn(),
  searchAdLocations: vi.fn(),
}));
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME: 0 }),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { session: { activeOrganizationId: "org-1" } } }),
}));
vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: () => null,
}));
vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: (...args: unknown[]) => uploadMock(...args),
  isDriveFileUploadDuplicate: () => false,
}));
vi.mock("@/lib/ads/image-size.client", () => {
  const read = (name: string) => {
    const size = sizes.get(name);
    return size ? Promise.resolve(size) : Promise.reject(new Error("unread"));
  };
  return {
    readFileImageSize: (file: File) => read(file.name),
    readImageSize: (url: string) => read(url.split("/").pop() ?? ""),
  };
});

const editMock = vi.mocked(editAdCampaign);
const createMock = vi.mocked(createAdCampaign);

const DETAILS_HREF =
  "/ads/campaigns/42?projectId=project-1&accountId=account-1&range=7d";

const TARGETING: GoogleTargeting = {
  languageOptions: [
    { id: "1000", name: "English" },
    { id: "1001", name: "German" },
  ],
  defaultLocations: [{ id: "2276", name: "Germany" }],
  defaultLanguages: [{ id: "1000", name: "English" }],
};

const SEARCH_VALUES: GoogleFormValues = {
  ...EMPTY_GOOGLE_VALUES,
  type: "SEARCH",
  name: "Spring sale",
  dailyBudget: "25.5",
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  locations: [
    { id: "1003854", name: "Munich", detail: "Munich, Bavaria, Germany" },
  ],
  languages: [{ id: "1001", name: "German" }],
  finalUrl: "https://example.com/shoes",
  keywords: 'running shoes\n"trail shoes"',
  path1: "shoes",
  headlines: ["One", "Two", "Three"],
  descriptions: ["First text", "Second text"],
};

const KEPT_LANDSCAPE = {
  assetId: "a1",
  role: "LANDSCAPE" as const,
  url: "https://tpc.googlesyndication.com/a1.png",
};
const KEPT_SQUARE = {
  assetId: "a2",
  role: "SQUARE" as const,
  url: "https://tpc.googlesyndication.com/a2.png",
};

const DISPLAY_VALUES: GoogleFormValues = {
  ...EMPTY_GOOGLE_VALUES,
  type: "DISPLAY",
  name: "Autumn display",
  dailyBudget: "10",
  finalUrl: "https://example.com/shoes",
  businessName: "Acme",
  displayHeadlines: ["Free returns"],
  longHeadline: "Shoes for every run",
  displayDescriptions: ["Order today"],
  images: [KEPT_LANDSCAPE, KEPT_SQUARE],
};

function tree(
  initialValues: GoogleFormValues,
  started: boolean,
  mode: "visible" | "hidden" = "visible",
) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <Activity mode={mode}>
        <EditGoogleCampaignForm
          accountId="account-1"
          campaignId="42"
          currency="USD"
          detailsHref={DETAILS_HREF}
          hasMarketProfile={false}
          initialValues={initialValues}
          projectId="project-1"
          started={started}
          targeting={TARGETING}
        />
      </Activity>
    </NextIntlClientProvider>
  );
}

function renderEdit(initialValues: GoogleFormValues, started = false) {
  const user = userEvent.setup({ applyAccept: false });
  const view = render(tree(initialValues, started));
  return { user, ...view };
}

const nameInput = () => screen.getByLabelText("Name");
const save = () => screen.getByRole("button", { name: "Save changes" });
const sent = () => editMock.mock.calls[0]?.[0];

function refused(status?: number, message = "Core text") {
  return {
    ok: false as const,
    error: { code: "INTERNAL_SERVER_ERROR", message, status },
  };
}

describe("EditGoogleCampaignForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sizes.clear();
    sizes.set("wide.png", { width: 1200, height: 628 });
    uploadMock.mockImplementation(async (file: File) => ({
      pathname: `drive/users/u1/${file.name}`,
      fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/u1/${file.name}`,
    }));
  });

  it("starts from the campaign, not from the Market profile's suggestions", () => {
    renderEdit(SEARCH_VALUES);

    expect(nameInput()).toHaveValue("Spring sale");
    expect(screen.getByLabelText("Daily budget (USD)")).toHaveValue(25.5);
    expect(screen.getByLabelText("End date")).toHaveValue("2026-11-30");
    expect(screen.getByLabelText("Final URL")).toHaveValue(
      "https://example.com/shoes",
    );
    expect(screen.getByRole("textbox", { name: "Keywords" })).toHaveValue(
      'running shoes\n"trail shoes"',
    );
    expect(screen.getByLabelText("Headline 3")).toHaveValue("Three");
    expect(screen.getByText("Munich")).toBeVisible();
    expect(screen.queryByText("Germany")).toBeNull();
  });

  it("tells the type without letting it change", () => {
    renderEdit(SEARCH_VALUES);

    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Search")).toBeVisible();
    expect(
      screen.getByText("Text ads on Google Search results."),
    ).toBeVisible();
  });

  it("says saving sends the ad back to review, and offers Save changes and Cancel", () => {
    renderEdit(SEARCH_VALUES);

    expect(
      screen.getByText("Saving sends the ad back to Google's review."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create campaign" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      DETAILS_HREF,
    );
  });

  describe("the start date", () => {
    it("is read-only once the campaign started, still focusable, and says why", async () => {
      const { user } = renderEdit(SEARCH_VALUES, true);
      const startDate = screen.getByLabelText("Start date");

      expect(startDate).toHaveAttribute("readonly");
      expect(startDate).toBeEnabled();
      expect(startDate).toHaveValue("2026-11-01");
      expect(startDate).toHaveAccessibleDescription(
        "The start date can't change once a campaign has started.",
      );
      await user.tab({ shift: true });
      await user.click(startDate);
      expect(startDate).toHaveFocus();
    });

    it("can change before", () => {
      renderEdit(SEARCH_VALUES, false);

      expect(screen.getByLabelText("Start date")).not.toHaveAttribute(
        "readonly",
      );
      expect(screen.queryByText(/can't change once/)).toBeNull();
    });
  });

  describe("saving a Search campaign", () => {
    it("sends the campaign to the edit action and goes back to its details", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user } = renderEdit(SEARCH_VALUES);
      await user.type(nameInput(), "!");

      await user.click(save());

      await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
      expect(sent()).toEqual({
        projectId: "project-1",
        accountId: "account-1",
        campaignId: "42",
        name: "Spring sale!",
        dailyBudget: 25.5,
        google: {
          type: "SEARCH",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          locationIds: ["1003854"],
          languageIds: ["1001"],
          finalUrl: "https://example.com/shoes",
          keywords: [
            { text: "running shoes", matchType: "BROAD" },
            { text: "trail shoes", matchType: "PHRASE" },
          ],
          headlines: ["One", "Two", "Three"],
          descriptions: ["First text", "Second text"],
          path1: "shoes",
        },
      });
      expect(createMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith("Campaign updated");
      expect(pushMock).toHaveBeenCalledWith(DETAILS_HREF);
    });

    it("leaves a locked start date out, so Core keeps it", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user } = renderEdit(SEARCH_VALUES, true);

      await user.click(save());

      await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
      expect(sent()?.google).not.toHaveProperty("startDate");
      expect(sent()?.google).toHaveProperty("endDate", "2026-11-30");
    });

    it("leaves the end date out once it is cleared", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user } = renderEdit(SEARCH_VALUES);
      await user.clear(screen.getByLabelText("End date"));

      await user.click(save());

      await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
      expect(sent()?.google).not.toHaveProperty("endDate");
    });

    it("judges the fields like a new campaign does", async () => {
      const { user } = renderEdit(SEARCH_VALUES);
      await user.clear(nameInput());

      await user.click(save());

      expect(await screen.findByText("Enter a name.")).toBeVisible();
      expect(editMock).not.toHaveBeenCalled();
    });

    it("shows Google's message on 422 and keeps the input", async () => {
      editMock.mockResolvedValue(refused(422, "Destination not working."));
      const { user } = renderEdit(SEARCH_VALUES);
      await user.type(nameInput(), "!");

      await user.click(save());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Failed to save changes");
      expect(alert).toHaveTextContent("Destination not working.");
      expect(nameInput()).toHaveValue("Spring sale!");
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("says the campaign can't be edited here when Core says it is not editable", async () => {
      editMock.mockResolvedValue(refused(409, "Campaign can't be edited here"));
      const { user } = renderEdit(SEARCH_VALUES);

      await user.click(save());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("This campaign can't be edited here.");
      expect(
        within(alert).queryByRole("link", { name: "Go to accounts" }),
      ).toBeNull();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("asks to reconnect on any other 409, such as an inactive connection", async () => {
      editMock.mockResolvedValue(refused(409, "Ad connection is not active"));
      const { user } = renderEdit(SEARCH_VALUES);

      await user.click(save());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Reconnect this account in Accounts");
      expect(
        within(alert).getByRole("link", { name: "Go to accounts" }),
      ).toHaveAttribute("href", "/ads?projectId=project-1&tab=accounts");
      expect(alert).not.toHaveTextContent("can't be edited here");
    });

    it.each([[undefined], [502]])(
      "shows a generic message for a Core failure (status %s)",
      async (status) => {
        editMock.mockResolvedValue(refused(status));
        const { user } = renderEdit(SEARCH_VALUES);

        await user.click(save());

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Failed to save changes");
        expect(alert).not.toHaveTextContent("Core text");
      },
    );

    it("shows the generic message when the action throws", async () => {
      editMock.mockRejectedValue(new Error("network"));
      const { user } = renderEdit(SEARCH_VALUES);

      await user.click(save());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Failed to save changes",
      );
    });
  });

  describe("a Display campaign", () => {
    const tile = (name: string) =>
      within(screen.getByRole("img", { name }).closest("li") as HTMLElement);

    it("shows its images, kept, with their roles", () => {
      renderEdit(DISPLAY_VALUES);

      expect(
        tile("Current image (Landscape)").getByText("Landscape"),
      ).toBeVisible();
      expect(
        screen.getByRole("img", { name: "Current image (Landscape)" }),
      ).toHaveAttribute("src", KEPT_LANDSCAPE.url);
      expect(
        screen.getByRole("img", { name: "Current image (Square)" }),
      ).toBeVisible();
      expect(
        screen.getByText("Landscape 1 · Square 1 · 2 of 6 images"),
      ).toBeVisible();
      expect(screen.getByLabelText("Business name")).toHaveValue("Acme");
    });

    it("sends the images it kept as asset and role", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user } = renderEdit(DISPLAY_VALUES, true);

      await user.click(save());

      await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
      expect(sent()?.google).toEqual({
        type: "DISPLAY",
        locationIds: [],
        languageIds: [],
        finalUrl: "https://example.com/shoes",
        businessName: "Acme",
        headlines: ["Free returns"],
        longHeadline: "Shoes for every run",
        descriptions: ["Order today"],
        images: [
          { assetId: "a1", role: "LANDSCAPE" },
          { assetId: "a2", role: "SQUARE" },
        ],
      });
    });

    it("removes a kept image and sends a new one beside the other that stayed", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user } = renderEdit(DISPLAY_VALUES);

      await user.click(
        screen.getByRole("button", {
          name: "Remove Current image (Landscape)",
        }),
      );
      expect(
        screen.queryByRole("img", { name: "Current image (Landscape)" }),
      ).toBeNull();
      expect(
        screen.getByText("Add at least one landscape image."),
      ).toBeVisible();

      const file = new File(["x"], "wide.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 1000 });
      await user.upload(screen.getByLabelText("Image files"), file);
      await screen.findByRole("img", { name: "wide.png" });
      await user.click(save());

      await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
      expect(sent()?.google).toMatchObject({
        type: "DISPLAY",
        images: [
          { assetId: "a2", role: "SQUARE" },
          {
            pathname: "drive/users/u1/wide.png",
            fileUrl:
              "https://store.public.blob.vercel-storage.com/drive/users/u1/wide.png",
            name: "wide.png",
            size: 1000,
            mimeType: "image/png",
            role: "LANDSCAPE",
          },
        ],
      });
    });
  });

  describe("when Next shows the page again", () => {
    it("starts over from the campaign after a save", async () => {
      editMock.mockResolvedValue({ ok: true, value: undefined });
      const { user, rerender } = renderEdit(SEARCH_VALUES);
      await user.type(nameInput(), "!");
      await user.click(save());
      await waitFor(() => expect(pushMock).toHaveBeenCalled());

      rerender(tree(SEARCH_VALUES, false, "hidden"));
      rerender(tree(SEARCH_VALUES, false, "visible"));

      await waitFor(() => expect(nameInput()).toHaveValue("Spring sale"));
      expect(save()).not.toHaveAttribute("aria-busy", "true");
    });

    it("keeps a draft that was not sent", async () => {
      const { user, rerender } = renderEdit(SEARCH_VALUES);
      await user.type(nameInput(), "!");

      rerender(tree(SEARCH_VALUES, false, "hidden"));
      rerender(tree(SEARCH_VALUES, false, "visible"));

      expect(nameInput()).toHaveValue("Spring sale!");
    });
  });
});
