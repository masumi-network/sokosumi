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
   * @param transactionId - The transaction ID of the checkout session.
   */
  freeCreditPurchase(transactionId: string) {
    fireEvent({
      event: "free_credit_purchase",
      transactionId,
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

  purchase() {
    fireEvent({
      event: "purchase",
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
