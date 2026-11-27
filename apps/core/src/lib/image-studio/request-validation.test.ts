import { describe, expect, it } from "vitest";

import {
  createImageJobRequestSchema,
  createTalkingVideoJobRequestSchema,
} from "@/schemas/project-image-studio.schema";

import {
  describeImageStudioRefusal,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_STUDIO_REQUEST_ERROR_KINDS,
  imageStudioValidationHook,
} from "./request-validation";

/**
 * Driven through the real request schema rather than hand-built ZodErrors, so the
 * issue codes and paths are the ones the route actually produces. A test that
 * invents `{ code: "too_big", path: ["prompt"] }` proves nothing about whether
 * Zod still reports it that way.
 */
function refuse(body: unknown) {
  const result = createImageJobRequestSchema.safeParse(body);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("expected the schema to refuse this");
  return describeImageStudioRefusal(result.error);
}

const FILE_ID = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e8f";

const VALID = {
  prompt: "a calm product shot",
  idempotencyKey: "key-abcdefgh",
};

describe("describeImageStudioRefusal", () => {
  it("says what to do about a prompt that is too long", () => {
    // The live case: 26,520 characters answered with
    // "Key: prompt - Too big: expected string to have <=4000 characters".
    const refusal = refuse({ ...VALID, prompt: "x".repeat(26_520) });

    expect(refusal.kind).toBe(IMAGE_STUDIO_REQUEST_ERROR_KINDS.promptTooLong);
    expect(refusal.message).toBe(
      "This prompt is too long. Keep it under 4,000 characters.",
    );
    // None of Zod's vocabulary, and no internal field path.
    expect(refusal.message).not.toMatch(/Key:|Too big|expected string|<=/);
  });

  it("quotes the same limit the schema enforces", () => {
    expect(
      createImageJobRequestSchema.safeParse({
        ...VALID,
        prompt: "x".repeat(IMAGE_PROMPT_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      createImageJobRequestSchema.safeParse({
        ...VALID,
        prompt: "x".repeat(IMAGE_PROMPT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("asks for a prompt when there is not one", () => {
    for (const prompt of ["", "   ", undefined]) {
      expect(refuse({ ...VALID, prompt }).kind).toBe(
        IMAGE_STUDIO_REQUEST_ERROR_KINDS.promptRequired,
      );
    }
  });

  it("covers a setting the studio does not offer", () => {
    const refusal = refuse({
      ...VALID,
      settings: { aspectRatio: "1.91:1" },
    });
    expect(refusal.kind).toBe(
      IMAGE_STUDIO_REQUEST_ERROR_KINDS.unsupportedSetting,
    );
  });

  it("covers too many references", () => {
    const refusal = refuse({
      ...VALID,
      referenceAssetIds: Array.from(
        { length: 5 },
        () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    });
    expect(refusal.kind).toBe(
      IMAGE_STUDIO_REQUEST_ERROR_KINDS.tooManyReferences,
    );
  });

  // SOKD-481: agents guessed seven presenter shapes and never learned which field was wrong.
  it("names the field and what to send for a client mistake", () => {
    const refusal = refuse({ prompt: "a cup" });
    expect(refusal.kind).toBe(IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest);
    expect(refusal.message).toBe(
      "The studio could not read this request: idempotencyKey is required.",
    );
  });

  it.each([
    [{ driveFileId: FILE_ID }, 'presenter.kind must be "stock" or "file".'],
    [
      { kind: "drive", fileId: FILE_ID },
      'presenter.kind must be "stock" or "file".',
    ],
    [{ kind: "file", fileId: FILE_ID }, "presenter.consent must be true."],
    [
      { kind: "file", fileId: "photo", consent: true },
      "presenter.fileId must be a UUID.",
    ],
    [undefined, "presenter is required."],
    ["Anna", "presenter must be an object."],
  ])(
    "tells an agent which presenter field to fix: %j",
    (presenter, expected) => {
      const result = createTalkingVideoJobRequestSchema.safeParse({
        script: "Hi, this is an e2e test.",
        idempotencyKey: "key-abcdefgh",
        presenter,
      });
      if (result.success) throw new Error("expected the schema to refuse this");
      const refusal = describeImageStudioRefusal(result.error);
      expect(refusal.kind).toBe(
        IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest,
      );
      expect(refusal.message).toBe(
        `The studio could not read this request: ${expected}`,
      );
    },
  );

  it("names the body itself when it is not an object", () => {
    expect(refuse(null).message).toBe(
      "The studio could not read this request: the body must be an object.",
    );
  });

  it("names the setting the studio does not offer and the values it does", () => {
    const refusal = refuse({ ...VALID, settings: { resolution: "4K" } });
    expect(refusal.message).toBe(
      'The studio does not offer one of these settings: settings.resolution must be "0.5K", "1K" or "2K".',
    );
  });

  it("never leaks Zod's wording for anything the schema can refuse", () => {
    const bodies: unknown[] = [
      { ...VALID, prompt: "x".repeat(26_520) },
      { ...VALID, prompt: "" },
      { ...VALID, settings: { resolution: "4K" } },
      { ...VALID, settings: { outputFormat: "tiff" } },
      { ...VALID, settings: { seed: -1 } },
      { ...VALID, referenceAssetIds: ["not-a-uuid"] },
      { ...VALID, parentAssetId: "not-a-uuid" },
      { ...VALID, idempotencyKey: "short" },
      { prompt: "a cup" },
      {},
      null,
    ];
    for (const body of bodies) {
      const refusal = refuse(body);
      expect(refusal.message).not.toMatch(
        /Key:|Too big|Too small|expected|Invalid|invalid_|received/,
      );
      expect(Object.values(IMAGE_STUDIO_REQUEST_ERROR_KINDS)).toContain(
        refusal.kind,
      );
    }
  });
});

describe("imageStudioValidationHook", () => {
  it("passes a valid request through", () => {
    expect(imageStudioValidationHook({ success: true })).toBeUndefined();
  });

  it("throws the studio's 422, carrying the kind a client matches on", () => {
    const result = createImageJobRequestSchema.safeParse({
      ...VALID,
      prompt: "x".repeat(26_520),
    });
    expect(result.success).toBe(false);

    const thrown = (() => {
      try {
        imageStudioValidationHook(result);
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(thrown).toMatchObject({ status: 422 });
    expect((thrown as { cause?: unknown }).cause).toMatchObject({
      kind: IMAGE_STUDIO_REQUEST_ERROR_KINDS.promptTooLong,
    });
  });
});
