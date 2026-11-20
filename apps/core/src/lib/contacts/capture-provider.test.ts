import { describe, expect, it } from "vitest";
import { cleanPersonName, parseAddresses } from "./capture-provider";

describe("addresses and names", () => {
  it("splits lists on separating commas only", () => {
    expect(
      parseAddresses(
        '"Keller, Nina" <Nina.Keller@acme.com>, bob@x.com; Max Muster <max@y.org>',
      ),
    ).toEqual([
      { email: "nina.keller@acme.com", name: "Nina Keller" },
      { email: "bob@x.com", name: null },
      { email: "max@y.org", name: "Max Muster" },
    ]);
  });

  it("reads Graph recipient objects", () => {
    expect(
      parseAddresses([
        {
          emailAddress: { name: "Ana Silva", address: "Ana.Silva@lawfirm.pt" },
        },
      ]),
    ).toEqual([{ email: "ana.silva@lawfirm.pt", name: "Ana Silva" }]);
  });

  it("reads nested email and address aliases with the caller's name policy", () => {
    const recipients = [
      { email: { name: "Mira", address: "Mira@studio.example" } },
      { address: { displayName: "Rowan Vale", email: "rowan@host.example" } },
    ];
    expect(parseAddresses(recipients, "invitation")).toEqual([
      { email: "mira@studio.example", name: "Mira" },
      { email: "rowan@host.example", name: "Rowan Vale" },
    ]);
    expect(parseAddresses(recipients)).toEqual([
      { email: "mira@studio.example", name: null },
      { email: "rowan@host.example", name: "Rowan Vale" },
    ]);
  });

  it("drops names that are only the address", () => {
    expect(cleanPersonName("contracts@lawfirm.pt")).toBeUndefined();
    expect(cleanPersonName("nina", "nina@acme.com")).toBeUndefined();
    expect(cleanPersonName("Jane Doe (via Google Docs)")).toBe("Jane Doe");
  });
});
