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
  useFormatter: () => ({
    number: (value: number) => `${Math.round(value * 100)} %`,
  }),
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

function renderCrop(name = "Team photo.jpg", sizeBytes: number | null = 2048) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CropForSocial
        pathname={`drive/organizations/org_1/Launch/${name}`}
        name={name}
        mimeType={null}
        sizeBytes={sizeBytes}
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
      "/api/drive/content?pathname=drive%2Forganizations%2Forg_1%2FLaunch%2FTeam+photo.jpg",
    );
  });

  it("saves the chosen crop beside the original", async () => {
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);

    const position = screen.getByRole("slider", { name: "positionX" });
    expect(position).toHaveValue("50");
    expect(position).toHaveAttribute("aria-valuetext", "50 %");
    // The browser's own range input handles keys; this sets where they end.
    fireEvent.change(position, { target: { value: "0" } });
    expect(position).toHaveValue("0");

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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "open" })).toHaveFocus(),
    );
  });

  it("places the crop by tapping or dragging the photo", async () => {
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);
    // Square on 2000 x 1000: the frame is half the photo, which shows 200 px wide.
    const stage = screen.getByTestId("crop-frame").parentElement as HTMLElement;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 }),
    );
    const position = screen.getByRole("slider", { name: "positionX" });

    // A tap right of the frame centres it there, as far as the edge allows.
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 190, clientY: 50 });
    expect(position).toHaveValue("100");
    // Dragging moves it with the pointer; the slider follows.
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 50 });
    expect(position).toHaveValue("50");
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 140, clientY: 50 });
    // Moving without a press changes nothing.
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 0, clientY: 50 });
    expect(position).toHaveValue("50");
  });

  it("places the crop at any point of its travel without a drag", async () => {
    const user = userEvent.setup();
    renderCrop();
    await user.click(screen.getByRole("button", { name: "open" }));
    // Nearly square: a square frame is 350 px wide with only 50 px of travel.
    const image = screen.getByRole("img", { name: "Team photo.jpg" });
    Object.defineProperty(image, "naturalWidth", { value: 400 });
    Object.defineProperty(image, "naturalHeight", { value: 350 });
    fireEvent.load(image);

    // A tap on the track sets the value where it lands.
    fireEvent.change(screen.getByRole("slider", { name: "positionX" }), {
      target: { value: "40" },
    });
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      20,
      0,
      350,
      350,
      0,
      0,
      350,
      350,
    );
  });

  it("moves a landscape crop up and down on a tall image", async () => {
    const user = userEvent.setup();
    renderCrop();
    await user.click(screen.getByRole("button", { name: "open" }));
    const image = screen.getByRole("img", { name: "Team photo.jpg" });
    Object.defineProperty(image, "naturalWidth", { value: 1000 });
    Object.defineProperty(image, "naturalHeight", { value: 2000 });
    fireEvent.load(image);
    await user.click(
      screen.getByRole("radio", { name: /shapes.landscape.name/ }),
    );
    expect(screen.getByRole("slider", { name: "positionY" })).toHaveValue("50");
  });

  it("offers no position control when the image already has the shape", async () => {
    const user = userEvent.setup();
    renderCrop();
    await user.click(screen.getByRole("button", { name: "open" }));
    const image = screen.getByRole("img", { name: "Team photo.jpg" });
    Object.defineProperty(image, "naturalWidth", { value: 800 });
    Object.defineProperty(image, "naturalHeight", { value: 800 });
    fireEvent.load(image);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
  });

  it("returns focus to the Crop button when the dialog closes", async () => {
    const user = userEvent.setup();
    renderCrop();
    await openWithWideImage(user);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "open" })).toHaveFocus();
  });

  it("explains the size limit for an image too big to crop here", async () => {
    const user = userEvent.setup();
    renderCrop("Huge.jpg", 30 * 1024 * 1024);
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByRole("alert")).toHaveTextContent("tooLarge");
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("loading")).toBeNull();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("says when the image cannot load, without a loading caption", async () => {
    const user = userEvent.setup();
    renderCrop();
    await user.click(screen.getByRole("button", { name: "open" }));
    fireEvent.error(screen.getByRole("img", { name: "Team photo.jpg" }));
    expect(screen.getByRole("alert")).toHaveTextContent("loadError");
    expect(screen.queryByText("loading")).toBeNull();
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
