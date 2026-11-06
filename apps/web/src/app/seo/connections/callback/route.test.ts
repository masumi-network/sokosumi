import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { readSeoConnectionHandoff } from "@/lib/seo/connection-callback";
import { GET } from "./route";

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
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    if (!script) throw new Error("Missing handoff script");
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
