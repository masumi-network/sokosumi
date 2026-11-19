import { createClient } from "@sokosumi/core-client/client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DriveRecentsPanel } from "@/app/drive/components/drive-recents-panel";

/**
 * Make a copy through the real upload helper and the real generated Core
 * client, with only the network stubbed: Core's 409 for a taken name must
 * reach the copy as "taken" so it tries the next number.
 */

const { t, formatter, network, toastMock, fetchRecentsMock } = vi.hoisted(
  () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
    formatter: { dateTime: () => "18 Nov 2026" },
    network: vi.fn<(request: Request) => Promise<Response>>(),
    toastMock: {
      loading: vi.fn(() => "toast-1"),
      success: vi.fn(),
      error: vi.fn(),
    },
    fetchRecentsMock: vi.fn(),
  }),
);
vi.mock("next-intl", () => ({
  useTranslations: () => t,
  useFormatter: () => formatter,
}));
vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ locale: "en" }),
}));
vi.mock("@/lib/utils/drive-recents-list.client", () => ({
  fetchDriveRecentsPage: fetchRecentsMock,
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () =>
    createClient({
      baseUrl: "https://core.test/v1",
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        network(new Request(input, init)),
    }),
}));

const FILE = {
  kind: "drive-file" as const,
  name: "weekly.md",
  fileUrl: "https://blob.test/drive/users/u1/briefs/weekly.md",
  pathname: "drive/users/u1/briefs/weekly.md",
  size: 8,
  activityAt: new Date("2026-11-18T09:00:00Z"),
  resourceId: "res_1",
  category: null,
  tags: [],
  dataRoom: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Minted names, in order. */
const minted: string[] = [];

class PutRequest {
  status = 200;
  responseText = JSON.stringify({ url: "https://blob.test/copy" });
  upload = { addEventListener: vi.fn() };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  addEventListener(event: string, handler: () => void) {
    if (event === "load") setTimeout(handler, 0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  minted.length = 0;
  fetchRecentsMock.mockResolvedValue({ items: [FILE], nextCursor: null });
  vi.stubGlobal("XMLHttpRequest", PutRequest);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["# weekly"]))),
  );
  network.mockImplementation(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/drive/files/finalize")
      return json(200, {
        data: { resourceId: "res_2", fileUrl: null },
        meta: { timestamp: "2026-11-18T12:00:00.000Z" },
      });
    const body = (await request.json()) as {
      filename: string;
      pinLabelsEmpty?: boolean;
    };
    minted.push(body.filename);
    if (minted.length === 1)
      return json(409, {
        error: "Conflict",
        message: "A file already holds that name",
      });
    return json(200, {
      data: {
        uploadUrl: "https://blob.test/upload?sig=1",
        // Core mints the copy's own name per attempt.
        pathname: "drive/users/u1/briefs/weekly_copyNameLabel_2_0a1b2c3d4e.md",
        // A copy is always staged.
        attemptId: "0f9d2c1e-8b7a-4c3d-9e1f-2a3b4c5d6e7f",
        access: "public",
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        expiresAt: "2026-11-18T12:00:00.000Z",
        maxSizeBytes: 104_857_600,
        addRandomSuffix: false,
      },
      meta: { timestamp: "2026-11-18T12:00:00.000Z" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Make a copy through the real mint", () => {
  it("reads Core's 409 as a taken name and tries the next number", async () => {
    const user = userEvent.setup();
    render(
      <DriveRecentsPanel
        driveStore={{ scope: "me" }}
        activeOrganizationId={null}
        searchQuery=""
        tagLabelIds={[]}
        onOpenMoveDialog={vi.fn()}
        onShareFile={vi.fn()}
        onOpenDeleteDialog={vi.fn()}
        onRenameFile={vi.fn()}
        onOpenCopyDialog={vi.fn()}
        onItemsChanged={vi.fn()}
        onUpload={vi.fn()}
        uploading={false}
        onOpenWorkspace={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "moreActions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "makeCopyAction" }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        "copyMade:weekly_copyNameLabel_2_0a1b2c3d4e.md",
        { id: "toast-1" },
      ),
    );
    expect(minted).toEqual([
      "weekly (copyNameLabel).md",
      "weekly (copyNameLabel) 2.md",
    ]);
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
