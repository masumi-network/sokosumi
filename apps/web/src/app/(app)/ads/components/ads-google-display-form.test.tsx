import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdCampaign } from "@/lib/actions/ads/action";
import type { GoogleTargeting } from "@/lib/ads/targeting";
import messages from "../../../../../messages/en.json";
import { GoogleCampaignForm } from "./ads-new-campaign-form";

const {
  pushMock,
  toastErrorMock,
  toastSuccessMock,
  uploadMock,
  sizes,
  pickState,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadMock: vi.fn(),
  /** Natural sizes by file name; the browser reads them from the pixels. */
  sizes: new Map<string, { width: number; height: number }>(),
  /** The Drive file the picker hands back when its button is pressed. */
  pickState: { file: null as null | Record<string, unknown> },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/actions/ads/action", () => ({
  createAdCampaign: vi.fn(),
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
  DriveFilePicker: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (file: Record<string, unknown>) => void;
  }) =>
    open ? (
      <button
        onClick={() => pickState.file && onSelect(pickState.file)}
        type="button"
      >
        Pick the Drive file
      </button>
    ) : null,
}));
vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: (...args: unknown[]) => uploadMock(...args),
  isDriveFileUploadDuplicate: (error: unknown) =>
    error instanceof Error && error.message === "duplicate",
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

const createMock = vi.mocked(createAdCampaign);

const LANGUAGES = [
  { id: "1000", name: "English" },
  { id: "1001", name: "German" },
];

const TARGETING: GoogleTargeting = {
  languageOptions: LANGUAGES,
  defaultLocations: [],
  defaultLanguages: [{ id: "1001", name: "German" }],
};

const BLOB = "https://store.public.blob.vercel-storage.com/drive/users/u1";

async function renderForm() {
  const user = userEvent.setup({ applyAccept: false });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GoogleCampaignForm
        accountId="account-1"
        currency="USD"
        hasMarketProfile={false}
        projectId="project-1"
        targeting={TARGETING}
      />
    </NextIntlClientProvider>,
  );
  return user;
}

type User = Awaited<ReturnType<typeof renderForm>>;

const typeOption = (name: "Search" | "Display") =>
  screen.getByRole("radio", { name });
const imageFiles = () => screen.getByLabelText("Image files");
const logoFiles = () => screen.getByLabelText("Logo files");

function pngFile(name: string, type = "image/png", bytes = 1000): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

/** Sizes the browser would read, then what Drive would answer for the upload. */
function knowImage(name: string, width: number, height: number) {
  sizes.set(name, { width, height });
}

const WIDE = "wide.png";
const SQUARE = "square.png";
const LOGO = "logo.png";

beforeEach(() => {
  vi.clearAllMocks();
  sizes.clear();
  pickState.file = null;
  knowImage(WIDE, 1200, 628);
  knowImage(SQUARE, 600, 600);
  knowImage(LOGO, 256, 256);
  uploadMock.mockImplementation(async (file: File) => ({
    pathname: `drive/users/u1/${file.name}`,
    fileUrl: `${BLOB}/${file.name}`,
  }));
});

async function chooseDisplay(user: User) {
  await user.click(typeOption("Display"));
}

async function uploadImages(user: User, ...files: File[]) {
  await user.upload(imageFiles(), files);
}

async function addMinimumImages(user: User) {
  await uploadImages(user, pngFile(WIDE), pngFile(SQUARE));
  await screen.findByRole("img", { name: SQUARE });
}

/** Everything a Display campaign needs but the images. */
async function fillDisplay(user: User) {
  await user.type(screen.getByLabelText("Name"), "  Spring sale ");
  await user.type(screen.getByLabelText("Daily budget (USD)"), "25.5");
  await user.type(screen.getByLabelText("Final URL"), "https://example.com/x");
  await user.type(screen.getByLabelText("Business name"), " Acme ");
  await user.type(screen.getByLabelText("Headline 1"), "Free returns");
  await user.type(
    screen.getByLabelText("Long headline"),
    "Shoes for every run",
  );
  await user.type(screen.getByLabelText("Description 1"), "Order today");
}

const submit = () => screen.getByRole("button", { name: "Create campaign" });

