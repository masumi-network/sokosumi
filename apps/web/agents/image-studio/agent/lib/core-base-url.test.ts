import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the agent sends its grants.
 *
 * The agent is a service beside Next, not inside it, so it cannot use the
 * `@vercel/related-projects` resolution the app uses and a deployment has to
 * name Core in `CORE_APP_BASE_URL`. The two shapes below are the ones a
 * deployment realistically gets wrong: a trailing slash, and the browser
 * config's value, which Next builds with `/v1` already on it. Core mounts the
 * grant surface at the origin, so the second one 404s on every call — and a
 * 404 reaches the channel as "no access", which is indistinguishable from a
 * revoked membership from the person's side.
 */

process.env.IMAGE_STUDIO_AGENT_SECRET = "x".repeat(48);
process.env.CORE_APP_BASE_URL = "https://core.invalid/v1/";

const { authorizeProjectAccess } = await import("./core");

const IDENTITY = { userId: "user-a", projectId: "project-a" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the agent's Core base URL", () => {
  it("calls the grant surface at the origin, not under /v1", async () => {
    await authorizeProjectAccess(IDENTITY);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://core.invalid/image-studio-agent/access",
    );
  });
});
