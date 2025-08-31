import { CheckoutSessionData } from "@/lib/clients";

import { fireEvent } from "./utils";

export const fireGTMEvent = {
  viewRegisterArea() {
    fireEvent({
      event: "view_register_area",
    });
  },

  registerFormStart() {
    fireEvent({
      event: "register_form_start",
    });
  },

  signUp() {
    fireEvent({
      event: "sign_up",
    });
  },

  doiConfirmed() {
    fireEvent({
      event: "doi_confirmed",
    });
  },

  viewLoginArea() {
    fireEvent({
      event: "view_login_area",
    });
  },

  loginAreaFormStart() {
    fireEvent({
      event: "login_area_form_start",
    });
  },

  login() {
    fireEvent({
      event: "login",
    });
  },

  freeCreditStartCheckout() {
    fireEvent({
      event: "free_credit_start_checkout",
    });
  },

  /**
   * @param sessionId - The ID of the checkout session.
   */
  freeCreditPurchase(sessionId: string) {
    fireEvent({
      event: "free_credit_purchase",
      transaction_id: sessionId,
    });
  },

  /**
   * @param agentName - The name of the agent.
   * @param credits - The number of credits to run a job on agent.
   */
  agentHired(agentName: string, credits: number) {
    fireEvent({
      event: "agent_hired",
      agent_name: agentName,
      agent_price: credits.toString(),
    });
  },

  viewBilling() {
    fireEvent({
      event: "view_billing",
    });
  },

  beginCheckout() {
    fireEvent({
      event: "begin_checkout",
    });
  },

  purchase(checkoutSession: CheckoutSessionData) {
    const { session_id, currency, items, value } = checkoutSession;
    fireEvent({
      event: "purchase",
      transaction_id: session_id,
      value,
      currency,
      items,
    });
  },

  viewAgent(agentName: string, credits: number) {
    fireEvent({
      event: "view_agent",
      agent_name: agentName,
      agent_price: credits.toString(),
    });
  },
};
