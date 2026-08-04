import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
} from "@/app/components/shell-hydrators.client";

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
});
