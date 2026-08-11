import type { SocialProviderId } from "@/lib/schemas/auth";

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

  signUp(provider: SocialProviderId) {
    fireEvent({
      event: "sign_up",
      provider,
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

  signIn(provider: SocialProviderId) {
    fireEvent({
      event: "login",
      provider,
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

  viewCredits() {
    fireEvent({
      event: "view_credits",
    });
  },

  beginCheckout() {
    fireEvent({
      event: "begin_checkout",
    });
  },

  purchase(
    sessionId: string,
    currency: string | null,
    value: number | null,
    items: { item_id: string; item_name: string; quantity: number | null }[],
  ) {
    fireEvent({
      event: "purchase",
      transaction_id: sessionId,
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

  /**
   * A user started a direct-message conversation with a coworker (fires on the
   * first message they send in a room this session).
   */
  messageStart(roomId: string) {
    fireEvent({
      event: "message_start",
      room_id: roomId,
    });
  },

  /** A user finished onboarding. */
  onboardingComplete() {
    fireEvent({
      event: "onboarding_complete",
    });
  },
};
