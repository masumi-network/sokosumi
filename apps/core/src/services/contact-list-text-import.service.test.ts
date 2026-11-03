import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertContact, updateContactListMembers } = vi.hoisted(() => ({
  upsertContact: vi.fn(),
  updateContactListMembers: vi.fn(),
}));

vi.mock("@/services/contacts.service", () => ({
  inContactTransaction: (callback: (tx: unknown) => unknown) => callback({}),
  upsertContact,
}));
vi.mock("@/services/contact-lists.service", () => ({
  updateContactListMembers,
}));

import {
  CONTACT_LIST_TEXT_IMPORT_MAX,
  importContactListText,
  parseContactListText,
} from "./contact-list-text-import.service";

describe("parseContactListText", () => {
  it("reads a CSV export with names, whatever the column order", () => {
    expect(
      parseContactListText(
        '﻿First name;Last name;Email\nAda;Lovelace;ADA@example.com\n"Grace";"Hopper";grace@example.org\n',
      ),
    ).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "grace@example.org", name: "Grace Hopper" },
    ]);
  });

  it("reads one address a line, skips junk and duplicates", () => {
    expect(
      parseContactListText(
        "ada@example.com\nnot an email\n\nAda <ada@example.com>\nbob@test.io",
      ),
    ).toEqual([
      { email: "ada@example.com", name: undefined },
      { email: "bob@test.io", name: undefined },
    ]);
  });

  it("keeps whole addresses and ignores long junk lines quickly", () => {
    expect(
      parseContactListText("o'connor@example.com\nada@@example.com"),
    ).toEqual([{ email: "o'connor@example.com", name: undefined }]);
    const started = performance.now();
    expect(parseContactListText(`${"a".repeat(40_000)}\nbob@test.io`)).toEqual([
      { email: "bob@test.io", name: undefined },
    ]);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("uses a name column and quoted cells with commas", () => {
    expect(
      parseContactListText('name,email\n"Lovelace, Ada",ada@example.com'),
    ).toEqual([{ email: "ada@example.com", name: "Lovelace, Ada" }]);
  });
});

describe("importContactListText", () => {
  const actor = { workspaceId: "ws-1", userId: "user-1", sokoBotId: null };
  const list = { id: "list-1", name: "Newsletter", count: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    upsertContact.mockImplementation(async (_tx, _actor, input) => ({
      contact: { id: `contact-${input.channels[0].value}` },
    }));
    updateContactListMembers.mockResolvedValue(list);
  });

  it("upserts each address as a contact and adds it to the list", async () => {
    await expect(
      importContactListText(
        actor,
        "list-1",
        "name,email\nAda,ada@example.com\nbob@test.io",
      ),
    ).resolves.toBe(list);
    expect(upsertContact).toHaveBeenCalledWith(
      {},
      actor,
      expect.objectContaining({
        name: "Ada",
        channels: [
          { type: "EMAIL", value: "ada@example.com", source: "IMPORT" },
        ],
        upsert: true,
      }),
      { defaultChannelSource: "IMPORT" },
    );
    expect(updateContactListMembers).toHaveBeenCalledWith({}, actor, "list-1", {
      add: ["contact-ada@example.com", "contact-bob@test.io"],
      remove: [],
    });
  });

  it("refuses text with no addresses, or too many", async () => {
    await expect(
      importContactListText(actor, "list-1", "no addresses here"),
    ).rejects.toThrow("No email addresses");
    const many = Array.from(
      { length: CONTACT_LIST_TEXT_IMPORT_MAX + 1 },
      (_, index) => `p${index}@example.com`,
    ).join("\n");
    await expect(importContactListText(actor, "list-1", many)).rejects.toThrow(
      "at most",
    );
    expect(upsertContact).not.toHaveBeenCalled();
  });
});
