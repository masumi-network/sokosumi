import type { Notice } from "@sokosumi/core-client";
import { NoticeKind } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountNotice } from "@/app/components/account-notice-state";
import {
  NoticeDialogProvider,
  type PendingNoticeGroups,
  useNoticeDialog,
} from "@/app/components/notice-dialog-context";
import {
  AccountNoticeProvider,
  useAccountNotice,
} from "@/contexts/account-notice-provider";

const { acknowledgeNoticeMock, getPendingNoticesMock } = vi.hoisted(() => ({
  acknowledgeNoticeMock: vi.fn().mockResolvedValue({ ok: true, value: null }),
  getPendingNoticesMock: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("@/lib/actions/notice/action", () => ({
  acknowledgeNoticeAction: acknowledgeNoticeMock,
  getPendingNoticesAction: getPendingNoticesMock,
}));

vi.mock("@/app/components/notice-dialog", () => ({
  NoticeDialog: ({ pendingNotices }: { pendingNotices: Notice[] }) => (
    <div data-testid="legal-notices">
      {pendingNotices.map((notice) => notice.id).join(",")}
    </div>
  ),
}));

const ACCOUNT_NOTICE: AccountNotice = {
  email: "alice@example.com",
  tone: "warning",
  type: "emailVerification",
};

const ANNOUNCEMENT_NOTICE = {
  id: "ann-1",
  kind: NoticeKind.ANNOUNCEMENT,
  bodyMarkdown: "# Update",
} as Notice;

const LEGAL_NOTICE = {
  id: "legal-1",
  kind: NoticeKind.LEGAL_TERMS,
  bodyMarkdown: "# Terms",
} as Notice;

function AccountNoticeProbe() {
  const { notice } = useAccountNotice();
  return (
    <div data-testid="account-notice">{notice ? notice.type : "none"}</div>
  );
}

function NoticeDialogProbe() {
  const { announcementNotices, dismissNotice } = useNoticeDialog();
  return (
    <div>
      <div data-testid="announcements">
        {announcementNotices.map((notice) => notice.id).join(",")}
      </div>
      {announcementNotices[0] ? (
        <button
          type="button"
          onClick={() => dismissNotice(announcementNotices[0]!)}
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

describe("deferred shell notice providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates AccountNoticeProvider from noticePromise without an effect", async () => {
    let resolveNotice!: (notice: AccountNotice | null) => void;
    const noticePromise = new Promise<AccountNotice | null>((resolve) => {
      resolveNotice = resolve;
    });

    render(
      <AccountNoticeProvider
        notice={null}
        noticePromise={noticePromise}
        sessionId="sess-1"
      >
        <AccountNoticeProbe />
      </AccountNoticeProvider>,
    );

    expect(screen.getByTestId("account-notice")).toHaveTextContent("none");

    await act(async () => {
      resolveNotice(ACCOUNT_NOTICE);
      await noticePromise;
    });

    expect(screen.getByTestId("account-notice")).toHaveTextContent(
      "emailVerification",
    );
  });

  it("hydrates NoticeDialogProvider from pendingNoticesPromise and dismisses announcements", async () => {
    let resolveNotices!: (groups: PendingNoticeGroups) => void;
    const pendingNoticesPromise = new Promise<PendingNoticeGroups>(
      (resolve) => {
        resolveNotices = resolve;
      },
    );

    render(
      <NoticeDialogProvider
        legalNotices={[]}
        announcementNotices={[]}
        pendingNoticesPromise={pendingNoticesPromise}
      >
        <NoticeDialogProbe />
      </NoticeDialogProvider>,
    );

    expect(screen.getByTestId("legal-notices")).toHaveTextContent("");
    expect(screen.getByTestId("announcements")).toHaveTextContent("");

    await act(async () => {
      resolveNotices({
        legalNotices: [LEGAL_NOTICE],
        announcementNotices: [ANNOUNCEMENT_NOTICE],
      });
      await pendingNoticesPromise;
    });

    expect(screen.getByTestId("legal-notices")).toHaveTextContent("legal-1");
    expect(screen.getByTestId("announcements")).toHaveTextContent("ann-1");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByTestId("announcements")).toHaveTextContent("");
    expect(acknowledgeNoticeMock).toHaveBeenCalledWith("ann-1");
  });
});
