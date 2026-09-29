import "server-only";

import { acquireExportLease, releaseExportLease } from "@sokosumi/core-client";
import { NextResponse } from "next/server";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import {
  CoreApiRequestError,
  executeCoreOperation,
} from "@/lib/clients/core.request";
import { ExportLimitError } from "@/lib/utils/export-operation";

const CORE_EXPORT_TIMEOUT_MS = 5_000;

/** Keep the lease until conversion and resource cleanup have actually settled. */
export async function withExportOperation(
  request: Request,
  operation: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new ExportLimitError("Export request canceled", 499));
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  let token: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    controller.signal.throwIfAborted();
    const lease = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        acquireExportLease({
          client,
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(CORE_EXPORT_TIMEOUT_MS),
          ]),
        }),
      "Exports are temporarily unavailable",
    );
    token = lease.data.token;
    const deadline = performance.now() + lease.data.durationMs;
    timer = setTimeout(
      () => controller.abort(new ExportLimitError("Export timed out", 504)),
      lease.data.durationMs,
    );
    controller.signal.throwIfAborted();
    const response = await operation(controller.signal);
    controller.signal.throwIfAborted();
    // CPU work can finish before an overdue timer gets its event-loop turn.
    if (performance.now() >= deadline) {
      throw new ExportLimitError("Export timed out", 504);
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      return NextResponse.json(
        { error: reason.message },
        { status: reason.status },
      );
    }
    if (error instanceof ExportLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof CoreApiRequestError) {
      const status =
        error.status === 429 || error.status === 401 || error.status === 403
          ? error.status
          : 503;
      return NextResponse.json(
        {
          error:
            status === 429
              ? "Please wait before exporting another document"
              : "Exports are temporarily unavailable",
        },
        {
          status,
          headers: { "Retry-After": String(error.retryAfterSeconds ?? 1) },
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    if (token) {
      const leaseToken = token;
      try {
        await executeCoreOperation(
          createCoreGeneratedClient,
          (client) =>
            releaseExportLease({
              client,
              body: { token: leaseToken },
              cache: "no-store",
              signal: AbortSignal.timeout(CORE_EXPORT_TIMEOUT_MS),
            }),
          "Failed to release export lease",
        );
      } catch {
        // Core's expiring lease remains closed to new exports if cleanup cannot reach it.
        console.error("Failed to release export lease");
      }
    }
  }
}
