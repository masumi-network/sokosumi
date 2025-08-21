import { gtmEvents } from "./events";
import { fireEvent } from "./utils";

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
   */
  agentHired(agentName: string, credits: number) {
    fireEvent(gtmEvents.agentHired(agentName, credits));
  },
};
