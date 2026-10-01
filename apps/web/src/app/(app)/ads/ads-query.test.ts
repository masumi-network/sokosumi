import type { ProjectAdAccount } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { isCampaignsTab, parseCampaignsSelection } from "./ads-query";

const accounts = [{ id: "a1" }, { id: "a2" }] as ProjectAdAccount[];

describe("parseCampaignsSelection", () => {
  it("defaults to the first account and 30 days", () => {
    expect(parseCampaignsSelection({}, accounts)).toEqual({
      account: accounts[0],
      range: "30d",
    });
  });

  it("reads the account and range from the URL", () => {
    expect(
      parseCampaignsSelection({ account: "a2", range: "7d" }, accounts),
    ).toEqual({ account: accounts[1], range: "7d" });
  });

  it("falls back for an unknown account or range", () => {
    expect(
      parseCampaignsSelection({ account: "gone", range: "90d" }, accounts),
    ).toEqual({ account: accounts[0], range: "30d" });
  });

  it("has no selection without accounts", () => {
    expect(parseCampaignsSelection({}, [])).toBeNull();
  });
});

describe("isCampaignsTab", () => {
  it.each([
    [undefined, true],
    ["campaigns", true],
    ["bogus", true],
    ["market", false],
    ["accounts", false],
  ])("%s -> %s", (tab, expected) => {
    expect(isCampaignsTab(tab)).toBe(expected);
  });
});
