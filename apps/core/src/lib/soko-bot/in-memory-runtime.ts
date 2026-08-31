import { randomUUID } from "node:crypto";

import type {
  IndexedRuntimeEvent,
  RuntimeCancelInput,
  RuntimeEvent,
  RuntimeEventStreamInput,
  RuntimeHealth,
  RuntimeInspectInput,
  RuntimeResetInput,
  RuntimeTurnInput,
  RuntimeTurnRef,
  SokoBotRuntime,
} from "@sokosumi/soko-bot";

function event(type: string, data: Record<string, unknown>): RuntimeEvent {
  return {
    type,
    data,
    meta: { id: `evt_${randomUUID()}`, at: new Date().toISOString() },
  };
}

export class InMemorySokoBotRuntime implements SokoBotRuntime {
  private readonly sessions = new Map<string, RuntimeEvent[]>();
  private failure: Error | null = null;

  failNext(error: Error): void {
    this.failure = error;
  }

  append(sessionId: string, nextEvent: RuntimeEvent): void {
    const events = this.sessions.get(sessionId);
    if (!events) throw new Error("Unknown in-memory session");
    events.push(nextEvent);
  }

  private maybeFail(): void {
    if (!this.failure) return;
    const failure = this.failure;
    this.failure = null;
    throw failure;
  }

  async createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef> {
    this.maybeFail();
    const sessionId = `session_${randomUUID()}`;
    this.sessions.set(sessionId, [
      event("session.started", { sessionId }),
      event("turn.started", { turnId: `turn_${randomUUID()}` }),
      event("message.received", { message: input.message }),
      event("message.completed", {
        message: "In-memory Soko Bot response",
        finishReason: "stop",
      }),
      event("turn.completed", {}),
      event("session.waiting", {}),
    ]);
    return {
      sessionId,
      runtimeVersion: "in-memory",
      acceptedAt: new Date().toISOString(),
    };
  }

  async *streamEvents(
    input: RuntimeEventStreamInput,
  ): AsyncIterable<IndexedRuntimeEvent> {
    this.maybeFail();
    const events = this.sessions.get(input.sessionId) ?? [];
    for (
      let index = Math.max(0, input.startIndex);
      index < events.length;
      index += 1
    ) {
      const nextEvent = events[index];
      if (nextEvent) yield { startIndex: index, event: nextEvent };
    }
  }

  async cancelTurn(input: RuntimeCancelInput): Promise<void> {
    this.maybeFail();
    this.sessions
      .get(input.sessionId)
      ?.push(
        event("turn.cancelled", { turnId: input.eveTurnId ?? null }),
        event("session.waiting", {}),
      );
  }

  async resetSession(input: RuntimeResetInput): Promise<void> {
    this.maybeFail();
    this.sessions.delete(input.sessionId);
  }

  async inspectSession(input: RuntimeInspectInput): Promise<RuntimeHealth> {
    return {
      healthy: this.sessions.has(input.sessionId),
      runtimeVersion: "in-memory",
      sessionStatus: this.sessions.has(input.sessionId) ? "waiting" : null,
    };
  }
}
