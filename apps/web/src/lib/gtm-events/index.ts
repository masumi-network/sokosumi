import type { AuthMethodId } from "@/lib/schemas/auth";

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

  signUp(provider: AuthMethodId) {
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

  signIn(provider: AuthMethodId) {
    fireEvent({
      event: "login",
      provider,
    });
  },

  viewCredits() {
    fireEvent({
      event: "view_credits",
    });
  },

  /**
   * Fire BEFORE the hard navigation to Stripe: the push must be in the
   * dataLayer before `window.location.href` changes.
   */
  beginCheckout(params?: { plan?: string; seats?: number }) {
    fireEvent({
      event: "begin_checkout",
      ...params,
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
};
