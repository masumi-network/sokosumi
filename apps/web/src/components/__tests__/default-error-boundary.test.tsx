import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import DefaultErrorBoundary from "@/components/default-error-boundary";

function Boom({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

describe("DefaultErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureException.mockClear();
    // Boundary + React both log the caught error; keep the suite output clean.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    cleanup();
  });

  it("reports the caught error, its component stack, and caller context to Sentry", () => {
    render(
      <DefaultErrorBoundary
        boundaryName="chat"
        context={{ roomId: "room-1", pathname: "/chat/rooms/room-1" }}
        fallback={<div>fallback</div>}
      >
        <Boom message="render exploded" />
      </DefaultErrorBoundary>,
    );

    expect(screen.getByText("fallback")).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, captureContext] = captureException.mock.calls[0] as [
      Error,
      {
        tags?: Record<string, unknown>;
        contexts?: { react?: { componentStack?: string } };
        extra?: Record<string, unknown>;
      },
    ];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("render exploded");
    expect(captureContext.tags?.errorBoundary).toBe("chat");
    expect(captureContext.extra?.roomId).toBe("room-1");
    expect(typeof captureContext.contexts?.react?.componentStack).toBe(
      "string",
    );
  });

  it("still reports when no context is given (default boundary name)", () => {
    render(
      <DefaultErrorBoundary fallback={<div>fallback</div>}>
        <Boom message="no context" />
      </DefaultErrorBoundary>,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, captureContext] = captureException.mock.calls[0] as [
      Error,
      { tags?: Record<string, unknown>; extra?: unknown },
    ];
    expect(captureContext.tags?.errorBoundary).toBe("default");
    expect(captureContext.extra).toBeUndefined();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <DefaultErrorBoundary>
        <div>healthy</div>
      </DefaultErrorBoundary>,
    );

    expect(screen.getByText("healthy")).toBeTruthy();
    expect(captureException).not.toHaveBeenCalled();
  });
});
