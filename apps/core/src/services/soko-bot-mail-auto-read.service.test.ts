import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  modify: vi.fn(),
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: mocks.active,
  modifyInboxMessages: mocks.modify,
}));

import type { TriagedMail } from "@/lib/soko-bot/mail-triage";
import { autoReadBulkMail } from "./soko-bot-mail-auto-read.service";

const gmail = {
  id: "integration",
  provider: {
    id: "gmail",
    tools: { modifyMessages: "GMAIL_BATCH_MODIFY_MESSAGES" },
  },
};

function mail(id: string, tag: TriagedMail["tag"], unread = true): TriagedMail {
  return { tag, message: { id, provider: "gmail", unread } } as TriagedMail;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue([gmail]);
  mocks.modify.mockResolvedValue(undefined);
});

describe("autoReadBulkMail", () => {
  it("marks only unread bulk mail read, leaving urgent and notable unread", async () => {
    const result = await autoReadBulkMail("bot", [
      mail("bulk", "BULK"),
      mail("urgent", "URGENT"),
      mail("notable", "NOTABLE"),
      mail("seen", "BULK", false),
    ]);
    expect(mocks.modify).toHaveBeenCalledOnce();
    expect(mocks.modify).toHaveBeenCalledWith(gmail, ["bulk"], { read: true });
    expect(result).toEqual({ markedRead: 1, failed: 0 });
  });

  it("does nothing when there is no bulk mail", async () => {
    const result = await autoReadBulkMail("bot", [mail("urgent", "URGENT")]);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(result).toEqual({ markedRead: 0, failed: 0 });
  });

  it("counts a refusing mailbox as failed instead of throwing", async () => {
    mocks.modify.mockRejectedValue(new Error("insufficient scope"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await autoReadBulkMail("bot", [mail("bulk", "BULK")]);
    expect(result).toEqual({ markedRead: 0, failed: 1 });
  });
});
