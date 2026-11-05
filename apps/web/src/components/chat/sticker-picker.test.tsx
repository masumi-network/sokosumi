import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StickerPicker } from "./sticker-picker";

const { list, save } = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/services/chat-sticker.browser", () => ({
  getSavedChatStickers: list,
  saveChatSticker: save,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
const sticker = {
  name: "wave.png",
  url: "https://test.public.blob.vercel-storage.com/stickers/alice/id/wave.png",
};
function picker(onPick = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StickerPicker userId="alice" onPick={onPick} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  list.mockReset().mockResolvedValue([]);
  save.mockReset().mockResolvedValue(sticker);
});
describe("StickerPicker", () => {
  it("uploads, selects, and loads the saved collection after remount", async () => {
    const onPick = vi.fn();
    const view = picker(onPick);
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    await screen.findByText("empty");
    const file = new File(["fixture"], "wave.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("upload"), {
      target: { files: [file] },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "select:wave.png" }),
    );
    expect(save).toHaveBeenCalledWith(file);
    expect(onPick).toHaveBeenCalledWith(sticker);
    view.unmount();
    list.mockResolvedValue([sticker]);
    picker();
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    expect(
      await screen.findByRole("button", { name: "select:wave.png" }),
    ).toBeDefined();
  });
  it("keeps the collection on upload failure and shows recovery text", async () => {
    list.mockResolvedValue([sticker]);
    save.mockRejectedValue(new Error("offline"));
    picker();
    fireEvent.click(screen.getByRole("button", { name: "title" }));
    await screen.findByRole("button", { name: "select:wave.png" });
    fireEvent.change(screen.getByLabelText("upload"), {
      target: { files: [new File(["x"], "new.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("uploadFailed"),
    );
    expect(
      screen.getByRole("button", { name: "select:wave.png" }),
    ).toBeDefined();
  });
});
