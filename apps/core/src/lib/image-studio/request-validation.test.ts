import { describe, expect, it } from "vitest";

import { createImageJobRequestSchema } from "@/schemas/project-image-studio.schema";

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

  it("names an unknown model without echoing the catalog", () => {
    const refusal = refuse({ ...VALID, modelId: "fal-ai/arbitrary" });
    expect(refusal.kind).toBe(IMAGE_STUDIO_REQUEST_ERROR_KINDS.unknownModel);
    expect(refusal.message).toBe(
      "That model is not in the studio catalog. Choose another one.",
    );
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

  it("falls back without naming an internal field for a client bug", () => {
    // A missing idempotency key is a client mistake, and the field name is no use
    // to whoever reads the toast.
    const refusal = refuse({ prompt: "a cup" });
    expect(refusal.kind).toBe(IMAGE_STUDIO_REQUEST_ERROR_KINDS.invalidRequest);
    expect(refusal.message).toBe("The studio could not read this request.");
    expect(refusal.message).not.toMatch(/idempotency/i);
  });

  it("never leaks Zod's wording for anything the schema can refuse", () => {
    const bodies: unknown[] = [
      { ...VALID, prompt: "x".repeat(26_520) },
      { ...VALID, prompt: "" },
      { ...VALID, modelId: "nope" },
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
