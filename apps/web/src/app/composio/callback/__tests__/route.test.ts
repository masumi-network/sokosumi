import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("GET /composio/callback", () => {
  it("returns minimal HTML with the inline delivery script", async () => {
    const response = GET();
    const html = await response.text();

    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(html).toContain("<script>");
    expect(html).toContain("BroadcastChannel");
    expect(html).not.toContain("connection received");
  });
});
