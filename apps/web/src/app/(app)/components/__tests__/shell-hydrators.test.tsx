import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountNotice } from "@/app/components/account-notice-state";

const hydrateAccountNoticeMock = vi.fn();

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNoticeHydration: () => hydrateAccountNoticeMock,
}));

vi.mock("@/app/components/notice-dialog-context", () => ({
  useNoticeDialogHydration: () => vi.fn(),
}));

import { AccountNoticeHydrator } from "@/app/components/shell-hydrators.client";

const ACCOUNT_NOTICE: AccountNotice = {
  email: "alice@example.com",
  tone: "warning",
  type: "emailVerification",
};

describe("shell hydrators", () => {
  beforeEach(() => {
    hydrateAccountNoticeMock.mockReset();
  });

  it("hydrates account notice", () => {
    render(<AccountNoticeHydrator accountNotice={ACCOUNT_NOTICE} />);

    expect(hydrateAccountNoticeMock).toHaveBeenCalledWith(ACCOUNT_NOTICE);
  });
});
