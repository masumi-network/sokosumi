import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  listAnnouncements,
  saveAnnouncementDraft,
  setAnnouncementLive,
} from "./announcements.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const made: string[] = [];

describe.runIf(enabled)("announcements on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.notice.deleteMany({ where: { id: { in: made } } });
  });

  it("saves a hidden draft, keeps its cover, publishes and ends it", async () => {
    const draft = await saveAnnouncementDraft(prisma, undefined, {
      title: "New this week",
      summary: "Three changes",
      body: "- One",
      coverUrl: "https://blob.example/week.mp4",
      action: { label: "Open Contacts", path: "/contacts" },
    });
    if (!draft || draft === "live") throw new Error("expected a draft");
    made.push(draft.announcementId);
    expect(draft).toMatchObject({
      live: false,
      coverUrl: "https://blob.example/week.mp4",
      action: { label: "Open Contacts", path: "/contacts" },
    });

    const edited = await saveAnnouncementDraft(prisma, draft.announcementId, {
      title: "New this week, edited",
      summary: "Three changes",
      body: "- One\n- Two",
      action: null,
    });
    expect(edited).toMatchObject({
      title: "New this week, edited",
      body: "- One\n- Two",
      coverUrl: "https://blob.example/week.mp4",
      action: null,
    });

    const live = await setAnnouncementLive(prisma, draft.announcementId, true);
    expect(live?.live).toBe(true);
    const notice = await prisma.notice.findUniqueOrThrow({
      where: { id: draft.announcementId },
    });
    expect(notice.effectiveAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await expect(
      saveAnnouncementDraft(prisma, draft.announcementId, {
        title: "Sneaky edit",
        summary: "x",
        body: "",
        action: null,
      }),
    ).resolves.toBe("live");

    await setAnnouncementLive(prisma, draft.announcementId, false);
    const listed = await listAnnouncements();
    expect(
      listed.find((item) => item.announcementId === draft.announcementId),
    ).toMatchObject({ live: false, title: "New this week, edited" });
  });

  it("never touches a legal notice", async () => {
    const legal = await prisma.notice.create({
      data: { kind: "LEGAL_TERMS", bodyMarkdown: "Terms", isActive: false },
    });
    made.push(legal.id);
    await expect(setAnnouncementLive(prisma, legal.id, true)).resolves.toBe(
      null,
    );
    await expect(
      saveAnnouncementDraft(prisma, legal.id, {
        title: "x",
        summary: "x",
        body: "",
        action: null,
      }),
    ).resolves.toBe(null);
  });
});
