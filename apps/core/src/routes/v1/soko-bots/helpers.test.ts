import {
  ComposioError,
  ComposioToolFetchError,
  ComposioToolkitFetchError,
  ComposioToolkitNotFoundError,
  ComposioToolNotFoundError,
} from "@composio/core";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

import { mapIntegrationError } from "./helpers";

function thrownStatus(error: unknown): number {
  try {
    mapIntegrationError(error);
  } catch (mapped) {
    if (mapped instanceof HTTPException) return mapped.status;
    throw mapped;
  }
}

describe("mapIntegrationError", () => {
  it("maps ComposioToolNotFoundError to 404", () => {
    expect(thrownStatus(new ComposioToolNotFoundError("missing tool"))).toBe(
      404,
    );
  });

  it("maps ComposioToolkitNotFoundError to 404", () => {
    expect(
      thrownStatus(new ComposioToolkitNotFoundError("missing toolkit")),
    ).toBe(404);
  });

  it("maps ComposioToolFetchError (401/5xx) to 422, not 404", () => {
    const error = new ComposioToolFetchError("Unable to retrieve tool", {
      cause: { status: 401 },
    });
    expect(thrownStatus(error)).toBe(422);
  });

  it("maps ComposioToolkitFetchError (401/5xx) to 422, not 404", () => {
    const error = new ComposioToolkitFetchError("Unable to retrieve toolkit", {
      cause: { status: 503 },
    });
    expect(thrownStatus(error)).toBe(422);
  });

  it("maps a generic ComposioError to 422", () => {
    expect(thrownStatus(new ComposioError("other failure"))).toBe(422);
  });

  it("maps wrapped upstream integration errors to 422", () => {
    expect(
      thrownStatus(new SokoBotIntegrationError("Composio (list tools): 401")),
    ).toBe(422);
  });

  it("maps wrapped not-found integration errors to 404", () => {
    expect(
      thrownStatus(
        new SokoBotIntegrationError(
          "Composio (list tools): missing",
          "NOT_FOUND",
        ),
      ),
    ).toBe(404);
  });
});
