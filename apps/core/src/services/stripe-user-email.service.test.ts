import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserByIdMock, updateCustomerEmailMock } = vi.hoisted(() => ({
  getUserByIdMock: vi.fn(),
  updateCustomerEmailMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    updateCustomerEmail: (...args: unknown[]) =>
      updateCustomerEmailMock(...args),
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import {
  handleUserUpdateStripeEmailSync,
  markPendingStripeEmailSyncForUserUpdate,
  prepareStripeEmailSyncForUserUpdate,
  resetStripeEmailSyncStateForTests,
  syncUserEmailWithStripe,
} from "@/services/stripe-user-email.service";

describe("stripe-user-email.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeEmailSyncStateForTests();
    getUserByIdMock.mockResolvedValue({
      id: "user_1",
      stripeCustomerId: "cus_1",
      email: "new@example.com",
    });
    updateCustomerEmailMock.mockResolvedValue({ id: "cus_1" });
  });

  describe("markPendingStripeEmailSyncForUserUpdate", () => {
    it("does not mark sync when email is unchanged", async () => {
      markPendingStripeEmailSyncForUserUpdate(
        { email: "same@example.com" },
        "user_1",
        "same@example.com",
      );

      await handleUserUpdateStripeEmailSync({
        id: "user_1",
        email: "same@example.com",
      });

      expect(updateCustomerEmailMock).not.toHaveBeenCalled();
    });

    it("syncs only when email changed", async () => {
      markPendingStripeEmailSyncForUserUpdate(
        { email: "new@example.com" },
        "user_1",
        "old@example.com",
      );

      await handleUserUpdateStripeEmailSync({
        id: "user_1",
        email: "new@example.com",
      });

      expect(updateCustomerEmailMock).toHaveBeenCalledWith(
        "cus_1",
        "new@example.com",
      );
    });

    it("falls back to normalized email when user id is unknown in before hook", async () => {
      markPendingStripeEmailSyncForUserUpdate(
        { email: "New@Example.com" },
        null,
        null,
      );

      await handleUserUpdateStripeEmailSync({
        id: "user_1",
        email: "new@example.com",
      });

      expect(updateCustomerEmailMock).toHaveBeenCalledWith(
        "cus_1",
        "new@example.com",
      );
    });
  });

  describe("prepareStripeEmailSyncForUserUpdate", () => {
    it("marks sync when session user email changes", async () => {
      getUserByIdMock.mockResolvedValueOnce({
        id: "user_1",
        email: "old@example.com",
        stripeCustomerId: "cus_1",
      });

      await prepareStripeEmailSyncForUserUpdate(
        { email: "new@example.com" },
        {
          session: {
            user: { id: "user_1" },
          },
        },
        {} as never,
      );

      await handleUserUpdateStripeEmailSync({
        id: "user_1",
        email: "new@example.com",
      });

      expect(getUserByIdMock).toHaveBeenCalled();
      expect(updateCustomerEmailMock).toHaveBeenCalledWith(
        "cus_1",
        "new@example.com",
      );
    });
  });

  describe("syncUserEmailWithStripe", () => {
    it("no-ops when user has no stripe customer", async () => {
      getUserByIdMock.mockResolvedValueOnce({
        id: "user_1",
        stripeCustomerId: null,
        email: "new@example.com",
      });

      await syncUserEmailWithStripe("user_1", "new@example.com");

      expect(updateCustomerEmailMock).not.toHaveBeenCalled();
    });
  });
});
