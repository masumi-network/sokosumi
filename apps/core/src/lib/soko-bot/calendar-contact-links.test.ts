import { describe, expect, it } from "vitest";
import { linkCalendarContacts } from "./calendar-contact-links";
import { persistedToolResult } from "./persisted-value";

const email = "hello@cerise.example";
const link =
  "/contacts?contact=019aaa01-0000-7000-8000-000000000001&workspace=019aaa01-0000-7000-8000-000000000002";
const card = `[${email}](${link})`;
const calendar = {
  capability: "list_calendar_events",
  status: "COMPLETED",
  result: { events: [{ contactReferences: [{ email, link }] }] },
};

describe("saved contact cards in calendar answers", () => {
  it("preserves an event citation, unrelated mail links, examples and a longer mailbox", () => {
    const examples = [
      `\`${email}\``,
      `https://calendar.example/invite/${email}`,
      `other+${email}`,
      `${email}.org`,
      `[Calendar event](https://calendar.example/events/123)`,
      `[Email the team](mailto:${email}?subject=Meeting)`,
    ].join(" ");
    const source = `<${email}>, [${email}](mailto:${email}), ${email}.\n${examples}`;
    const linked = linkCalendarContacts(source, [calendar]);
    expect(linked).toBe(`${card}, ${card}, ${card}.\n${examples}`);
    expect(linkCalendarContacts(linked, [calendar])).toBe(linked);
  });

  it("links a corroborated full name alone and leaves an ambiguous or unconfirmed invite label plain", () => {
    const name = "Mira Quill";
    const named = {
      ...calendar,
      result: {
        events: [
          {
            attendees: [`${name} <${email}>`],
            contactReferences: [{ email, name, link }],
          },
        ],
      },
    };
    expect(linkCalendarContacts(`The invite lists ${name}.`, [named])).toBe(
      `The invite lists [${name}](${link}).`,
    );
    const other = {
      ...calendar,
      result: { events: [{ attendees: [`${name} <other@paper.example>`] }] },
    };
    expect(linkCalendarContacts(name, [named, other])).toBe(name);
    expect(linkCalendarContacts("Cerise Desk", [calendar])).toBe("Cerise Desk");
  });

  it("preserves reference links, HTML, code spans and different mailboxes", () => {
    for (const text of [
      `[${email}][event]\n\n[event]: https://calendar.example/123`,
      `<a href="mailto:${email}">${email}</a>`,
      "``" + email + "``",
      `other*${email}`,
    ])
      expect(linkCalendarContacts(text, [calendar])).toBe(text);
  });

  it("uses the mailbox alone when a saved receipt no longer has its full guest list", () => {
    const name = "Mira Quill";
    const named = {
      attendees: [`${name} <${email}>`],
      contactReferences: [{ email, link, name }],
    };
    const receipt = persistedToolResult(
      {
        events: [
          named,
          ...Array.from({ length: 45 }, () => ({
            description: "x".repeat(500),
          })),
          { attendees: [`${name} <other@cerise.example>`] },
        ],
      },
      "list_calendar_events",
    );
    expect(receipt).toHaveProperty("truncated", true);
    const result = linkCalendarContacts(`${name}: ${email}`, [
      { ...calendar, result: { events: [named] } },
      { ...calendar, result: receipt },
    ]);
    expect(result).toBe(`${name}: ${card}`);
  });

  it("ignores failed calls, text from other tools, invalid destinations and conflicting records", () => {
    const withLink = (destination: string) => ({
      ...calendar,
      result: {
        events: [{ contactReferences: [{ email, link: destination }] }],
      },
    });
    for (const calls of [
      [{ ...calendar, status: "FAILED" }],
      [{ ...calendar, capability: "read_integration_tool" }],
      [withLink("https://outside.example/contacts")],
      [calendar, withLink(link.replace("000000000001", "000000000003"))],
    ]) {
      expect(linkCalendarContacts(email, calls)).toBe(email);
    }
  });
  it("retains a verified mailbox when the calendar tool receipt is too large to keep in full", () => {
    const result = persistedToolResult(
      {
        events: Array.from({ length: 50 }, (_, index) => ({
          description: "x".repeat(500),
          ...(index === 49 ? calendar.result.events[0] : {}),
        })),
      },
      "list_calendar_events",
    );
    expect(result).toHaveProperty("truncated", true);
    expect(linkCalendarContacts(email, [{ ...calendar, result }])).toBe(card);
  });
});
