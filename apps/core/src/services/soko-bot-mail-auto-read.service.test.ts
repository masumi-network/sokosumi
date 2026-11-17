import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  modify: vi.fn(),
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: mocks.active,
  modifyInboxMessages: mocks.modify,
}));

import { createCoreLogger } from "@/lib/evlog";
import type { TriagedMail } from "@/lib/soko-bot/mail-triage";
import { SokoBotIntegrationError } from "@/services/composio-integration-tools.service";
import { expectCoreLog } from "@/test/core-log";
import { autoReadBulkMail } from "./soko-bot-mail-auto-read.service";

const gmail = {
  id: "integration",
  provider: {
    id: "gmail",
    name: "Gmail",
    tools: { modifyMessages: "GMAIL_BATCH_MODIFY_MESSAGES" },
  },
};

const log = () => createCoreLogger({ operation: "soko_bot_mail_triage" });

const outlook = {
  id: "integration-outlook",
  provider: {
    id: "outlook",
    name: "Outlook",
    tools: { modifyMessages: "OUTLOOK_BATCH_MODIFY_MESSAGES" },
  },
};

function mail(
  id: string,
  tag: TriagedMail["tag"],
  unread = true,
  provider = "gmail",
): TriagedMail {
  return { tag, message: { id, provider, unread } } as TriagedMail;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue([gmail]);
  mocks.modify.mockResolvedValue(undefined);
});

describe("autoReadBulkMail", () => {
  it("marks only unread bulk mail read, leaving urgent and notable unread", async () => {
    const result = await autoReadBulkMail(
      "bot",
      [
        mail("bulk", "BULK"),
        mail("urgent", "URGENT"),
        mail("notable", "NOTABLE"),
        mail("seen", "BULK", false),
      ],
      log(),
    );
    expect(mocks.modify).toHaveBeenCalledOnce();
    expect(mocks.modify).toHaveBeenCalledWith(gmail, ["bulk"], { read: true });
    expect(result).toEqual({ markedRead: 1, failed: 0 });
  });

  it("does nothing when there is no bulk mail", async () => {
    const result = await autoReadBulkMail(
      "bot",
      [mail("urgent", "URGENT")],
      log(),
    );
    expect(mocks.active).not.toHaveBeenCalled();
    expect(result).toEqual({ markedRead: 0, failed: 0 });
  });

  it("counts a refusing mailbox as failed instead of throwing", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not mark a Soko Bot owner's bulk mail as read",
    );
    mocks.modify.mockRejectedValue(new Error("insufficient scope"));
    const triage = log();
    const result = await autoReadBulkMail(
      "bot",
      [mail("bulk", "BULK")],
      triage,
    );
    triage.emit();
    expect(result).toEqual({ markedRead: 0, failed: 1 });
    expect(warnings[0]).toMatchObject({
      why: "Gmail rejected marking the mail as read",
      fix: expect.stringContaining("reconnect the mailbox"),
    });
    expect(warnings[0]?.event).toMatchObject({
      operation: "soko_bot_mail_triage",
      mailAutoReadFailures: [
        {
          sokoBotId: "bot",
          provider: "gmail",
          messages: 1,
          errorName: "Error",
        },
      ],
    });
  });

  it("keeps each refusing mailbox's provider and count on the check's event", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not mark a Soko Bot owner's bulk mail as read",
      2,
    );
    mocks.active.mockResolvedValue([gmail, outlook]);
    mocks.modify.mockRejectedValue(new Error("insufficient scope"));
    const triage = log();
    const result = await autoReadBulkMail(
      "bot",
      [
        mail("g1", "BULK"),
        mail("o1", "BULK", true, "outlook"),
        mail("o2", "BULK", true, "outlook"),
      ],
      triage,
    );
    triage.emit();
    expect(result).toEqual({ markedRead: 0, failed: 3 });
    expect(warnings[0]?.event).toBe(warnings[1]?.event);
    expect(warnings[0]?.event.mailAutoReadFailures).toEqual([
      { sokoBotId: "bot", provider: "gmail", messages: 1, errorName: "Error" },
      {
        sokoBotId: "bot",
        provider: "outlook",
        messages: 2,
        errorName: "Error",
      },
    ]);
  });

  it("never carries the provider's text, which can quote a mail", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not mark a Soko Bot owner's bulk mail as read",
    );
    mocks.modify.mockRejectedValue(
      new SokoBotIntegrationError(
        'Composio (GMAIL_BATCH_MODIFY_MESSAGES): {"subject":"Secret merger with Acme","key":"sk_live_abc123"}',
        "UPSTREAM",
        { operation: "GMAIL_BATCH_MODIFY_MESSAGES", status: 403 },
      ),
    );
    const triage = log();
    await autoReadBulkMail("bot", [mail("bulk", "BULK")], triage);
    triage.emit();
    expect(warnings[0]).toMatchObject({
      why: "Gmail rejected marking the mail as read",
    });
    expect(warnings[0]?.event.mailAutoReadFailures).toEqual([
      {
        sokoBotId: "bot",
        provider: "gmail",
        messages: 1,
        errorName: "Error",
        operation: "GMAIL_BATCH_MODIFY_MESSAGES",
        status: 403,
      },
    ]);
    const drained = JSON.stringify(warnings[0]?.event);
    expect(drained).not.toContain("Secret merger");
    expect(drained).not.toContain("sk_live");
  });

  it("still counts and swallows a refusal whose error throws when read", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not mark a Soko Bot owner's bulk mail as read",
    );
    const hostile = new Error("body");
    for (const key of ["name", "code", "details", "status"]) {
      Object.defineProperty(hostile, key, {
        get() {
          throw new Error("getter threw");
        },
      });
    }
    mocks.modify.mockRejectedValue(hostile);
    const triage = log();
    await expect(
      autoReadBulkMail("bot", [mail("bulk", "BULK")], triage),
    ).resolves.toEqual({ markedRead: 0, failed: 1 });
    triage.emit();
    expect(warnings[0]?.event.mailAutoReadFailures).toEqual([
      { sokoBotId: "bot", provider: "gmail", messages: 1, errorName: "Error" },
    ]);
  });
});
