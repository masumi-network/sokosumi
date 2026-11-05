import { describe, expect, it } from "vitest";

import { parseNewsletterCsv } from "./csv";

describe("newsletter CSV", () => {
  it.each(["email", " E-MAIL ", "Email Address"])(
    "recognizes %s and normalizes and deduplicates emails",
    (header) => {
      expect(
        parseNewsletterCsv(
          `${header}\n ADA@Example.com \nada@example.com\nbad\n`,
        ),
      ).toEqual({
        subscribers: [{ email: "ada@example.com", name: null }],
        validRows: 2,
        invalid: [{ row: 4, value: "bad" }],
      });
    },
  );

  it("reads BOM, CRLF, quoted commas, escaped quotes and embedded newlines", () => {
    expect(
      parseNewsletterCsv(
        '\uFEFFName,Email\r\n"Ada, ""A""\nLovelace",ada@example.com\r\n',
      ),
    ).toEqual({
      subscribers: [{ email: "ada@example.com", name: 'Ada, "A"\nLovelace' }],
      validRows: 1,
      invalid: [],
    });
  });

  it("keeps the first duplicate's name and reports empty emails", () => {
    expect(
      parseNewsletterCsv(
        "name,email\nFirst,a@example.com\nSecond,A@example.com\nMissing,\n",
      ),
    ).toEqual({
      subscribers: [{ email: "a@example.com", name: "First" }],
      validRows: 2,
      invalid: [{ row: 4, value: "" }],
    });
  });

  it.each([
    "",
    "name\nAda",
    'email\n"unclosed',
    'email\n"a"oops',
    "email,name\na@example.com",
  ])("rejects malformed or missing email headers: %s", (csv) => {
    expect(() => parseNewsletterCsv(csv)).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });

  it("caps invalid entries at 100 while continuing to parse valid rows", () => {
    const result = parseNewsletterCsv(
      `email\n${"bad\n".repeat(101)}a@example.com`,
    );
    expect(result.invalid).toHaveLength(100);
    expect(result.invalid.at(-1)).toEqual({ row: 101, value: "bad" });
    expect(result.subscribers).toEqual([
      { email: "a@example.com", name: null },
    ]);
  });

  it("accepts 50,000 data rows and rejects one more", () => {
    const csv = `email\n${"a@example.com\n".repeat(50_000)}`;
    expect(parseNewsletterCsv(csv).validRows).toBe(50_000);
    expect(() => parseNewsletterCsv(`${csv}a@example.com`)).toThrow(
      expect.objectContaining({
        status: 422,
        message: "CSV exceeds 50,000 rows",
      }),
    );
  });
});
