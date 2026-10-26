import { describe, expect, it } from "vitest";
import {
  classifyAddress,
  companyDomain,
  hasBulkCategory,
  isAutoReplySubject,
  isBulkMail,
  isCalendarNoticeSubject,
} from "./capture-filters";

const identity = {
  ownerEmails: new Set(["patrick@yellowhouse.gmbh"]),
  teammateEmails: new Set(["patrick@yellowhouse.gmbh", "bob@yellowhouse.gmbh"]),
};
const inbound = { ownerInitiated: false };
const outbound = { ownerInitiated: true };

describe("classifyAddress", () => {
  it("accepts a person and flags nothing", () => {
    expect(
      classifyAddress("Nina.Keller@acme-robotics.com", identity, inbound),
    ).toEqual({ ok: true, borderline: false });
  });

  it("never captures the owner or a teammate", () => {
    expect(
      classifyAddress("PATRICK@yellowhouse.gmbh", identity, outbound),
    ).toEqual({ ok: false, reason: "self" });
    expect(classifyAddress("bob@yellowhouse.gmbh", identity, outbound)).toEqual(
      { ok: false, reason: "teammate" },
    );
  });

  it("treats colleagues at the owner's or a teammate's company as team", () => {
    expect(
      classifyAddress("nils.lassen@yellowhouse.gmbh", identity, outbound),
    ).toEqual({ ok: false, reason: "teammate" });
    expect(
      classifyAddress(
        "alice@gmail.com",
        {
          ownerEmails: new Set(["patrick@gmail.com"]),
          teammateEmails: new Set(),
        },
        outbound,
      ),
    ).toEqual({ ok: true, borderline: false });
  });

  it.each([
    "hey@adyjecinski.com",
    "business@acme.com",
    "ceooffice@acme.org",
    "kontakt@acme.de",
    "hallo@acme.de",
    "partner@acme.com",
  ])("sends the shared inbox %s to the judge", (email) => {
    expect(classifyAddress(email, identity, outbound)).toEqual({
      ok: true,
      borderline: true,
    });
  });

  it.each([
    "noreply@acme.com",
    "no-reply@acme.com",
    "do-not-reply@acme.com",
    "donotreply@acme.com",
    "notifications@acme.com",
    "notification@acme.com",
    "mailer-daemon@googlemail.com",
    "postmaster@acme.com",
    "bounce-123@acme.com",
    "bounces+abc@acme.com",
    "calendar-notification@google.com",
    "receipts+xyz@acme.com",
    "team-noreply@acme.com",
  ])("drops the automated sender %s", (email) => {
    expect(classifyAddress(email, identity, outbound)).toEqual({
      ok: false,
      reason: "automated_sender",
    });
  });

  it.each([
    "anything@bounce.mailchimp.com",
    "x@sendgrid.net",
    "support@acme.zendesk.com",
    "reply+abc@reply.github.com",
    "anna@news.saasproduct.com",
    "list@googlegroups.com",
  ])("drops sending infrastructure %s even when the owner wrote", (email) => {
    expect(classifyAddress(email, identity, outbound)).toEqual({
      ok: false,
      reason: "automated_domain",
    });
  });

  it("drops notification platforms only for mail the owner did not start", () => {
    expect(
      classifyAddress("jordan@linkedin.com", identity, inbound),
    ).toMatchObject({ ok: false, reason: "automated_domain" });
    expect(
      classifyAddress("jordan@sales.linkedin.com", identity, inbound),
    ).toMatchObject({ ok: false, reason: "automated_domain" });
    // A LinkedIn employee the owner wrote to is a person.
    expect(classifyAddress("jordan@linkedin.com", identity, outbound)).toEqual({
      ok: true,
      borderline: false,
    });
  });

  it("leaves role inboxes to the judge", () => {
    for (const email of [
      "info@acme.com",
      "hello@founder.dev",
      "sales@acme.com",
      "support@vendor-saas.io",
    ])
      expect(classifyAddress(email, identity, outbound)).toEqual({
        ok: true,
        borderline: true,
      });
  });

  it("rejects what is not an address", () => {
    expect(classifyAddress("not an email", identity, outbound)).toEqual({
      ok: false,
      reason: "invalid_address",
    });
  });
});

describe("mail signals", () => {
  it("reads bulk headers", () => {
    expect(isBulkMail(new Map([["list-unsubscribe", "<mailto:u@x>"]]))).toBe(
      true,
    );
    expect(isBulkMail(new Map([["list-id", "team.example.com"]]))).toBe(true);
    expect(isBulkMail(new Map([["precedence", "Bulk"]]))).toBe(true);
    expect(isBulkMail(new Map([["auto-submitted", "auto-replied"]]))).toBe(
      true,
    );
    expect(isBulkMail(new Map([["auto-submitted", "no"]]))).toBe(false);
    expect(isBulkMail(new Map([["subject", "Hi"]]))).toBe(false);
  });

  it("reads Gmail's tabs other than Primary", () => {
    expect(hasBulkCategory(["INBOX", "CATEGORY_PROMOTIONS"])).toBe(true);
    expect(hasBulkCategory(["CATEGORY_SOCIAL"])).toBe(true);
    expect(hasBulkCategory(["CATEGORY_UPDATES"])).toBe(true);
    expect(hasBulkCategory(["CATEGORY_FORUMS"])).toBe(true);
    expect(hasBulkCategory(["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"])).toBe(
      false,
    );
  });

  it("knows auto-replies and calendar notices by subject", () => {
    expect(isAutoReplySubject("Automatic reply: Workshop")).toBe(true);
    expect(isAutoReplySubject("Out of Office: back Monday")).toBe(true);
    expect(isAutoReplySubject("Abwesenheitsnotiz: Urlaub")).toBe(true);
    expect(isAutoReplySubject("Re: Out of office plans for the team")).toBe(
      false,
    );
    expect(isCalendarNoticeSubject("Accepted: Partner sync @ Thu")).toBe(true);
    expect(isCalendarNoticeSubject("Invitation: Kickoff @ Mon")).toBe(true);
    expect(isCalendarNoticeSubject("Kickoff notes")).toBe(false);
  });

  it("finds the company domain, never a freemail one", () => {
    expect(companyDomain("nina@acme-robotics.com")).toBe("acme-robotics.com");
    expect(companyDomain("max@gmail.com")).toBeNull();
    expect(companyDomain("max@gmx.ch")).toBeNull();
  });
});
