import http from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAgent } = vi.hoisted(() => ({ useAgent: vi.fn() }));
vi.mock("request-filtering-agent", () => ({ useAgent }));

import { ssrfSafeFetch, ssrfSafeStreamFetch } from "./ssrf-fetch.js";

/** Feed HTTP bytes to the native parser without opening a network socket. */
function syntheticConnection(response: string) {
  let requestBytes = "";
  let responded = false;
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      requestBytes += chunk.toString();
      callback();
      if (!responded && requestBytes.includes("\r\n\r\n")) {
        responded = true;
        queueMicrotask(() => socket.push(Buffer.from(response)));
      }
    },
  });
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => socket as Socket;
  useAgent.mockReturnValue(agent);
  return { socket, agent };
}

describe("SSRF invariant: HTTP protocol changes cannot escape the guarded fetch lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["buffered", ssrfSafeFetch],
    ["streaming", ssrfSafeStreamFetch],
  ] as const)(
    "rejects native HTTP 101 upgrade in the %s API and closes the detached socket",
    async (_mode, fetchResponse) => {
      const { socket, agent } = syntheticConnection(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      const controller = new AbortController();
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = fetchResponse("http://coworker.example/responses", {
          signal: controller.signal,
          maxResponseBytes: 1024,
        }).then(
          () => "resolved",
          (error: Error) => error.message,
        );
        abortTimer = setTimeout(() => controller.abort(), 25);
        const outcome = await Promise.race([
          result,
          new Promise<string>((resolve) => {
            deadline = setTimeout(() => resolve("hung after abort"), 75);
          }),
        ]);
        expect(outcome).toBe("Response upgrades are not supported");
        expect(socket.destroyed).toBe(true);
      } finally {
        clearTimeout(abortTimer);
        clearTimeout(deadline);
        socket.destroy();
        agent.destroy();
      }
    },
  );

  it.each([
    ["buffered", ssrfSafeFetch],
    ["streaming", ssrfSafeStreamFetch],
  ] as const)(
    "rejects native CONNECT tunneling in the %s API and closes the detached socket",
    async (_mode, fetchResponse) => {
      const { socket, agent } = syntheticConnection(
        "HTTP/1.1 200 Connection Established\r\n\r\n",
      );
      const controller = new AbortController();
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = fetchResponse("http://coworker.example/responses", {
          method: "CONNECT",
          signal: controller.signal,
          maxResponseBytes: 1024,
        }).then(
          () => "resolved",
          (error: Error) => error.message,
        );
        abortTimer = setTimeout(() => controller.abort(), 25);
        const outcome = await Promise.race([
          result,
          new Promise<string>((resolve) => {
            deadline = setTimeout(() => resolve("hung after abort"), 75);
          }),
        ]);
        expect(outcome).toBe("Response tunnels are not supported");
        expect(socket.destroyed).toBe(true);
      } finally {
        clearTimeout(abortTimer);
        clearTimeout(deadline);
        socket.destroy();
        agent.destroy();
      }
    },
  );
});
