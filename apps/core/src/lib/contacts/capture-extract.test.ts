import { describe, expect, it } from "vitest";
import gmailReceived from "./__fixtures__/gmail-received.json";
import gmailSent from "./__fixtures__/gmail-sent.json";
import googleEvents from "./__fixtures__/googlecalendar-events.json";
import outlookEvents from "./__fixtures__/outlook-events.json";
import outlookReceived from "./__fixtures__/outlook-received.json";
import outlookSent from "./__fixtures__/outlook-sent.json";
import slack from "./__fixtures__/slack.json";
import {
  cleanPersonName,
  type ExtractContext,
  extractInboundMail,
  extractMeeting,
  extractSentMail,
  extractSlackConversation,
  mailTopic,
  parseAddresses,
  parseEvent,
  parseMail,
  parseSignature,
  parseSlackConversation,
  parseSlackProfile,
  slackCandidate,
  slackDays,
} from "./capture-extract";

const NOW = new Date("2026-10-21T12:00:00Z");

function context(provider: string): ExtractContext {
  return {
    provider,
    teammateUserId: "user-patrick",
    identity: {
      ownerEmails: new Set(["patrick@yellowhouse.gmbh"]),
      teammateEmails: new Set([
        "patrick@yellowhouse.gmbh",
        "bob@yellowhouse.gmbh",
      ]),
    },
  };
}

function mails(fixture: { messages?: unknown[]; value?: unknown[] }) {
  return (fixture.messages ?? fixture.value ?? []).map((raw) => {
    const mail = parseMail(raw);
    if (!mail) throw new Error("fixture did not parse");
    return mail;
  });
}

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

  it("drops names that are only the address", () => {
    expect(cleanPersonName("contracts@lawfirm.pt")).toBeUndefined();
    expect(cleanPersonName("nina", "nina@acme.com")).toBeUndefined();
    expect(cleanPersonName("Jane Doe (via Google Docs)")).toBe("Jane Doe");
  });

  it("strips reply prefixes from topics", () => {
    expect(mailTopic("Re: Fwd: AW: Pilot pricing")).toBe("Pilot pricing");
    expect(mailTopic("  ")).toBe("Email without a subject");
  });
});

describe("Gmail sent mail", () => {
  const sent = mails(gmailSent);

  it("captures everyone the owner wrote to, with the Cc from the headers", () => {
    const result = extractSentMail(sent[0], context("gmail"));
    expect(result.candidates).toEqual([
      {
        name: "Nina Keller",
        channels: [{ type: "EMAIL", value: "nina.keller@acme-robotics.com" }],
        interaction: {
          occurredAt: "2026-10-20T09:14:02.000Z",
          channel: "EMAIL",
          direction: "OUT",
          summary: "Pilot pricing for Q3",
          sourceRef:
            "gmail:user-patrick:18f1a2b3c4d5e6f7:nina.keller@acme-robotics.com",
        },
        borderline: false,
      },
      expect.objectContaining({
        name: undefined,
        channels: [{ type: "EMAIL", value: "tom.berger@acme-robotics.com" }],
      }),
    ]);
    expect(result.skipped).toEqual(["teammate"]);
  });

  it("sends a role inbox the owner wrote to the judge", () => {
    const [candidate] = extractSentMail(sent[1], context("gmail")).candidates;
    expect(candidate).toMatchObject({
      borderline: true,
      channels: [{ value: "support@vendor-saas.io" }],
    });
  });

  it("skips notification reply addresses and noreply", () => {
    expect(extractSentMail(sent[2], context("gmail"))).toEqual({
      candidates: [],
      skipped: ["automated_domain", "automated_sender"],
    });
  });

  it("skips auto-replies, calendar RSVPs and mass mailings whole", () => {
    expect(extractSentMail(sent[3], context("gmail")).skipped).toEqual([
      "auto_reply",
    ]);
    expect(extractSentMail(sent[4], context("gmail")).skipped).toEqual([
      "calendar_notice",
    ]);
    expect(extractSentMail(sent[5], context("gmail"))).toEqual({
      candidates: [],
      skipped: ["mass_mail"],
    });
  });

  it("treats the owner's work address as self from a private mailbox", () => {
    const result = extractSentMail(sent[6], context("gmail"));
    expect(result.skipped).toEqual(["self"]);
    expect(result.candidates.map((c) => c.channels[0]?.value)).toEqual([
      "max@gmail.com",
    ]);
  });
});

