import type { ChatRoomMessage } from "@/lib/clients/generated/core";
import { raceWithTimeout } from "@/lib/utils/race-with-timeout";

const CLASSIC_OUTBOUND_SEND_TIMEOUT_MS = 30_000;
const activeRuns = new WeakMap<ClassicOutboundQueueRefs, symbol>();

/** Framework-neutral mutable box (React refs satisfy this shape). */
export interface MutableContainer<T> {
  current: T;
}

/** Classic POST job retained for single-flight queue + failed-send retry. */
export interface ClassicOutboundJob {
  roomId: string;
  content: string;
  mentionedCoworkerIds: string[];
  mentionedSokoBotIds: string[];
  mentionedUserIds: string[];
  quote?: { messageId: string };
  clientMessageId: string;
  parentMessageId?: string;
}

export type ClassicOutboundSendResult =
  | { ok: true; value: ChatRoomMessage }
  | { ok: false; error: { message: string } };

export interface ClassicOutboundQueueRefs {
  queueRef: MutableContainer<string[]>;
  jobsRef: MutableContainer<Map<string, ClassicOutboundJob>>;
  runningRef: MutableContainer<boolean>;
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
  const run = Symbol();
  activeRuns.set(refs, run);
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
        // A timeout releases this local queue, not the underlying server
        // action. Retain the same clientMessageId for an explicit safe retry.
        const result = await raceWithTimeout(
          send(job),
          CLASSIC_OUTBOUND_SEND_TIMEOUT_MS,
        );
        if (activeRuns.get(refs) !== run) return;
        if (!result.ok) {
          onFailure(job, result.error.message);
          continue;
        }
        refs.jobsRef.current.delete(clientMessageId);
        onSuccess(job, result.value);
      } catch {
        if (activeRuns.get(refs) !== run) return;
        onFailure(job, unknownFailureMessage);
      }
    }
  } finally {
    // A room change can start another run before this old request settles.
    if (activeRuns.get(refs) === run) {
      activeRuns.delete(refs);
      refs.runningRef.current = false;
      if (refs.queueRef.current.length > 0) {
        void drainClassicOutboundQueue(params);
      }
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
  activeRuns.delete(refs);
  refs.runningRef.current = false;
  refs.queueRef.current = [];
  refs.jobsRef.current.clear();
}
