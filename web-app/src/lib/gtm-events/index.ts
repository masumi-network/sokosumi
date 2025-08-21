import * as Sentry from "@sentry/nextjs";

import { gtmEvents } from "./events";
import { afterAgentHiredWebHook, fireEvent } from "./utils";

export const fireGMTEvent = {
  viewRegisterArea() {
    fireEvent(gtmEvents.viewRegisterArea());
  },

  registerFormStart() {
    fireEvent(gtmEvents.registerFormStart());
  },

  signUp() {
    fireEvent(gtmEvents.signUp());
  },

  doiConfirmed() {
    fireEvent(gtmEvents.doiConfirmed());
  },

  viewLoginArea() {
    fireEvent(gtmEvents.viewLoginArea());
  },

  loginAreaFormStart() {
    fireEvent(gtmEvents.loginAreaFormStart());
  },

  login() {
    fireEvent(gtmEvents.login());
  },

  freeCreditStartCheckout() {
    fireEvent(gtmEvents.freeCreditStartCheckout());
  },

  /**
   * @param transactionId - The transaction ID of the checkout session.
   */
  freeCreditPurchase(transactionId: string) {
    fireEvent(gtmEvents.freeCreditPurchase(transactionId));
  },

  /**
   * @param agentName - The name of the agent.
   * @param credits - The number of credits to run a job on agent.
   * @param email - The email of the user.
   */
  async agentHired(agentName: string, credits: number, email: string) {
    fireEvent(gtmEvents.agentHired(agentName, credits));
    try {
      const isSuccess = await afterAgentHiredWebHook(email);
      if (!isSuccess) {
        Sentry.captureMessage("Failed to call after agent hired webhook", {
          level: "warning",
          user: {
            email,
          },
        });
      }
    } catch (error) {
      Sentry.captureMessage("Failed to call after agent hired webhook", {
        level: "warning",
        user: {
          email,
        },
        extra: {
          error: String(error),
        },
      });
    }
  },
};
