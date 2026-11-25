import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CropForSocial } from "@/app/drive/components/crop-for-social";

const upload = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: upload,
  isDriveFileUploadDuplicate: (error: unknown) =>
    error instanceof Error && error.message === "duplicate",
}));

const drawImage = vi.fn();

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ pathname: "p", fileUrl: null });
  toast.success.mockReset();
  toast.error.mockReset();
  drawImage.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
  ) {
    callback(new Blob(["x"], { type: type ?? "image/png" }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderCrop(name = "Team photo.jpg", mimeType: string | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CropForSocial
        pathname={`drive/orgs/org_1/Launch/${name}`}
        name={name}
        mimeType={mimeType}
        store={{ scope: "org", organizationId: "org_1" }}
      />
    </QueryClientProvider>,
  );
}

/** Opens the dialog and loads a 2000 x 1000 image into it. */
async function openWithWideImage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "open" }));
  const image = screen.getByRole("img", { name: "Team photo.jpg" });
  Object.defineProperty(image, "naturalWidth", { value: 2000 });
  Object.defineProperty(image, "naturalHeight", { value: 1000 });
  fireEvent.load(image);
  return image;
}

describe("CropForSocial", () => {
  it("offers nothing for an image it cannot crop", () => {
    renderCrop("logo.svg");
    expect(screen.queryByRole("button", { name: "open" })).toBeNull();
  });

  it("reads the image through the authorized same-origin route", async () => {
    const user = userEvent.setup();
    renderCrop();
    const image = await openWithWideImage(user);
    expect(image).toHaveAttribute(
      "src",
      "/api/drive/content?pathname=drive%2Forgs%2Forg_1%2FLaunch%2FTeam+photo.jpg",
    );
  });

  it("moves the frame with the keyboard and saves that crop beside the original", async () => {
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);

    const frame = screen.getByRole("slider", { name: "frameLabel" });
    expect(frame).toHaveAttribute("aria-valuenow", "50");
    frame.focus();
    await user.keyboard("{Home}");
    expect(frame).toHaveAttribute("aria-valuenow", "0");

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1000,
      1000,
      0,
      0,
      1000,
      1000,
    );
    const [file, options] = upload.mock.calls[0] ?? [];
    expect((file as File).name).toBe("Team photo-1x1.jpg");
    expect((file as File).type).toBe("image/jpeg");
    expect(options).toEqual({
      scope: "org",
      organizationId: "org_1",
      folder: "Launch",
    });
    expect(toast.success).toHaveBeenCalledWith("saved:Team photo-1x1.jpg");
  });

  it("crops to the chosen shape", async () => {
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);

    await user.click(screen.getByRole("radio", { name: /shapes.story.name/ }));
    expect(
      screen.getByText("result:Team photo-9x16.jpg,563,1000"),
    ).toBeVisible();
  });

  it("says when a file with the copy's name already exists", async () => {
    upload.mockRejectedValue(new Error("duplicate"));
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("duplicate:Team photo-1x1.jpg"),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
