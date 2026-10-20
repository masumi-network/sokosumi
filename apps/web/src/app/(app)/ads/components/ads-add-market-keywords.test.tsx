import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAdMarketKeywords } from "@/lib/actions/ads/action";
import messages from "../../../../../messages/en.json";
import { AdsAddMarketKeywords } from "./ads-add-market-keywords";

const { toastErrorMock, toastInfoMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, info: toastInfoMock },
}));
vi.mock("@/lib/actions/ads/action", () => ({ listAdMarketKeywords: vi.fn() }));

const listMock = vi.mocked(listAdMarketKeywords);

type ListResult = Awaited<ReturnType<typeof listAdMarketKeywords>>;

function renderButton(onAdd = vi.fn<(names: string[]) => number>(() => 1)) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsAddMarketKeywords onAdd={onAdd} projectId="project-1" />
    </NextIntlClientProvider>,
  );
  return { onAdd, user: userEvent.setup() };
}

const button = () => screen.getByRole("button", { name: "Add from Market" });

describe("AdsAddMarketKeywords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for nothing until it is clicked", () => {
    renderButton();

    expect(listMock).not.toHaveBeenCalled();
  });

  it("loads the project's keywords on click and hands them over", async () => {
    listMock.mockResolvedValue({ ok: true, value: ["shoes", "boots"] });
    const { onAdd, user } = renderButton();

    await user.click(button());

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(["shoes", "boots"]));
    expect(listMock).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(toastInfoMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("is busy while the keywords load", async () => {
    let resolve: (result: ListResult) => void = () => undefined;
    listMock.mockReturnValue(
      new Promise<ListResult>((done) => {
        resolve = done;
      }),
    );
    const { onAdd, user } = renderButton();

    await user.click(button());

    await waitFor(() => expect(button()).toHaveAttribute("aria-busy", "true"));
    resolve({ ok: true, value: ["shoes"] });
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await waitFor(() => expect(button()).not.toHaveAttribute("aria-busy"));
  });

  it.each([
    ["has none", []],
    ["has none that are new", ["shoes"]],
  ])("says so when the project %s to add", async (_name, names) => {
    listMock.mockResolvedValue({ ok: true, value: names });
    const { user } = renderButton(vi.fn(() => 0));

    await user.click(button());

    await waitFor(() =>
      expect(toastInfoMock).toHaveBeenCalledWith(
        "No new Market keywords to add",
      ),
    );
  });

  it("tells the reader quietly when the lookup fails, adding nothing", async () => {
    listMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "down", status: 502 },
    });
    const { onAdd, user } = renderButton();

    await user.click(button());

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to load Market keywords",
      ),
    );
    expect(onAdd).not.toHaveBeenCalled();
    expect(button()).not.toHaveAttribute("aria-busy");
  });

  it("does the same when the action throws", async () => {
    listMock.mockRejectedValue(new Error("network"));
    const { onAdd, user } = renderButton();

    await user.click(button());

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to load Market keywords",
      ),
    );
    expect(onAdd).not.toHaveBeenCalled();
  });
});