describe("Gmail received mail", () => {
  const received = mails(gmailReceived);

  it("reads the sender with title, company, phone and LinkedIn from the signature", () => {
    const result = extractInboundMail(received[0], context("gmail"));
    expect(result.candidates).toEqual([
      {
        name: "Nina Keller",
        organization: "Acme Robotics AG",
        role: "Head of Partnerships",
        channels: [
          { type: "EMAIL", value: "nina.keller@acme-robotics.com" },
          { type: "PHONE", value: "+41 79 123 45 67" },
          {
            type: "LINKEDIN",
            value: "https://www.linkedin.com/in/ninakeller",
          },
        ],
        interaction: expect.objectContaining({
          direction: "IN",
          summary: "Pilot pricing for Q3",
          sourceRef:
            "gmail:user-patrick:19a0000000000001:nina.keller@acme-robotics.com",
        }),
        borderline: false,
      },
    ]);
  });

  it.each([
    [1, "bulk_header"],
    [2, "bulk_category"],
    // A bounce: its subject marks it before its address does.
    [3, "auto_reply"],
    [5, "teammate"],
    [6, "automated_sender"],
    [7, "automated_domain"],
  ])("drops message %i as %s", (index, reason) => {
    expect(extractInboundMail(received[index], context("gmail"))).toEqual({
      candidates: [],
      skipped: [reason],
    });
  });

  it("leaves a cold inbound person to the answered-only check", () => {
    const result = extractInboundMail(received[4], context("gmail"));
    expect(result.candidates).toHaveLength(1);
  });
});

describe("Outlook mail", () => {
  it("captures To and Cc of sent mail with the web link", () => {
    const [mail] = mails(outlookSent);
    const result = extractSentMail(mail, context("outlook"));
    expect(result.skipped).toEqual(["teammate"]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        name: "Ana Silva",
        interaction: expect.objectContaining({
          occurredAt: "2026-10-20T13:05:00.000Z",
          summary: "Contract draft",
          sourceUrl:
            "https://outlook.office365.com/owa/?ItemID=AAMkAGI2TG93AAA%3D",
        }),
        borderline: false,
      }),
      expect.objectContaining({
        name: undefined,
        channels: [{ type: "EMAIL", value: "contracts@lawfirm.pt" }],
        borderline: false,
      }),
    ]);
  });

  it("reads an HTML signature and drops a digest with List-Unsubscribe", () => {
    const [answer, digest] = mails(outlookReceived);
    expect(extractInboundMail(answer, context("outlook")).candidates).toEqual([
      expect.objectContaining({
        name: "Ana Silva",
        role: "Partner",
        organization: "Silva & Costa Advogados",
        channels: [
          { type: "EMAIL", value: "ana.silva@lawfirm.pt" },
          { type: "PHONE", value: "+351 21 000 0000" },
        ],
      }),
    ]);
    expect(extractInboundMail(digest, context("outlook")).skipped).toEqual([
      "bulk_header",
    ]);
  });

  function htmlBody(content: string) {
    return parseMail({
      id: "html",
      sentDateTime: "2026-10-20T13:05:00Z",
      body: { contentType: "html", content },
    })?.body;
  }

  it("strips nested tags that reassemble after one pass", () => {
    const body = htmlBody(
      "<p>Hi</p><scr<script>ipt>x</script><sty<style>y</style>le>z</style>",
    );
    expect(body).not.toMatch(/<\s*(script|style)/i);
    expect(body).not.toContain("<");
    expect(body).toContain("Hi");
  });

  it("decodes entities once", () => {
    expect(htmlBody("<p>a &amp;lt; b &lt; c &amp;quot;</p>")).toBe(
      "a &lt; b < c &quot;\n",
    );
  });
});

describe("signatures", () => {
  it("ignores the quoted reply, so the owner's own signature never sticks", () => {
    expect(
      parseSignature(
        "Thanks!\n\nOn Mon, Patrick wrote:\n> Patrick Tobler\n> CEO, Yellowhouse GmbH",
        "Patrick Tobler",
      ),
    ).toEqual({});
  });

  it("needs a title word before it calls a line a role", () => {
    expect(
      parseSignature("Cheers\nNina Keller\nZurich, Switzerland", "Nina Keller"),
    ).toEqual({});
    expect(
      parseSignature(
        "Best\nTom Berger\nCTO at Acme Robotics\n+41 44 000 00 00",
        "Tom Berger",
      ),
    ).toEqual({
      role: "CTO",
      organization: "Acme Robotics",
      phone: "+41 44 000 00 00",
    });
  });
});

