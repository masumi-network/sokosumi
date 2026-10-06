import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { select, refresh } = vi.hoisted(() => ({
  select: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./select-project-action", () => ({ selectChatProjectAction: select }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign(
      (key: string, values?: { name: string }) =>
        values ? `${key} ${values.name}` : key,
      { has: () => true },
    ),
  useFormatter: () => ({}),
}));

import { ResultPreviewCard } from "./result-previews";

const id = "00000000-0000-4000-8000-000000000001";
function show() {
  render(
    <ResultPreviewCard
      source={{ turnId: id }}
      result={{
        id,
        kind: "project_selection",
        state: "available",
        title: "Projects",
        status: null,
        capturedAt: new Date(),
        sourceHref: "/projects",
        projectOptions: [{ id, name: "Books", identifier: "BOOK", logo: null }],
        outputs: [],
      }}
      onDecisionResolved={() => {}}
    />,
  );
}
async function choose() {
  fireEvent.click(screen.getByRole("combobox"));
  await screen.findByRole("option", { name: /Books/ });
  fireEvent.click(screen.getByRole("option", { name: /Books/ }));
}
describe("chat project selector", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("uses the existing searchable picker and continues chat with the clicked ID", async () => {
    select.mockResolvedValue({ ok: true });
    show();
    await choose();
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { turnId: id },
        previewId: id,
        projectId: id,
      }),
    );
    await screen.findByText("selected Books");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("allows retry after failure using the same selection", async () => {
    select
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    show();
    await choose();
    await screen.findByRole("alert");
    await choose();
    await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
    expect(select.mock.calls[0][0]).toEqual(select.mock.calls[1][0]);
    await screen.findByText("selected Books");
  });
});
