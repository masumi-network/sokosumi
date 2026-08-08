/**
 * The text a push notification shows on the lock screen.
 *
 * This exists because of an awkward split: Core owns the *keys* — it emits all
 * of them — but the human strings live in the web app's message catalogue, and
 * a push has to carry a rendered string at send time. There is nowhere else to
 * put this.
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
 * Every key Core emits.
 *
 * Kept as a list rather than left implicit so the test can assert that the two
 * stay in step. Jobs and tasks each assign their key from a switch, which is
 * easy to extend without noticing that the push copy did not follow.
 */
export const PUSH_MESSAGE_KEYS = [
  "Notifications.Job.completed",
  "Notifications.Job.failed",
  "Notifications.Job.inputRequired",
  "Notifications.Job.paymentFailed",
  "Notifications.Job.refundResolved",
  "Notifications.Job.disputeResolved",
  "Notifications.Task.completed",
  "Notifications.Task.failed",
  "Notifications.Task.canceled",
  "Notifications.Task.inputRequired",
  "Notifications.Task.approvalRequired",
  "Notifications.Task.authenticationRequired",
  "Notifications.Task.outOfCredits",
  "Notifications.Chat.directMessage",
  "Notifications.Chat.mentioned",
  "notifications.vendorGrant.pending",
] as const;

/**
 * Renders one notification, or nothing.
 *
 * Returning null for an unknown key is deliberate: a key added elsewhere in
 * Core should mean "this does not push yet", not a notification reading
 * "Notifications.Some.newKey" on someone's lock screen. Silence is the safer
 * default for a surface the user cannot correct.
 */
export function pushCopyFor(
  messageKey: string,
  messageParams: Params,
): PushCopy | null {
  // Jobs and tasks both name the thing that did the work and the work itself.
  const agent = () => text(messageParams, "agentName", "Your agent");
  const job = () => text(messageParams, "jobName", "a run");
  const coworker = () => text(messageParams, "coworkerName", "Your coworker");
  const task = () => text(messageParams, "taskName", "a task");
  // Chat sends `authorName`, not `senderName`.
  const author = () => text(messageParams, "authorName", "Someone");
  const room = () => text(messageParams, "roomName", "a conversation");

  switch (messageKey) {
    case "Notifications.Job.completed":
      return { title: agent(), body: `Finished ${job()}.` };
    case "Notifications.Job.failed":
      return { title: agent(), body: `${job()} failed.` };
    case "Notifications.Job.inputRequired":
      return { title: agent(), body: `Needs an answer to continue ${job()}.` };
    case "Notifications.Job.paymentFailed":
      return {
        title: "Payment failed",
        body: `${job()} could not be paid for.`,
      };
    case "Notifications.Job.refundResolved":
      return {
        title: "Refund resolved",
        body: `The refund for ${job()} is settled.`,
      };
    case "Notifications.Job.disputeResolved":
      return {
        title: "Dispute resolved",
        body: `The dispute over ${job()} is settled.`,
      };

    case "Notifications.Task.completed":
      return { title: coworker(), body: `Finished ${task()}.` };
    case "Notifications.Task.failed":
      return { title: coworker(), body: `${task()} failed.` };
    case "Notifications.Task.canceled":
      return { title: coworker(), body: `${task()} was cancelled.` };
    case "Notifications.Task.inputRequired":
      return {
        title: coworker(),
        body: `Needs an answer to continue ${task()}.`,
      };
    case "Notifications.Task.approvalRequired":
      return {
        title: coworker(),
        body: `Needs your approval to continue ${task()}.`,
      };
    case "Notifications.Task.authenticationRequired":
      return {
        title: coworker(),
        body: `Needs you to sign in to continue ${task()}.`,
      };
    case "Notifications.Task.outOfCredits":
      return {
        title: "Out of credits",
        body: `${task()} stopped — the workspace is out of credits.`,
      };

    case "Notifications.Chat.directMessage":
      return {
        title: author(),
        // Deliberately not the message text. A lock screen is visible to
        // whoever is holding the phone, and the person who wrote it did not
        // agree to that.
        body: "Sent you a message.",
      };
    case "Notifications.Chat.mentioned":
      return { title: author(), body: `Mentioned you in ${room()}.` };

    case "notifications.vendorGrant.pending":
      return {
        title: "Vendor access requested",
        body: `${text(messageParams, "vendorName", "A vendor")} requested access to your workspace.`,
      };

    default:
      return null;
  }
}
