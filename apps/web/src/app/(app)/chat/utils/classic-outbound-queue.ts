import type { MutableRefObject } from "react";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

/** Classic POST job retained for single-flight queue + failed-send retry. */
export interface ClassicOutboundJob {
  roomId: string;
  content: string;
  mentionedCoworkerIds: string[];
  mentionedUserIds: string[];
  quote?: { messageId: string };
  clientMessageId: string;
  parentMessageId?: string;
}

export type ClassicOutboundSendResult =
  | { ok: true; value: ChatRoomMessage }
  | { ok: false; error: { message: string } };

export interface ClassicOutboundQueueRefs {
  queueRef: MutableRefObject<string[]>;
  jobsRef: MutableRefObject<Map<string, ClassicOutboundJob>>;
  runningRef: MutableRefObject<boolean>;
}

/**
 * Drain a single-flight classic outbound queue. Dequeues each head before
 * await so throws cannot re-loop the same job forever.
 */
export async function drainClassicOutboundQueue(params: {
  refs: ClassicOutboundQueueRefs;
  send: (job: ClassicOutboundJob) => Promise<ClassicOutboundSendResult>;
  onFailure: (job: ClassicOutboundJob, errorMessage: string) => void;
  onSuccess: (job: ClassicOutboundJob, message: ChatRoomMessage) => void;
  unknownFailureMessage: string;
}): Promise<void> {
  const { refs, send, onFailure, onSuccess, unknownFailureMessage } = params;
  if (refs.runningRef.current) {
    return;
  }
  refs.runningRef.current = true;
  try {
    while (refs.queueRef.current.length > 0) {
      const clientMessageId = refs.queueRef.current[0];
      if (!clientMessageId) {
        break;
      }
      const job = refs.jobsRef.current.get(clientMessageId);
      if (!job) {
        refs.queueRef.current.shift();
        continue;
      }
      // Always dequeue this head once we start it — throws must not re-loop.
      refs.queueRef.current.shift();
      try {
        const result = await send(job);
        if (!result.ok) {
          onFailure(job, result.error.message);
          continue;
        }
        refs.jobsRef.current.delete(clientMessageId);
        onSuccess(job, result.value);
      } catch {
        onFailure(job, unknownFailureMessage);
      }
    }
  } finally {
    refs.runningRef.current = false;
    if (refs.queueRef.current.length > 0) {
      void drainClassicOutboundQueue(params);
    }
  }
}

export function enqueueClassicOutboundJob(
  refs: ClassicOutboundQueueRefs,
  job: ClassicOutboundJob,
  drain: () => void,
): void {
  refs.jobsRef.current.set(job.clientMessageId, job);
  if (!refs.queueRef.current.includes(job.clientMessageId)) {
    refs.queueRef.current.push(job.clientMessageId);
  }
  drain();
}

export function clearClassicOutboundQueue(
  refs: ClassicOutboundQueueRefs,
): void {
  refs.queueRef.current = [];
  refs.jobsRef.current.clear();
}
