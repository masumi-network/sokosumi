import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(href);
  },
}));
vi.mock("../../(welcome)/home-page", () => ({
  default: () => <h1>Existing Home</h1>,
  generateMetadata: () => ({ title: "Home" }),
}));

import WelcomePage from "../../(welcome)/home-page";
import LegacyHomePage from "../../(welcome)/page";
import ChatHomePage, { generateMetadata } from "../page";

it("serves the existing Home and metadata at /chat", async () => {
  expect(ChatHomePage).toBe(WelcomePage);
  expect(await generateMetadata()).toEqual({ title: "Home" });
});

it("redirects old Home bookmarks with their query strings", async () => {
  await expect(
    LegacyHomePage({
      searchParams: Promise.resolve({
        notice: "room-unavailable",
        filter: ["a", "b"],
      }),
    }),
  ).rejects.toThrow("/chat?notice=room-unavailable&filter=a&filter=b");
});
