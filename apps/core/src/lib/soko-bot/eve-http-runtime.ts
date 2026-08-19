import type {
  IndexedRuntimeEvent,
  RuntimeCancelInput,
  RuntimeEventStreamInput,
  RuntimeHealth,
  RuntimeInspectInput,
  RuntimeResetInput,
  RuntimeTurnInput,
  RuntimeTurnRef,
  SokoBotRuntime,
} from "@sokosumi/soko-bot";
import {
  eveAcceptedResponseSchema,
  sokoBotRuntimeCommandResponseSchema,
  sokoBotRuntimeEventSchema,
} from "@sokosumi/soko-bot";

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { message: string } };
}

export const EVE_CONTROL_REQUEST_TIMEOUT_MS = 15_000;
export const EVE_CONTROL_MAX_RESPONSE_BYTES = 262_144;
export const EVE_STREAM_MAX_EVENT_BYTES = 1_048_576;

function commandSignal(callerSignal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(EVE_CONTROL_REQUEST_TIMEOUT_MS);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}

export class EveRuntimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "EveRuntimeError";
  }
}

export class EveRuntimeWireError extends EveRuntimeError {
  constructor(message: string, detail: string) {
    super(message, 502, detail.slice(0, 2_000));
    this.name = "EveRuntimeWireError";
  }
}

function wireErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown wire error";
}

function parseRuntimeEvent(bytes: Uint8Array) {
  let line: string;
  try {
    line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new EveRuntimeWireError(
      "Eve stream returned invalid UTF-8",
      wireErrorDetail(error),
    );
  }
  if (!line.trim()) return null;
  try {
    return sokoBotRuntimeEventSchema.parse(JSON.parse(line));
  } catch (error) {
    throw new EveRuntimeWireError(
      "Eve stream returned an invalid NDJSON event",
      wireErrorDetail(error),
    );
  }
}

function joinBytes(chunks: Uint8Array[], byteLength: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array();
  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new EveRuntimeWireError(
      "Eve response exceeded byte limit",
      `Response exceeds ${maxBytes} bytes`,
    );
    await response.body.cancel(error).catch(() => undefined);
    throw error;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        const error = new EveRuntimeWireError(
          "Eve response exceeded byte limit",
          `Response exceeds ${maxBytes} bytes`,
        );
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      chunks.push(value);
    }
    return joinBytes(chunks, byteLength);
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const bytes = await readBoundedResponseBytes(
    response,
    EVE_CONTROL_MAX_RESPONSE_BYTES,
  );
  return new TextDecoder().decode(bytes);
}

function runtimeHeaders(requestToken: string, turnGrant?: string): Headers {
  const headers = new Headers({
    authorization: `Bearer ${requestToken}`,
    "content-type": "application/json",
  });
  if (turnGrant) headers.set("x-soko-bot-turn-grant", turnGrant);
  return headers;
}

