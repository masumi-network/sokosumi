import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import {
  ComposioApiError,
  ComposioConfigError,
  ComposioIdentityError,
} from "@/clients/composio.client";
import { forbidden } from "@/helpers/error";

import { mapProjectSocialConnectionServiceError } from "./route-helpers";

function expectMapped(
  error: unknown,
  status: number,
  message: string,
  cause?: unknown,
) {
  expect(() => mapProjectSocialConnectionServiceError(error)).toThrow(
    HTTPException,
  );
  try {
    mapProjectSocialConnectionServiceError(error);
  } catch (mapped) {
    expect(mapped).toBeInstanceOf(HTTPException);
    expect((mapped as HTTPException).status).toBe(status);
    expect((mapped as HTTPException).message).toBe(message);
    if (cause !== undefined) {
      expect((mapped as HTTPException).cause).toEqual(cause);
    }
  }
}

describe("mapProjectSocialConnectionServiceError", () => {
  it("rethrows an HTTPException unchanged", () => {
    const error = forbidden("Not a project member");
    try {
      mapProjectSocialConnectionServiceError(error);
      expect.unreachable();
    } catch (mapped) {
      expect(mapped).toBe(error);
    }
  });

  it("maps a missing Composio config to 503", () => {
    expectMapped(
      new ComposioConfigError("COMPOSIO_API_KEY is not configured"),
      503,
      "Integrations are not configured on this server.",
    );
  });

  it("maps an identity error to 400 and keeps a stable kind", () => {
    expectMapped(
      new ComposioIdentityError(
        "Connect a Facebook Page first.",
        CORE_API_ERROR_KINDS.SOCIAL_FACEBOOK_PAGE_REQUIRED,
      ),
      400,
      "Connect a Facebook Page first.",
      { kind: CORE_API_ERROR_KINDS.SOCIAL_FACEBOOK_PAGE_REQUIRED },
    );
    expectMapped(
      new ComposioIdentityError("This account cannot be used."),
      400,
      "This account cannot be used.",
      {},
    );
  });

  it("maps provider 5xx, 401, 403, and 429 to 503 and other API errors to 400", () => {
    for (const status of [500, 401, 403, 429]) {
      expectMapped(
        new ComposioApiError(status, undefined, "upstream"),
        503,
        "Integrations are temporarily unavailable.",
      );
    }
    expectMapped(
      new ComposioApiError(404, undefined, "missing"),
      400,
      "Unable to complete the social account action.",
    );
  });

  it("maps an unknown failure to 500", () => {
    expectMapped(
      new Error("boom"),
      500,
      "Unable to manage social connections.",
    );
  });
});
