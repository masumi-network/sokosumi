/**
 * Browser translation features (Chrome/Edge/Yandex built-in Google Translate)
 * mutate the DOM by wrapping text nodes in `<font>` tags. React then throws
 * `NotFoundError` when committing updates against nodes that were moved.
 * These errors originate outside our code and are pure noise in Sentry
 * (see SOKOSUMI-A, SOKOSUMI-G7, SOKOSUMI-FQ: 100% Chromium browsers,
 * users with locales we don't ship translations for).
 */
export const thirdPartyDomMutationIgnoreErrors: RegExp[] = [
  // Chromium message format
  /Failed to execute 'removeChild' on 'Node'/,
  /Failed to execute 'insertBefore' on 'Node'/,
  // Firefox message format (translate extensions cause the same mutation)
  /Node\.removeChild: The node to be removed is not a child of this node/,
  /Node\.insertBefore: Child to insert before is not a child of this node/,
];
