import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountPost from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
const transcribe = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  transcribe,
}));
vi.mock("@/lib/ai-gateway-purpose", () => ({
  aiGateway: () => ({ transcription: (id: string) => ({ id }) }),
}));

function app() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "alice",
      organizationId: null,
      role: "user",
    });
    await next();
  });
  mountPost(app);
  return app;
}

function post(bytes: Uint8Array, type: string) {
  return app().request("/", {
    method: "POST",
    body: new Uint8Array(bytes),
    headers: { "Content-Type": type },
  });
}

const audio = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

describe("voice transcription", () => {
  beforeEach(() => transcribe.mockReset());

  it("returns what was said", async () => {
    transcribe.mockResolvedValue({ text: "  Move my 3pm to Friday \n" });
    const response = await post(audio, "audio/mp4");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      text: "Move my 3pm to Friday",
    });
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: "elevenlabs/scribe-v2" },
        audio,
      }),
    );
  });

  it.each([
    [audio, "text/plain"],
    [audio, "video/mp4"],
    [new Uint8Array(), "audio/webm"],
  ])("rejects a body that is not a recording", async (bytes, type) => {
    const response = await post(bytes, type);
    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects a recording over 10 MiB", async () => {
    const response = await post(
      new Uint8Array(10 * 1024 * 1024 + 1),
      "audio/webm",
    );
    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
