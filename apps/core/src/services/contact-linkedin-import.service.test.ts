import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/contacts.service", () => ({
  inContactTransaction: vi.fn(),
  upsertContact: vi.fn(),
}));
vi.mock("@/services/contact-lists.service", () => ({
  ensureManualContactList: vi.fn(),
}));

import {
  parseConnectedOn,
  parseLinkedInConnections,
} from "./contact-linkedin-import.service";

const EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see their email address."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ann,Partner,https://www.linkedin.com/in/ann-partner,,Ann Capital,Partner,20 Nov 2026
Fay,Founder,https://www.linkedin.com/in/fay-founder,fay@agentpay.io,AgentPay,"Co-founder & CEO",03 Mar 2025
,,,,,,
Nobody,Here,,,,,01 Jan 2024
Bob,Noname,https://www.linkedin.com/company/not-a-person,,,,
`;

describe("parseLinkedInConnections", () => {
  it("skips the Notes preamble and keeps rows with a profile url and a name", () => {
    expect(parseLinkedInConnections(EXPORT)).toEqual([
      {
        firstName: "Ann",
        lastName: "Partner",
        url: "https://www.linkedin.com/in/ann-partner",
        email: null,
        company: "Ann Capital",
        position: "Partner",
        connectedOn: "2026-11-20",
      },
      {
        firstName: "Fay",
        lastName: "Founder",
        url: "https://www.linkedin.com/in/fay-founder",
        email: "fay@agentpay.io",
        company: "AgentPay",
        position: "Co-founder & CEO",
        connectedOn: "2025-03-03",
      },
    ]);
  });

  it("refuses a file that is not the connections export", () => {
    expect(() => parseLinkedInConnections("name,email\nAnn,a@b.c\n")).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
});

describe("parseConnectedOn", () => {
  it("reads LinkedIn's day month year, and gives null for anything else", () => {
    expect(parseConnectedOn("25 Nov 2026")).toBe("2026-11-25");
    expect(parseConnectedOn("soon")).toBeNull();
    expect(parseConnectedOn(null)).toBeNull();
  });
});
