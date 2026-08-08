/**
 * The text a push notification shows on the lock screen.
 *
 * This exists because of an awkward split: Core owns the *keys* — it emits all
 * seven of them — but the human strings live in the web app's message
 * catalogue, and a push has to carry a rendered string at send time. There is
 * nowhere else to put this.
 *
 * English only, and that is a real limitation rather than an oversight: Core
 * has no locale infrastructure and no notion of a user's language, so there is
 * nothing to select a translation with. Every push therefore also carries its
 * `messageKey` and params in `data`, so a client that *does* know the user's
 * language can render its own copy and treat this as the fallback it is.
 */

export interface PushCopy {
  title: string;
  body: string;
}

type Params = Record<string, unknown>;

function text(params: Params, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

/**
 * Renders one notification, or nothing.
 *
 * Returning null for an unknown key is deliberate: a new key added elsewhere in
 * Core should mean "this does not push yet", not a notification reading
 * "Notifications.Some.newKey" on someone's lock screen. Silence is the safer
 * default for a surface the user cannot correct.
 */
export function pushCopyFor(
  messageKey: string,
  messageParams: Params,
): PushCopy | null {
  switch (messageKey) {
    case "Notifications.Job.completed":
      return {
        title: text(messageParams, "agentName", "Your agent"),
        body: `Finished ${text(messageParams, "jobName", "a run")}.`,
      };

    case "Notifications.Job.inputRequired":
      return {
        title: text(messageParams, "agentName", "Your agent"),
        body: `Needs an answer to continue ${text(messageParams, "jobName", "a run")}.`,
      };

    case "Notifications.Job.paymentFailed":
      return {
        title: "Payment failed",
        body: `${text(messageParams, "jobName", "A run")} could not be paid for.`,
      };

    case "Notifications.Task.inputRequired":
      return {
        title: text(messageParams, "coworkerName", "Your coworker"),
        body: `Needs an answer to continue ${text(messageParams, "taskName", "a task")}.`,
      };

    case "Notifications.Chat.directMessage":
      return {
        title: text(messageParams, "senderName", "New message"),
        // Deliberately not the message text. A lock screen is visible to
        // whoever is holding the phone, and the person who wrote it did not
        // agree to that.
        body: "Sent you a message.",
      };

    case "Notifications.Chat.mentioned":
      return {
        title: text(messageParams, "senderName", "You were mentioned"),
        body: `Mentioned you in ${text(messageParams, "roomName", "a conversation")}.`,
      };

    case "notifications.vendorGrant.pending":
      return {
        title: "Vendor access requested",
        body: `${text(messageParams, "vendorName", "A vendor")} requested access to your workspace.`,
      };

    default:
      return null;
  }
}
