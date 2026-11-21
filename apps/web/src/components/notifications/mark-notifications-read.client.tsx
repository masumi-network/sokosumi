"use client";

import type { MarkNotificationsReadByReferenceRequest } from "@sokosumi/core-client";
import { useMarkNotificationsRead } from "@/hooks/effects/use-mark-notifications-read";

interface MarkNotificationsReadProps {
  /**
   * Only kinds whose own page can stand for reading them. Chat is not one.
   *
   * Taken from the Core contract rather than written out again here, so a kind
   * added to or removed from the route cannot leave this page offering one the
   * route refuses.
   */
  kind: MarkNotificationsReadByReferenceRequest["kind"];
  /** The task or job this page is showing. */
  referenceId: string;
}

/**
 * Marks a task's or a job's notifications read because the reader opened it.
 *
 * Renders nothing. A chat room already does this, in the same write that moves
 * its `lastReadAt`, so a room still unread is one nothing has happened to. A
 * task or a job had no such signal: the row stayed unread until the reader
 * opened the notification itself, so someone who fixed a stalled task from the
 * task page left it unread and the follow-up sync reminded them a day later
 * about work they had already finished (SOK-916).
 *
 * An Effect, deliberately. Telling the server what the reader has seen is
 * synchronisation with an external system, which is what Effects are for. It
 * is keyed on the reference so that moving between two tasks clears both,
 * rather than only whichever one happened to mount the component.
 */
export function MarkNotificationsRead({
  kind,
  referenceId,
}: MarkNotificationsReadProps): null {
  useMarkNotificationsRead(kind, referenceId);

  return null;
}
