import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";
import type { AccountNotice } from "@/app/components/account-notice-state";

const hydrateAccountNoticeMock = vi.fn();
const hydrateCoworkersMock = vi.fn();

vi.mock("@/contexts/account-notice-provider", () => ({
  useAccountNoticeHydration: () => hydrateAccountNoticeMock,
}));

vi.mock("@/contexts/coworkers-context", () => ({
  useCoworkersHydration: () => hydrateCoworkersMock,
}));

vi.mock("@/app/components/notice-dialog-context", () => ({
  useNoticeDialogHydration: () => vi.fn(),
}));

import {
  AccountNoticeHydrator,
  CoworkersHydrator,
  RetiredOnboardingStorageHydrator,
} from "@/app/components/shell-hydrators.client";
import { RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY } from "@/lib/retired-onboarding-storage";

const ACCOUNT_NOTICE: AccountNotice = {
  email: "alice@example.com",
  tone: "warning",
  type: "emailVerification",
};

const COWORKERS: Coworker[] = [
  {
    id: "cw-1",
    name: "Helper",
    description: "Helps with tasks",
    useCase: "general",
    slug: "helper",
  },
];

describe("shell hydrator split", () => {
  beforeEach(() => {
    hydrateAccountNoticeMock.mockReset();
    hydrateCoworkersMock.mockReset();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("hydrates account notice without touching coworkers", () => {
    render(<AccountNoticeHydrator accountNotice={ACCOUNT_NOTICE} />);

    expect(hydrateAccountNoticeMock).toHaveBeenCalledWith(ACCOUNT_NOTICE);
    expect(hydrateCoworkersMock).not.toHaveBeenCalled();
  });

  it("hydrates coworkers without touching account notice", () => {
    render(<CoworkersHydrator coworkers={COWORKERS} />);

    expect(hydrateCoworkersMock).toHaveBeenCalledWith(COWORKERS);
    expect(hydrateAccountNoticeMock).not.toHaveBeenCalled();
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
