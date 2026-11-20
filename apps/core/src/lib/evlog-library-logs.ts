import { stripVTControlCharacters } from "node:util";
import { BetterAuthError } from "@better-auth/core/error";
import type { ComposioLogger } from "@composio/core";
import { getOAuthState } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth/minimal";
import { createError, type RequestLogger } from "evlog";

import {
  createCoreLogger,
  toLogData,
  tryUseLiveLogger,
  tryUseLogger,
} from "./evlog.js";

/** A library whose own logger Core routes into evlog. */
type LibraryLogSource = "better-auth" | "composio";
type LibraryLogLevel = "debug" | "info" | "warn" | "error";

/** Where a URL's query ends: whitespace, a quote or an angle bracket. */
const QUERY_END = /[\s"'<>]/;
/** Sentence punctuation right before that end stays outside the query. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]]/;

/**
 * `text` without the query or fragment of any URL, absolute or path-only
 * (a `?` or `#` after a `/` in the same word). Libraries quote rejected URLs
 * whole (Better Auth's `Invalid callbackURL: …`), and OAuth state, codes and
 * tokens live there as opaque values no redaction rule recognizes.
 *
 * One pass over `text`: the message can be an untrusted callback URL, and a
 * backtracking regex over it took seconds for a long run of dots.
 */
function withoutUrlQueries(text: string): string {
  let kept = "";
  let copiedUpTo = 0;
  let inUrl = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? "";
    if (/\s/.test(char)) {
      inUrl = false;
    } else if (char === "/") {
      inUrl = true;
    } else if (inUrl && (char === "?" || char === "#")) {
      let end = index + 1;
      while (end < text.length && !QUERY_END.test(text[end] ?? "")) end++;
      while (
        end > index + 1 &&
        TRAILING_PUNCTUATION.test(text[end - 1] ?? "")
      ) {
        end--;
      }
      kept += text.slice(copiedUpTo, index);
      copiedUpTo = end;
      index = end - 1;
      inUrl = false;
    }
  }
  return kept + text.slice(copiedUpTo);
}

/**
 * `value` as bounded log data, the walk Core's redaction uses (depth limit,
 * cycles, an Error's cause and own fields), without URL queries.
 */
function libraryLogData(value: unknown): unknown {
  return toLogData(value, 0, new Set(), withoutUrlQueries);
}

/**
 * Logs a library's own message as the library wrote it, without URL queries:
 * on the current request's wide event while it can still take writes,
 * otherwise as a standalone event (with the request's id after the response).
 * `libraryLogs` tags each message with its source, since a wide event can
 * carry several; a standalone event also carries `source` itself.
 */
function logLibraryMessage(
  source: LibraryLogSource,
  level: LibraryLogLevel,
  rawMessage: string,
  rawArgs: unknown[] = [],
) {
  const message = withoutUrlQueries(rawMessage);
  const args = rawArgs.map(libraryLogData);
  const request = tryUseLiveLogger();
  const requestId = request
    ? undefined
    : tryUseLogger()?.getContext().requestId;
  const log =
    request ??
    createCoreLogger({ source, ...(requestId ? { requestId } : {}) });
  const fields = {
    libraryLogs: [
      { source, level, message, ...(args.length > 0 ? { args } : {}) },
    ],
  };
  if (level === "error") {
    // The cause as sanitized data, rebuilt as the Error evlog expects.
    const index = rawArgs.findIndex((arg) => arg instanceof Error);
    const data = args[index];
    const cause =
      index >= 0 && typeof data === "object" && data !== null
        ? Object.assign(new Error(), data)
        : undefined;
    log.error(createError({ message, cause }), fields);
  } else {
    log[level](message, fields);
  }
  if (!request) log.emit();
}

interface PendingBetterAuthLogs {
  writes: ((clientRedirect: boolean) => void)[];
  oauthErrorURL?: string;
}

const pendingBetterAuthLogs = new WeakMap<
  RequestLogger,
  PendingBetterAuthLogs
>();

/** Better Auth can log a diagnostic before choosing an OAuth redirect. */
export function deferBetterAuthRequestLogs(log: RequestLogger) {
  const pending: PendingBetterAuthLogs = { writes: [] };
  pendingBetterAuthLogs.set(log, pending);
  return (isClientRedirect: (oauthErrorURL?: string) => boolean) => {
    pendingBetterAuthLogs.delete(log);
    if (pending.writes.length === 0) return;
    const clientRedirect = isClientRedirect(pending.oauthErrorURL);
    for (const write of pending.writes) write(clientRedirect);
  };
}

export async function captureBetterAuthOAuthErrorURL(path: string | undefined) {
  if (path !== "/callback/:id") return;
  const request = tryUseLiveLogger();
  const pending = request && pendingBetterAuthLogs.get(request);
  if (pending) {
    // Better Auth validates errorCallbackURL at sign-in and stores it in state.
    pending.oauthErrorURL = (await getOAuthState())?.errorURL;
  }
}

function isClientOAuthStateError(error: Error): boolean {
  // Better Auth does not export StateError, and its base class sets `name`.
  return (
    error instanceof BetterAuthError &&
    error.constructor.name === "StateError" &&
    error.cause === undefined &&
    "code" in error &&
    (error.code === "state_mismatch" ||
      error.code === "state_security_mismatch")
  );
}

/**
 * Better Auth's `logger` option. Its level stays at Better Auth's default,
 * `warn`: setting `level` at all makes Better Auth also print every API error
 * to `console` through its global logger.
 */
export const betterAuthLogger = {
  log: (level, message, ...args) => {
    const request = tryUseLiveLogger();
    const pending = request ? pendingBetterAuthLogs.get(request) : undefined;
    const write = (clientRedirect = false) => {
      let eventLevel = level;
      if (pending && (level === "warn" || level === "error")) {
        const errors = args.filter(Error.isError);
        if (errors.length === 0 && clientRedirect) eventLevel = "info";
        if (errors.length > 0 && errors.every(isClientOAuthStateError)) {
          eventLevel = "warn";
        }
      }
      logLibraryMessage("better-auth", eventLevel, message, args);
    };
    if (pending) pending.writes.push(write);
    else write();
  },
} satisfies NonNullable<BetterAuthOptions["logger"]>;

/** The SDK prefixes each message with an ISO timestamp, gray on a terminal. */
const COMPOSIO_TIMESTAMP =
  /^(?:\u001b\[\d+m)?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?:\u001b\[\d+m)? - /;

/**
 * Core links with `allowMultiple: true` on purpose
 * (`soko-bot-integration-connection.service.ts`), and the SDK still warns
 * whenever an active account exists, so exactly this warning is info. Remove
 * the mapping once Composio stops warning when `allowMultiple: true` is
 * explicit (upstream report drafted in the core-logging notes).
 */
const COMPOSIO_ALLOW_MULTIPLE =
  /^\[Warn:AllowMultiple\] Multiple connected accounts found for user \S+ in auth config \S+$/;

function logComposioMessage(level: LibraryLogLevel, formatted: unknown) {
  const message = String(formatted).replace(COMPOSIO_TIMESTAMP, "");
  const intended = level === "warn" && COMPOSIO_ALLOW_MULTIPLE.test(message);
  logLibraryMessage(
    "composio",
    intended ? "info" : level,
    stripVTControlCharacters(message),
  );
}

/** The Composio client's `logger`: each method gets one formatted message. */
export const composioLogger: ComposioLogger = {
  error: (message) => logComposioMessage("error", message),
  warn: (message) => logComposioMessage("warn", message),
  info: (message) => logComposioMessage("info", message),
  debug: (message) => logComposioMessage("debug", message),
};
