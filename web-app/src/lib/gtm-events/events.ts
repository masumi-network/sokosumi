import { GTMEvent } from "./types";

export const gtmEvents = {
  viewRegisterArea(): GTMEvent {
    return {
      event: "view_register_area",
    };
  },

  registerFormStart(): GTMEvent {
    return {
      event: "register_form_start",
    };
  },

  signUp(): GTMEvent {
    return {
      event: "sign_up",
    };
  },

  doiConfirmed(): GTMEvent {
    return {
      event: "doi_confirmed",
    };
  },

  viewLoginArea(): GTMEvent {
    return {
      event: "view_login_area",
    };
  },

  loginAreaFormStart(): GTMEvent {
    return {
      event: "login_area_form_start",
    };
  },

  login(): GTMEvent {
    return {
      event: "login",
    };
  },

  freeCreditStartCheckout(): GTMEvent {
    return {
      event: "free_credit_start_checkout",
    };
  },

  /**
   * @param transactionId - The transaction ID of the checkout session.
   */
  freeCreditPurchase(transactionId: string): GTMEvent {
    return {
      event: "free_credit_purchase",
      transaction_id: transactionId,
    };
  },

  /**
   * @param agentName - The name of the agent.
   * @param credits - The number of credits to run a job on agent.
   */
  agentHired(agentName: string, credits: number): GTMEvent {
    return {
      event: "agent_hired",
      agent_name: agentName,
      agent_price: credits.toString(),
    };
  },
};
