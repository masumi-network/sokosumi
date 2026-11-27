import { describe, expect, it, vi } from "vitest";

const { ssrfSafeFetch, withBrowser } = vi.hoisted(() => ({
  ssrfSafeFetch: vi.fn(),
  withBrowser: vi.fn(),
}));
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch,
}));
vi.mock("@/lib/site-capture", () => ({ withBrowser, readPageText: vi.fn() }));

import { runInEvalWorld } from "@/lib/evals/eval-world-context";
import { readSocialProfile } from "./social-profile";

describe("readSocialProfile in an eval lane", () => {
  it("reads nothing from the live web and says it could not read the profile", async () => {
    for (const url of [
      "https://www.youtube.com/@padierfind",
      "https://x.com/padierfind",
      "https://www.instagram.com/padierfind",
    ]) {
      const profile = await runInEvalWorld("ws-eval", () =>
        readSocialProfile(url),
      );
      expect(profile).toMatchObject({ readable: false, recent: [] });
    }
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(withBrowser).not.toHaveBeenCalled();
  });
});
