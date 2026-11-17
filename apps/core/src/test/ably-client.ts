import { vi } from "vitest";

/**
 * `@/lib/ably/client` for tests that run a flow which publishes over Ably.
 * The test env's key is not a real one, so the real client refuses every
 * publish; here each publish lands. Use it as the mock factory:
 *
 * vi.mock("@/lib/ably/client", async () =>
 *   (await import("@/test/ably-client")).fakeAblyClientModule(),
 * );
 */
export function fakeAblyClientModule() {
  const channel = { publish: vi.fn(async () => undefined) };
  const client = {
    channels: { get: vi.fn(() => channel) },
    batchPublish: vi.fn(async ({ channels }: { channels: string[] }) => ({
      successCount: channels.length,
      failureCount: 0,
      results: channels.map((name) => ({ channel: name, messageId: "msg" })),
    })),
  };
  return {
    getRestClient: () => client,
    getSubscribeRestClient: () => client,
    getPushAdminRestClient: () => client,
  };
}
