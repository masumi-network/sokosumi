import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const driveShareDownloadUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/drive-share.server", () => ({
  DRIVE_SHARE_UNLOCK_COOKIE: "file_share_unlock",
  driveShareDownloadUrl,
}));

import { GET } from "./route";

function get(mode: string) {
  const request = new NextRequest(
    "https://app.test/share/files/tok/download?path=Brand%2Fteam.csv",
    { headers: { "sec-fetch-mode": mode, cookie: "file_share_unlock=proof" } },
  );
  return GET(request, { params: Promise.resolve({ token: "tok" }) });
}

describe("shared file download route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the browser to a file the link allows", async () => {
    driveShareDownloadUrl.mockResolvedValue("https://blob.test/team.csv");

    const response = await get("cors");

    expect(driveShareDownloadUrl).toHaveBeenCalledWith(
      "tok",
      "proof",
      "Brand/team.csv",
    );
    expect(response.headers.get("location")).toBe("https://blob.test/team.csv");
  });

  it("sends a click on a refused file back to the link's page", async () => {
    driveShareDownloadUrl.mockResolvedValue(null);

    const response = await get("navigate");

    expect(response.headers.get("location")).toBe(
      "https://app.test/share/files/tok",
    );
  });

  it("gives a Download all fetch 404 for a refused file, not the page", async () => {
    driveShareDownloadUrl.mockResolvedValue(null);

    const response = await get("cors");

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
