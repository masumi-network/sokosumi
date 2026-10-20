import type { ProjectAdAccount } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  campaignDetailsHref,
  campaignsHref,
  loadAdsSearchParams,
  loadCampaignDetailsSearchParams,
  selectAccount,
} from "./ads-query";

const accounts = [{ id: "a1" }, { id: "a2" }] as ProjectAdAccount[];

describe("loadAdsSearchParams", () => {
  it("defaults to Campaigns over 30 days", () => {
    expect(loadAdsSearchParams({})).toEqual({
      projectId: null,
      tab: "campaigns",
      account: null,
      range: "30d",
    });
  });

  it("reads the tab, account and range from the URL", () => {
    expect(
      loadAdsSearchParams({
        projectId: "p1",
        tab: "accounts",
        account: "a2",
        range: "7d",
      }),
    ).toEqual({ projectId: "p1", tab: "accounts", account: "a2", range: "7d" });
  });

  it("falls back for an unknown tab or range", () => {
    expect(loadAdsSearchParams({ tab: "bogus", range: "90d" })).toMatchObject({
      tab: "campaigns",
      range: "30d",
    });
  });
});

describe("selectAccount", () => {
  it("picks the account the URL names", () => {
    expect(selectAccount(accounts, "a2")).toBe(accounts[1]);
  });

  it("falls back to the first account when unknown or missing", () => {
    expect(selectAccount(accounts, "gone")).toBe(accounts[0]);
    expect(selectAccount(accounts, null)).toBe(accounts[0]);
  });

  it("has no account without accounts", () => {
    expect(selectAccount([], null)).toBeUndefined();
  });
});

describe("campaignsHref", () => {
  it("opens the Campaigns tab of the account", () => {
    expect(campaignsHref("p1", "a2")).toBe(
      "/ads?projectId=p1&tab=campaigns&account=a2",
    );
  });
});

describe("campaignsHref with a range", () => {
  it("keeps the range the reader was looking at", () => {
    expect(campaignsHref("p1", "a2", "7d")).toBe(
      "/ads?projectId=p1&tab=campaigns&account=a2&range=7d",
    );
  });
});

describe("campaignDetailsHref", () => {
  it("names the project, account and range", () => {
    expect(campaignDetailsHref("p1", "a2", "42", "7d")).toBe(
      "/ads/campaigns/42?projectId=p1&accountId=a2&range=7d",
    );
  });
});

describe("loadCampaignDetailsSearchParams", () => {
  it("reads the project, account and range, defaulting to 30 days", () => {
    expect(
      loadCampaignDetailsSearchParams({
        projectId: "p1",
        accountId: "a2",
        range: "7d",
      }),
    ).toEqual({ projectId: "p1", accountId: "a2", range: "7d" });
    expect(loadCampaignDetailsSearchParams({ range: "90d" })).toEqual({
      projectId: null,
      accountId: null,
      range: "30d",
    });
  });
});