export class EveHttpSokoBotRuntime implements SokoBotRuntime {
  constructor(
    private readonly baseUrl: string,
    private readonly runtimeVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    schema: RuntimeSchema<T>,
  ): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      signal: commandSignal(init.signal),
      redirect: "error",
    });
    const body = await readBoundedResponseText(response);
    if (!response.ok) {
      throw new EveRuntimeError(
        `Eve runtime returned ${response.status}`,
        response.status,
        body.slice(0, 2_000),
      );
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(body);
    } catch {
      // Schema validation below produces one stable invalid-payload error.
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new EveRuntimeError(
        "Eve runtime returned an invalid success payload",
        502,
        parsed.error.message.slice(0, 2_000),
      );
    }
    return parsed.data;
  }

  async createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef> {
    const response = await this.requestJson(
      "/eve/v1/session",
      {
        method: "POST",
        headers: runtimeHeaders(input.requestToken, input.turnGrant),
        body: JSON.stringify({
          message: input.message,
          operationId: input.turnId,
        }),
      },
      eveAcceptedResponseSchema,
    );
    return {
      sessionId: response.sessionId,
      runtimeVersion: this.runtimeVersion,
      acceptedAt: new Date().toISOString(),
    };
  }

  async *streamEvents(
    input: RuntimeEventStreamInput,
  ): AsyncIterable<IndexedRuntimeEvent> {
    const url = new URL(
      `/eve/v1/session/${encodeURIComponent(input.sessionId)}/stream`,
      this.baseUrl,
    );
    url.searchParams.set("startIndex", String(input.startIndex));
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: runtimeHeaders(input.requestToken),
      signal: input.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) {
      const body = await readBoundedResponseText(response);
      throw new EveRuntimeError(
        `Eve stream returned ${response.status}`,
        response.status,
        body.slice(0, 2_000),
      );
    }

    const reader = response.body.getReader();
    let bufferedChunks: Uint8Array[] = [];
    let bufferedBytes = 0;
    let startIndex = input.startIndex;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let segmentStart = 0;
        for (let index = 0; index < value.byteLength; index += 1) {
          if (value[index] !== 0x0a) continue;
          const segment = value.subarray(segmentStart, index);
          if (bufferedBytes + segment.byteLength > EVE_STREAM_MAX_EVENT_BYTES) {
            throw new EveRuntimeWireError(
              "Eve stream event exceeded byte limit",
              `Event exceeds ${EVE_STREAM_MAX_EVENT_BYTES} bytes`,
            );
          }
          if (segment.byteLength > 0) {
            bufferedChunks.push(segment);
            bufferedBytes += segment.byteLength;
          }
          const event = parseRuntimeEvent(
            joinBytes(bufferedChunks, bufferedBytes),
          );
          bufferedChunks = [];
          bufferedBytes = 0;
          segmentStart = index + 1;
          if (event) {
            yield { startIndex, event };
            startIndex += 1;
          }
        }
        const tail = value.subarray(segmentStart);
        if (bufferedBytes + tail.byteLength > EVE_STREAM_MAX_EVENT_BYTES) {
          throw new EveRuntimeWireError(
            "Eve stream event exceeded byte limit",
            `Event exceeds ${EVE_STREAM_MAX_EVENT_BYTES} bytes`,
          );
        }
        if (tail.byteLength > 0) {
          bufferedChunks.push(tail);
          bufferedBytes += tail.byteLength;
        }
      }
      if (bufferedBytes > 0) {
        const event = parseRuntimeEvent(
          joinBytes(bufferedChunks, bufferedBytes),
        );
        if (event) yield { startIndex, event };
      }
    } catch (error) {
      if (error instanceof EveRuntimeWireError) {
        await reader.cancel(error).catch(() => undefined);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async cancelTurn(input: RuntimeCancelInput): Promise<void> {
    await this.requestJson(
      `/eve/v1/session/${encodeURIComponent(input.sessionId)}/cancel`,
      {
        method: "POST",
        headers: runtimeHeaders(input.requestToken),
        body: JSON.stringify(
          input.eveTurnId ? { turnId: input.eveTurnId } : {},
        ),
      },
      sokoBotRuntimeCommandResponseSchema,
    );
  }

  async resetSession(input: RuntimeResetInput): Promise<void> {
    await this.requestJson(
      `/eve/v1/session/${encodeURIComponent(input.sessionId)}/reset`,
      {
        method: "POST",
        headers: runtimeHeaders(input.requestToken),
        body: JSON.stringify({ reason: input.reason }),
      },
      sokoBotRuntimeCommandResponseSchema,
    );
  }

  async inspectSession(_input: RuntimeInspectInput): Promise<RuntimeHealth> {
    const response = await this.fetchImpl(
      new URL("/eve/v1/health", this.baseUrl),
      {
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.body) {
      void response.body.cancel().catch(() => undefined);
    }
    return {
      healthy: response.ok,
      runtimeVersion: this.runtimeVersion,
      sessionStatus: null,
    };
  }
}
