import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { readSeoConnectionHandoff } from "@/lib/seo/connection-callback";
import { GET } from "./route";

const SCRIPT_OPEN = "<script>";
const SCRIPT_CLOSE = "</script>";

describe("SEO callback privacy handoff", () => {
  it("hands one-use consent to a clean native URL without loading app analytics or a bot verifier", async () => {
    const params = new URLSearchParams({
      provider: "ga4",
      viewer: "owner",
      organization: "org",
      session_uri: "</script><script>unexpected()</script>",
      seo_state: "attempt",
      auditId: "687d2470-7c63-4779-b10c-462d24ac1e1b",
    });
    const response = GET(
      new Request(
        `https://preprod.sokosumi.com/seo/connections/callback?${params}`,
      ),
    );
    const html = await response.text();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(html).not.toContain("</script><script>unexpected()");
    // The route writes this exact tag pair: a plain string search, no HTML-filter regex.
    const open = html.indexOf(SCRIPT_OPEN);
    const close = html.lastIndexOf(SCRIPT_CLOSE);
    if (open < 0 || close < open) throw new Error("Missing handoff script");
    const script = html.slice(open + SCRIPT_OPEN.length, close);
    const replace = vi.fn();
    const window = { name: "", location: { replace } };
    runInNewContext(script, { window });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/seo/connections/return");
    expect(readSeoConnectionHandoff(window.name)).toMatchObject({
      provider: "ga4",
      nonce: "attempt",
      sessionUri: params.get("session_uri"),
      returnPath: "/seo?auditId=687d2470-7c63-4779-b10c-462d24ac1e1b",
    });
    expect(html).not.toContain("personal-assistant");
  });
});