describe("calendar", () => {
  const events = googleEvents.items.map((raw) => {
    const event = parseEvent(raw);
    if (!event) throw new Error("fixture did not parse");
    return event;
  });

  it("captures the external people at a real meeting, not the room, the owner, a teammate or a decliner", () => {
    const result = extractMeeting(events[0], context("googlecalendar"), NOW);
    expect(result.candidates.map((c) => c.channels[0]?.value)).toEqual([
      "nina.keller@acme-robotics.com",
      "sara@acme-robotics.com",
    ]);
    expect(result.candidates[0]).toMatchObject({
      name: "Nina Keller",
      interaction: {
        occurredAt: "2026-10-14T08:00:00.000Z",
        channel: "MEETING",
        direction: "BOTH",
        summary: "Pilot kickoff with Acme",
        sourceRef:
          "googlecalendar:user-patrick:evt_pilot_kickoff:nina.keller@acme-robotics.com",
        sourceUrl:
          "https://www.google.com/calendar/event?eid=evt_pilot_kickoff",
      },
    });
    expect(result.skipped.sort()).toEqual(
      ["declined", "room_or_resource", "self", "teammate"].sort(),
    );
  });

  it.each([
    [1, "large_meeting"],
    [2, "not_a_meeting"],
    [3, "not_a_meeting"],
    [4, "not_a_meeting"],
    [5, "declined"],
  ])("skips event %i as %s", (index, reason) => {
    expect(
      extractMeeting(events[index], context("googlecalendar"), NOW),
    ).toEqual({ candidates: [], skipped: [reason] });
  });

  it("waits for a meeting that has not started", () => {
    expect(extractMeeting(events[6], context("googlecalendar"), NOW)).toEqual({
      candidates: [],
      skipped: [],
    });
  });

  it("reads Outlook events in UTC, with resource and declined attendees", () => {
    const [review, away] = outlookEvents.value.map((raw) => parseEvent(raw));
    if (!review || !away) throw new Error("fixture did not parse");
    expect(review.startsAt).toBe("2026-10-15T14:00:00.000Z");
    const result = extractMeeting(review, context("outlook"), NOW);
    expect(result.candidates.map((c) => c.channels[0]?.value)).toEqual([
      "ana.silva@lawfirm.pt",
    ]);
    expect(result.skipped).toEqual(["room_or_resource", "declined"]);
    expect(extractMeeting(away, context("outlook"), NOW).skipped).toEqual([
      "not_a_meeting",
    ]);
  });
});

describe("Slack", () => {
  const owner = slack.authTest.user_id;
  const conversations = slack.conversations.channels.map((raw) => {
    const conversation = parseSlackConversation(raw);
    if (!conversation) throw new Error("fixture did not parse");
    return conversation;
  });

  it("logs a direct message day the owner wrote, as both ways when both did", () => {
    const [nina] = conversations;
    const talks = extractSlackConversation({
      conversation: nina,
      days: slackDays(slack.history.D0NINA.messages),
      ownerSlackId: owner,
      teamId: "T0YH",
      teammateUserId: "user-patrick",
    });
    // The day only Nina wrote is not the owner talking.
    expect(talks).toEqual([
      { day: "2026-10-20", userId: "U0NINA", direction: "BOTH" },
    ]);
  });

  it("ignores bots and channel joins", () => {
    const days = slackDays([
      ...slack.history.D0BOT.messages,
      ...slack.history.C0SMALL.messages,
    ]);
    expect([...days.values()].flatMap((posters) => [...posters])).not.toContain(
      "U0BOT",
    );
    const small = conversations[3];
    expect(
      extractSlackConversation({
        conversation: small,
        days: slackDays(slack.history.C0SMALL.messages),
        ownerSlackId: owner,
        teamId: "T0YH",
        teammateUserId: "user-patrick",
      }),
    ).toEqual([{ day: "2026-10-20", userId: "U0LUKAS", direction: "BOTH" }]);
  });

  it("builds a contact with the Slack id, the verified email and the title", () => {
    const profile = parseSlackProfile(slack.users.U0NINA);
    if (!profile) throw new Error("fixture did not parse");
    expect(
      slackCandidate({
        profile,
        conversation: conversations[0],
        day: "2026-10-20",
        direction: "BOTH",
        teammateUserId: "user-patrick",
        teamId: "T0YH",
      }),
    ).toEqual({
      name: "Nina Keller",
      role: "Head of Partnerships",
      channels: [
        { type: "SLACK", value: "T0ACME:U0NINA", verified: true },
        {
          type: "EMAIL",
          value: "nina.keller@acme-robotics.com",
          verified: true,
        },
      ],
      interaction: {
        occurredAt: "2026-10-20T12:00:00.000Z",
        channel: "SLACK",
        direction: "BOTH",
        summary: "Slack direct message",
        sourceRef: "slack:user-patrick:D0NINA:2026-10-20:U0NINA",
      },
      borderline: false,
    });
  });

  it("marks bots and keeps a profile without an email", () => {
    expect(parseSlackProfile(slack.users.U0BOT)?.isBot).toBe(true);
    expect(parseSlackProfile(slack.users.U0LUKAS)).toMatchObject({
      name: "Lukas Meier",
      email: null,
      title: "CTO",
      phone: "+41 44 555 66 77",
    });
  });
});