describe("Google Display form", () => {
  describe("type picker", () => {
    it("starts on Search and offers Search and Display", async () => {
      await renderForm();

      expect(typeOption("Search")).toBeChecked();
      expect(typeOption("Display")).not.toBeChecked();
      expect(screen.getByRole("heading", { name: "Type" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "Keywords" })).toBeVisible();
      expect(screen.queryByLabelText("Business name")).toBeNull();
    });

    it("swaps Keywords and the search ad for the display ad", async () => {
      const user = await renderForm();

      await chooseDisplay(user);

      expect(typeOption("Display")).toBeChecked();
      expect(screen.queryByRole("heading", { name: "Keywords" })).toBeNull();
      expect(screen.queryByLabelText("Path 1")).toBeNull();
      expect(screen.getByLabelText("Business name")).toBeVisible();
      expect(screen.getByLabelText("Long headline")).toBeVisible();
      expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(1);
      expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(1);
      expect(screen.getByText("Images")).toBeVisible();
      expect(screen.getByText("Logo")).toBeVisible();
    });

    it("keeps the shared values when the type changes, both ways", async () => {
      const user = await renderForm();
      await user.type(screen.getByLabelText("Name"), "Spring sale");
      await user.type(screen.getByLabelText("Daily budget (USD)"), "25");
      await user.type(screen.getByLabelText("Start date"), "2026-11-01");
      await user.type(screen.getByLabelText("End date"), "2026-11-30");
      await user.type(
        screen.getByLabelText("Final URL"),
        "https://example.com/x",
      );
      await user.type(screen.getByLabelText("Headline 1"), "Search headline");

      await chooseDisplay(user);

      expect(screen.getByLabelText("Name")).toHaveValue("Spring sale");
      expect(screen.getByLabelText("Daily budget (USD)")).toHaveValue(25);
      expect(screen.getByLabelText("Start date")).toHaveValue("2026-11-01");
      expect(screen.getByLabelText("End date")).toHaveValue("2026-11-30");
      expect(screen.getByLabelText("Final URL")).toHaveValue(
        "https://example.com/x",
      );
      expect(screen.getByText("German")).toBeVisible();
      // The Search ad's own texts stay out of the Display ad.
      expect(screen.getByLabelText("Headline 1")).toHaveValue("");

      await user.type(screen.getByLabelText("Headline 1"), "Display headline");
      await user.click(typeOption("Search"));

      expect(screen.getByLabelText("Name")).toHaveValue("Spring sale");
      expect(screen.getByLabelText("Final URL")).toHaveValue(
        "https://example.com/x",
      );
      expect(screen.getByLabelText("Headline 1")).toHaveValue(
        "Search headline",
      );
      expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(3);
    });

    it("keeps the chosen type when it is clicked again", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      await user.click(typeOption("Display"));

      expect(typeOption("Display")).toBeChecked();
      expect(screen.getByLabelText("Business name")).toBeVisible();
    });

    it("clears the refusals of the type it leaves", async () => {
      const user = await renderForm();
      await user.click(submit());
      expect(await screen.findByText("Enter a name.")).toBeVisible();

      await chooseDisplay(user);

      expect(screen.queryByText("Enter a name.")).toBeNull();
    });
  });

  describe("the ad", () => {
    it("counts business name, headlines, long headline and descriptions", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      expect(screen.getByLabelText("Business name")).toHaveValue("");
      await user.type(screen.getByLabelText("Business name"), "Acme");
      await user.type(screen.getByLabelText("Headline 1"), "Free returns");
      await user.type(screen.getByLabelText("Long headline"), "Shoes");
      await user.type(screen.getByLabelText("Description 1"), "Order today");

      expect(screen.getByText("4/25")).toBeVisible();
      expect(screen.getByText("12/30")).toBeVisible();
      expect(screen.getByText("5/90")).toBeVisible();
      expect(screen.getByText("11/90")).toBeVisible();
    });

    it("adds headlines and descriptions up to 5", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      for (let count = 1; count < 5; count += 1) {
        await user.click(screen.getByRole("button", { name: "Add headline" }));
        await user.click(
          screen.getByRole("button", { name: "Add description" }),
        );
      }

      expect(screen.getAllByLabelText(/^Headline \d+$/)).toHaveLength(5);
      expect(screen.getAllByLabelText(/^Description \d+$/)).toHaveLength(5);
      expect(screen.queryByRole("button", { name: "Add headline" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Add description" }),
      ).toBeNull();
    });

    it("refuses an empty business name and long headline on submit", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      await user.click(submit());

      expect(await screen.findByText("Enter the business name.")).toBeVisible();
      expect(screen.getByText("Enter a long headline.")).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("images", () => {
    it("uploads to the Workspace's Drive and shows each with its role", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      const wide = pngFile(WIDE);

      await uploadImages(user, wide, pngFile(SQUARE));

      expect(await screen.findByRole("img", { name: WIDE })).toBeVisible();
      expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
      expect(uploadMock).toHaveBeenCalledWith(wide, {
        scope: "org",
        organizationId: "org-1",
      });
      const tile = (name: string) =>
        within(screen.getByRole("img", { name }).closest("li") as HTMLElement);
      expect(tile(WIDE).getByText("Landscape")).toBeVisible();
      expect(tile(SQUARE).getByText("Square")).toBeVisible();
      expect(
        screen.getByText("Landscape 1 · Square 1 · 2 of 6 images"),
      ).toBeVisible();
      expect(screen.queryByText(/Add at least one/)).toBeNull();
    });

    it("says what is missing until there is a landscape and a square image", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      expect(
        screen.getByText("Add at least one landscape and one square image."),
      ).toBeVisible();

      await uploadImages(user, pngFile(WIDE));
      await screen.findByRole("img", { name: WIDE });
      expect(screen.getByText("Add at least one square image.")).toBeVisible();

      await uploadImages(user, pngFile(SQUARE));
      await screen.findByRole("img", { name: SQUARE });
      expect(screen.queryByText(/Add at least one/)).toBeNull();
    });

    it("tells a picture's role from its size, within 2% of 1.91:1 and 1:1", async () => {
      knowImage("near-wide.png", 1000, 514);
      knowImage("near-square.png", 500, 509);
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(
        user,
        pngFile("near-wide.png"),
        pngFile("near-square.png"),
      );

      await screen.findByRole("img", { name: "near-square.png" });
      expect(
        screen.getByText("Landscape 1 · Square 1 · 2 of 6 images"),
      ).toBeVisible();
    });

    it.each([
      ["a 4:3 photo", 1200, 900],
      ["a portrait", 600, 900],
    ])(
      "refuses %s with the ratios it needs, uploading nothing",
      async (_n, width, height) => {
        knowImage("photo.png", width, height);
        const user = await renderForm();
        await chooseDisplay(user);

        await uploadImages(user, pngFile("photo.png"));

        const message = await screen.findByText(/^photo\.png: use a landscape/);
        expect(message).toHaveTextContent("1.91:1");
        expect(message).toHaveTextContent("600 × 314");
        expect(message).toHaveTextContent("1:1");
        expect(message).toHaveTextContent("300 × 300");
        expect(uploadMock).not.toHaveBeenCalled();
        expect(screen.queryByRole("img", { name: "photo.png" })).toBeNull();
      },
    );

    it("refuses a picture under the minimum size", async () => {
      knowImage("tiny.png", 400, 209);
      knowImage("tiny-square.png", 200, 200);
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(user, pngFile("tiny.png"), pngFile("tiny-square.png"));

      expect(
        await screen.findByText(
          "tiny.png: landscape images need at least 600 × 314 px.",
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          "tiny-square.png: square images need at least 300 × 300 px.",
        ),
      ).toBeVisible();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("refuses a file over 5120 KB or of another type, before reading it", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(
        user,
        pngFile("huge.png", "image/png", 5 * 1024 * 1024 + 1),
        pngFile("photo.webp", "image/webp"),
      );

      expect(
        await screen.findByText("huge.png: use an image of at most 5 MB."),
      ).toBeVisible();
      expect(
        screen.getByText("photo.webp: use a JPEG, PNG or GIF image."),
      ).toBeVisible();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("refuses a picture it cannot read", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(user, pngFile("broken.png"));

      expect(
        await screen.findByText("broken.png: failed to read this image."),
      ).toBeVisible();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("does not add a picture when the upload fails, and says so", async () => {
      uploadMock.mockRejectedValue(new Error("down"));
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(user, pngFile(WIDE));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to upload the image",
        ),
      );
      expect(screen.queryByRole("img", { name: WIDE })).toBeNull();
    });

    it("points to Drive when a file with that name is already there", async () => {
      uploadMock.mockRejectedValue(new Error("duplicate"));
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(user, pngFile(WIDE));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "A file with this name already exists in your Drive. Choose it from Drive instead.",
        ),
      );
    });

    it("chooses a file from Drive, reading its size from the file", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      pickState.file = {
        name: SQUARE,
        size: 5000,
        pathname: `drive/users/u1/${SQUARE}`,
        fileUrl: `${BLOB}/${SQUARE}`,
        uploadedAt: new Date(),
      };

      await user.click(
        screen.getByRole("button", { name: "Choose images from Drive" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Pick the Drive file" }),
      );

      expect(await screen.findByRole("img", { name: SQUARE })).toBeVisible();
      expect(uploadMock).not.toHaveBeenCalled();
      expect(
        screen.getByText("Landscape 0 · Square 1 · 1 of 6 images"),
      ).toBeVisible();
    });

    it("refuses a Drive file of the wrong shape, and one already added", async () => {
      knowImage("photo.png", 1200, 900);
      const user = await renderForm();
      await chooseDisplay(user);
      const pick = async (name: string) => {
        pickState.file = {
          name,
          size: 5000,
          pathname: `drive/users/u1/${name}`,
          fileUrl: `${BLOB}/${name}`,
          uploadedAt: new Date(),
        };
        await user.click(
          screen.getByRole("button", { name: "Choose images from Drive" }),
        );
        await user.click(
          screen.getByRole("button", { name: "Pick the Drive file" }),
        );
      };

      await pick("photo.png");
      expect(
        await screen.findByText(/^photo\.png: use a landscape/),
      ).toBeVisible();

      await pick(WIDE);
      await screen.findByRole("img", { name: WIDE });
      await pick(WIDE);
      expect(
        await screen.findByText("wide.png is already added."),
      ).toBeVisible();
      expect(screen.getAllByRole("img", { name: WIDE })).toHaveLength(1);
    });

    it("stops at 6 landscape and square images", async () => {
      const names = Array.from({ length: 7 }, (_, i) => `square-${i}.png`);
      for (const name of names) knowImage(name, 600, 600);
      const user = await renderForm();
      await chooseDisplay(user);

      await uploadImages(user, ...names.map((name) => pngFile(name)));

      expect(
        await screen.findByText("Use at most 6 landscape and square images."),
      ).toBeVisible();
      expect(screen.getAllByRole("img")).toHaveLength(6);
      expect(uploadMock).toHaveBeenCalledTimes(6);
    });

    it("removes a picture", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      await addMinimumImages(user);

      await user.click(screen.getByRole("button", { name: "Remove wide.png" }));

      expect(screen.queryByRole("img", { name: WIDE })).toBeNull();
      expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
      expect(
        screen.getByText("Add at least one landscape image."),
      ).toBeVisible();
    });

    it("keeps the pictures when the type is switched away and back", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      await addMinimumImages(user);

      await user.click(typeOption("Search"));
      await user.click(typeOption("Display"));

      expect(screen.getByRole("img", { name: WIDE })).toBeVisible();
      expect(screen.getByRole("img", { name: SQUARE })).toBeVisible();
    });
  });

  describe("logos", () => {
    it("takes a square picture as a logo, apart from the images", async () => {
      const user = await renderForm();
      await chooseDisplay(user);

      await user.upload(logoFiles(), pngFile(LOGO));

      expect(await screen.findByRole("img", { name: LOGO })).toBeVisible();
      expect(screen.getByText("1 of 2 logos")).toBeVisible();
      // It is not a marketing image, so the ad still lacks those.
      expect(
        screen.getByText("Landscape 0 · Square 0 · 0 of 6 images"),
      ).toBeVisible();
      expect(
        screen.getByText("Add at least one landscape and one square image."),
      ).toBeVisible();
    });

    it("takes a 128 x 128 logo that a square image would refuse", async () => {
      knowImage("small-logo.png", 128, 128);
      const user = await renderForm();
      await chooseDisplay(user);

      await user.upload(logoFiles(), pngFile("small-logo.png"));

      expect(
        await screen.findByRole("img", { name: "small-logo.png" }),
      ).toBeVisible();
    });

    it("refuses a landscape picture as a logo, and a logo under 128 x 128", async () => {
      knowImage("small.png", 100, 100);
      const user = await renderForm();
      await chooseDisplay(user);

      await user.upload(logoFiles(), [pngFile(WIDE), pngFile("small.png")]);

      expect(
        await screen.findByText("wide.png: logos must be square (1:1)."),
      ).toBeVisible();
      expect(
        screen.getByText("small.png: logos need at least 128 × 128 px."),
      ).toBeVisible();
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it("stops at 2 logos", async () => {
      for (const name of ["a.png", "b.png", "c.png"]) knowImage(name, 256, 256);
      const user = await renderForm();
      await chooseDisplay(user);

      await user.upload(logoFiles(), [
        pngFile("a.png"),
        pngFile("b.png"),
        pngFile("c.png"),
      ]);

      expect(await screen.findByText("Use at most 2 logos.")).toBeVisible();
      expect(screen.getAllByRole("img")).toHaveLength(2);
    });
  });

  describe("submit", () => {
    const sentSpec = () => createMock.mock.calls[0]?.[0].google;

    it("blocks the submit and says what is missing, without a landscape or square image", async () => {
      const user = await renderForm();
      await chooseDisplay(user);
      await fillDisplay(user);
      await user.upload(imageFiles(), pngFile(SQUARE));
      await screen.findByRole("img", { name: SQUARE });

      await user.click(submit());

      expect(
        await screen.findByText("Add at least one landscape image."),
      ).toBeVisible();
      expect(createMock).not.toHaveBeenCalled();
    });

    it("sends the Display spec with the images and their roles", async () => {
      createMock.mockResolvedValue({ ok: true, value: { id: "42" } });
      const user = await renderForm();
      await chooseDisplay(user);
      await fillDisplay(user);
      await user.type(screen.getByLabelText("Start date"), "2026-11-01");
      await addMinimumImages(user);
      await user.upload(logoFiles(), pngFile(LOGO));
      await screen.findByRole("img", { name: LOGO });

      await user.click(submit());

      await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
      const image = (name: string, role: string, size = 1) => ({
        pathname: `drive/users/u1/${name}`,
        fileUrl: `${BLOB}/${name}`,
        name,
        size,
        mimeType: "image/png",
        role,
      });
      expect(createMock).toHaveBeenCalledWith({
        projectId: "project-1",
        accountId: "account-1",
        name: "Spring sale",
        dailyBudget: 25.5,
        google: {
          type: "DISPLAY",
          startDate: "2026-11-01",
          locationIds: [],
          languageIds: ["1001"],
          finalUrl: "https://example.com/x",
          businessName: "Acme",
          headlines: ["Free returns"],
          longHeadline: "Shoes for every run",
          descriptions: ["Order today"],
          images: [
            image(WIDE, "LANDSCAPE", 1000),
            image(SQUARE, "SQUARE", 1000),
            image(LOGO, "LOGO", 1000),
          ],
        },
      });
      expect(sentSpec()).not.toHaveProperty("keywords");
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Campaign created (paused)",
      );
      expect(pushMock).toHaveBeenCalled();
    });

    it("shows Google's refusal above the form and keeps the images", async () => {
      createMock.mockResolvedValue({
        ok: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: 'Image "wide.png": Image is too small.',
          status: 422,
        },
      });
      const user = await renderForm();
      await chooseDisplay(user);
      await fillDisplay(user);
      await addMinimumImages(user);

      await user.click(submit());

      expect(
        await screen.findByText('Image "wide.png": Image is too small.'),
      ).toBeVisible();
      expect(screen.getByRole("img", { name: WIDE })).toBeVisible();
      expect(screen.getByLabelText("Business name")).toHaveValue(" Acme ");
    });
  });
});
