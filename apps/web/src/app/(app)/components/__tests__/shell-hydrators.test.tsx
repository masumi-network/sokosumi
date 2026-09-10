import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountNotice } from "@/app/components/account-notice-state";

const hydrateAccountNoticeMock = vi.fn();

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNoticeHydration: () => hydrateAccountNoticeMock,
}));

vi.mock("@/app/components/notice-dialog-context", () => ({
  useNoticeDialogHydration: () => vi.fn(),
}));

import {
  AccountNoticeHydrator,
  RetiredOnboardingStorageHydrator,
} from "@/app/components/shell-hydrators.client";
import { RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY } from "@/lib/retired-onboarding-storage";

const ACCOUNT_NOTICE: AccountNotice = {
  email: "alice@example.com",
  tone: "warning",
  type: "emailVerification",
};

describe("shell hydrators", () => {
  beforeEach(() => {
    hydrateAccountNoticeMock.mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("hydrates account notice", () => {
    render(<AccountNoticeHydrator accountNotice={ACCOUNT_NOTICE} />);

    expect(hydrateAccountNoticeMock).toHaveBeenCalledWith(ACCOUNT_NOTICE);
  });

  it("removes retired onboarding localStorage on mount", () => {
    window.localStorage.setItem(
      RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      "sess-1",
    );

    render(<RetiredOnboardingStorageHydrator />);

    expect(
      window.localStorage.getItem(
        RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      ),
    ).toBeNull();
  });
});
