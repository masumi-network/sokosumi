import { beforeEach, describe, expect, it, vi } from "vitest";

const { sdk } = vi.hoisted(() => ({
  sdk: {
    getContacts: vi.fn(),
    getContactsExportCsv: vi.fn(),
    postContactListsByIdMembers: vi.fn(),
    postContactsMerge: vi.fn(),
  },
}));
vi.mock("@sokosumi/core-client", () => sdk);
vi.mock("@/lib/clients/core.browser.client", () => ({
  getBrowserCoreClient: () => "client",
}));

import { contactsService } from "./contacts.client";

describe("contactsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a page of contacts with its cursor and match count", async () => {
    sdk.getContacts.mockResolvedValue({
      data: {
        data: [{ id: "c-1" }],
        meta: { pagination: { nextCursor: "c-1", total: 61 } },
      },
    });
    await expect(
      contactsService.list({ knownByMe: "true", limit: 50 }),
    ).resolves.toEqual({
      contacts: [{ id: "c-1" }],
      nextCursor: "c-1",
      total: 61,
    });
    expect(sdk.getContacts).toHaveBeenCalledWith({
      client: "client",
      throwOnError: true,
      query: { knownByMe: "true", limit: 50 },
    });
  });

  it("exports the current filter as CSV text", async () => {
    sdk.getContactsExportCsv.mockResolvedValue({ data: "Name\r\nAda" });
    await expect(contactsService.exportCsv({ stage: "LEAD" })).resolves.toBe(
      "Name\r\nAda",
    );
    expect(sdk.getContactsExportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ query: { stage: "LEAD" }, parseAs: "text" }),
    );
  });

  it("sends list membership changes with both sides spelled out", async () => {
    sdk.postContactListsByIdMembers.mockResolvedValue({
      data: { data: { id: "l-1", count: 2 } },
    });
    await contactsService.changeMembers("l-1", { add: ["c-1", "c-2"] });
    expect(sdk.postContactListsByIdMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "l-1" },
        body: { add: ["c-1", "c-2"], remove: [] },
      }),
    );
  });

  it("merges losers into the winner", async () => {
    sdk.postContactsMerge.mockResolvedValue({ data: { data: { id: "w" } } });
    await expect(contactsService.merge("w", ["l"])).resolves.toEqual({
      id: "w",
    });
    expect(sdk.postContactsMerge).toHaveBeenCalledWith(
      expect.objectContaining({ body: { winnerId: "w", loserIds: ["l"] } }),
    );
  });
});
