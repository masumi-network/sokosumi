import type { z } from "@hono/zod-openapi";
import { createContactSchema, updateContactSchema } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { defaultValidationHook } from "@/lib/hono";
import { metadataBatchBodySchema } from "@/routes/v1/drive/resources/metadata-batch/post";
import {
  addChatRoomMembersRequestSchema,
  createChatRoomRequestSchema,
  updateChatRoomRequestSchema,
} from "@/schemas/chat-room.schema";
import { createChatRoomGuestInviteLinkRequestSchema } from "@/schemas/chat-room-guest-invite-link.schema";
import { createChatRoomInvitationRequestSchema } from "@/schemas/chat-room-invitation.schema";
import { linkDriveGoogleSheetRequestSchema } from "@/schemas/drive-file.schema";
import { updateFileMetadataRequestSchema } from "@/schemas/file-resource.schema";
import { updateTeamStandupSchema } from "@/schemas/team-standup.schema";

/** The 422 message a route sends for this body. */
function refusal(schema: z.ZodType, body: unknown): string {
  try {
    defaultValidationHook(schema.safeParse(body));
  } catch (error) {
    if (error instanceof HTTPException && error.status === 422)
      return error.message;
    throw error;
  }
  throw new Error("expected a 422");
}

// SOKD-489: `{"visibility":"private"}` made a public channel with a 201.
describe("chat bodies that set access refuse unknown keys", () => {
  it("names a guessed privacy key on a new channel and lists the real ones", () => {
    expect(
      refusal(createChatRoomRequestSchema, {
        kind: "channel",
        slug: "e2e-x",
        visibility: "private",
      }),
    ).toBe(
      'Unknown key "visibility". This body takes: kind, name, slug, topic, discoverability, memberUserIds, coworkerIds, sokoBotIds.',
    );
  });

  it.each([
    [
      "a direct room",
      createChatRoomRequestSchema,
      { kind: "direct", private: true },
    ],
    ["a room update", updateChatRoomRequestSchema, { external: true }],
    [
      "new members",
      addChatRoomMembersRequestSchema,
      { userIds: ["u"], role: "admin" },
    ],
    [
      "an invitation",
      createChatRoomInvitationRequestSchema,
      { email: "a@b.co", role: "guest" },
    ],
    [
      "an invite link",
      createChatRoomGuestInviteLinkRequestSchema,
      { expiresInDays: 7, uses: 3 },
    ],
  ] as const)("refuses an unknown key on %s", (_label, schema, body) => {
    expect(refusal(schema, body)).toMatch(
      /^Unknown key "\w+"\. This body takes: /,
    );
  });

  it("still takes a private channel by its real key", () => {
    expect(
      createChatRoomRequestSchema.safeParse({
        kind: "channel",
        slug: "e2e-x",
        discoverability: "private",
      }).success,
    ).toBe(true);
  });
});

// SOKD-485: five guessed keys answered 200, moved the revision 4 → 9 and changed nothing.
describe("Drive writes refuse unknown keys and empty edits", () => {
  it("names a guessed tag key and lists the real ones", () => {
    expect(
      refusal(updateFileMetadataRequestSchema, {
        expectedMetadataRevision: 5,
        tagIds: ["label"],
      }),
    ).toMatch(
      /^Unknown key "tagIds"\. This body takes: expectedMetadataRevision, addTagLabelIds, /,
    );
  });

  it("refuses a metadata edit with no change", () => {
    expect(
      refusal(updateFileMetadataRequestSchema, { expectedMetadataRevision: 5 }),
    ).toMatch(/^Send at least one change: addTagLabelIds, removeTagLabelIds, /);
  });

  it("names a guessed key on a batch edit and refuses an empty batch", () => {
    const batch = {
      scope: "me",
      resourceIds: ["r1"],
      idempotencyKey: "key-abcdefgh",
    };
    expect(
      refusal(metadataBatchBodySchema, { ...batch, addTagIds: ["label"] }),
    ).toMatch(/^Unknown key "addTagIds"\. This body takes: resourceIds, /);
    expect(refusal(metadataBatchBodySchema, batch)).toBe(
      "Send at least one change: addTagLabelIds, removeTagLabelIds, categoryLabelId.",
    );
  });

  it("takes folderPath on a Sheet import, as other Drive writes do", () => {
    expect(
      linkDriveGoogleSheetRequestSchema.parse({
        url: "https://docs.google.com/spreadsheets/d/x/edit",
        scope: "me",
        folderPath: "e2e-docs",
      }),
    ).toMatchObject({ folderPath: "e2e-docs" });
  });

  it("refuses two different folders on a Sheet import", () => {
    expect(
      refusal(linkDriveGoogleSheetRequestSchema, {
        url: "https://docs.google.com/spreadsheets/d/x/edit",
        scope: "me",
        folder: "a",
        folderPath: "b",
      }),
    ).toBe(
      "Key: folderPath - Send folder or folderPath, not two different folders.",
    );
  });
});

// SOKD-491: `email` and `company` answered 200 and were never saved.
describe("contact writes refuse unknown keys and empty updates", () => {
  it("names guessed keys on create", () => {
    expect(
      refusal(createContactSchema, {
        name: "Zed Fakename",
        email: "zed@example.com",
        company: "Probe Co",
      }),
    ).toMatch(/^Unknown keys "email", "company"\. This body takes: name, /);
  });

  it("refuses an update with no known field", () => {
    expect(refusal(updateContactSchema, { version: 1 })).toMatch(
      /^Send at least one field to change: /,
    );
  });
});

// SOKD-474: `{"time":"10:00"}` answered 200 and kept the old 09:00.
describe("the stand-up settings refuse unknown keys", () => {
  it("names a guessed time key and lists the real ones", () => {
    expect(refusal(updateTeamStandupSchema, { time: "10:00" })).toBe(
      'Unknown key "time". This body takes: enabled, timeOfDay, weekdays, timezone, weekInReviewWeekday.',
    );
  });

  it("still takes the keys Web sends", () => {
    expect(
      updateTeamStandupSchema.safeParse({
        enabled: true,
        timeOfDay: "10:00",
        weekdays: [1, 2, 3, 4, 5],
        timezone: "Europe/Berlin",
        weekInReviewWeekday: 5,
      }).success,
    ).toBe(true);
  });
});
