import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_ICON_PATH,
  NOTIFICATION_SERVICE_WORKER_URL,
  NOTIFICATION_TARGET_PARAM,
  SHOWS_NOTIFICATIONS_QUERY,
} from "@/lib/utils/notification-service-worker";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";

/**
 * The service worker cannot reach next-intl, so it carries its own copy of the
 * notification strings. `messages:parity` compares key paths only, so it cannot see
 * a changed value. This test does: edit a catalog string without editing the
 * worker and it fails. SOK-876 removes the copy and this guard with it.
 */
// Built from the URL production registers, not from the literal. Renaming the
// constant alone would 404 the worker and take every banner with it, and a
// hardcoded path here would keep passing over that.
const SERVICE_WORKER_PATH = join(
  process.cwd(),
  "public",
  NOTIFICATION_SERVICE_WORKER_URL,
);

/**
 * The catalog the worker loads with `importScripts`, read from the path the
 * worker itself names. A rename that leaves the two disagreeing fails here
 * rather than at a reader's first push.
 */
const MESSAGES_PATH = join(
  process.cwd(),
  "public",
  readFileSync(SERVICE_WORKER_PATH, "utf8").match(
    /importScripts\("([^"]*)"\);/,
  )?.[1] ?? "",
);

const CATALOGS = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
} as const;

type Catalog = (typeof CATALOGS)[keyof typeof CATALOGS];

/**
 * Every message key Core can store, read from the catalog rather than a fixed
 * list, so a key added later is guarded without anyone remembering to extend
 * this test.
 *
 * Two shapes, because Core stores two. Job, Task and Chat sit under
 * `Library.Notifications.<Group>` and Core stores them as
 * `Notifications.<Group>.<key>`. The system keys sit at the catalog root and
 * Core stores them verbatim, lowercase `notifications.` and all.
 */
function messageEntries(catalog: Catalog): { key: string; text: string }[] {
  const entries: { key: string; text: string }[] = [];

  const groups: Record<string, Record<string, string>> = catalog.Library
    .Notifications;
  for (const [group, strings] of Object.entries(groups)) {
    for (const [name, text] of Object.entries(strings)) {
      entries.push({ key: `Notifications.${group}.${name}`, text });
    }
  }

  const systemAreas: Record<
    string,
    Record<string, string>
  > = catalog.notifications;
  for (const [area, strings] of Object.entries(systemAreas)) {
    for (const [name, text] of Object.entries(strings)) {
      entries.push({ key: `notifications.${area}.${name}`, text });
    }
  }

  return entries;
}

const MESSAGE_KEYS = messageEntries(enMessages).map((entry) => entry.key);

/**
 * The worker's strings for one locale. Read the block rather than the file, or
 * a string filed under the wrong locale still passes.
 */
function localeBlock(source: string, locale: string): string {
  return (
    source.match(new RegExp(`\n  ${locale}: \\{([\\s\\S]*?)\n  \\},`))?.[1] ??
    ""
  );
}

/**
 * The block read as the map it is, key by key.
 *
 * Asking whether a string is somewhere in the block cannot see two strings
 * that swapped keys: both are still there, and a banner then titles a group
 * message the way it titles a channel one.
 */
function localeStrings(source: string, locale: string): Map<string, string> {
  const strings = new Map<string, string>();
  const pairs = localeBlock(source, locale).matchAll(
    /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g,
  );

  for (const [, key, value] of pairs) {
    strings.set(key, JSON.parse(`"${value}"`) as string);
  }

  return strings;
}

describe("ably-push-sw message map", () => {
  // Both halves of what the browser runs: the worker and the catalog it
  // imports. Read together so a string moving between the two is invisible
  // here, which is what a split is allowed to do.
  const source = [SERVICE_WORKER_PATH, MESSAGES_PATH]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  /**
   * Add a locale to the app and this fails until the worker carries it, rather
   * than letting its readers fall back to English in silence.
   */
  it("covers every locale the app supports", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    for (const { key, text } of messageEntries(catalog)) {
      it(`carries the current ${locale} string for ${key}`, () => {
        expect(text).toBeTruthy();
        expect(localeStrings(source, locale).get(key)).toBe(text);
      });
    }
  }

  /**
   * Core never stores these two, so the loop above only guards them while the
   * catalog still has them. Drop one and a chat banner reads its key path back
   * at the reader instead of naming the sender.
   */
  it("keeps the strings web titles a chat banner with in the catalog", () => {
    expect(MESSAGE_KEYS).toContain(CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY);
    expect(MESSAGE_KEYS).toContain(CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY);
  });

  /**
   * The worker cannot import these, so it repeats the two key paths as
   * literals. Both constants name a key the catalog has, so pointing one at
   * the other passes every other check here: the app would then title a
   * channel message as a group one while the worker still titles it as a
   * channel. Written out rather than compared to the worker, because the two
   * copies drifting apart is the thing being guarded against.
   */
  it("names the two title keys the worker repeats", () => {
    expect(CHAT_ROOM_MESSAGE_TITLE_MESSAGE_KEY).toBe(
      "Notifications.Chat.roomMessageTitle",
    );
    expect(CHAT_ROOM_MESSAGE_GROUP_TITLE_MESSAGE_KEY).toBe(
      "Notifications.Chat.roomMessageGroupTitle",
    );
  });

  it("reads the locale from the cookie the app writes", () => {
    expect(source).toContain(`"${LOCALE_COOKIE_NAME}"`);
  });

  it("sends clicks under the message type the app listens for", () => {
    expect(source).toContain(`"${NOTIFICATION_CLICK_MESSAGE}"`);
  });

  it("titles banners the way the app titles them", () => {
    // Read the declaration, not the file: the comment above it quotes the same
    // string, so a plain `toContain` would pass on any title.
    const declared = source.match(/const APP_TITLE = "([^"]*)";/)?.[1];

    expect(declared).toBe(
      enMessages.Components.NotificationCenter.browserNotificationTitle,
    );
  });

  /**
   * Read from the declaration rather than the file: the parameter name is an
   * ordinary word, so a plain `toContain` would pass on prose that happens to
   * use it. The two copies drifting apart would open a window the page then
   * ignores, landing the reader on the front page with no word of why.
   */
  it("names the URL parameter the app reads a click target from", () => {
    const declared = source.match(/const TARGET_PARAM = "([^"]*)";/)?.[1];

    expect(declared).toBe(NOTIFICATION_TARGET_PARAM);
  });

  it("asks the question the app answers", () => {
    expect(source).toContain(`"${SHOWS_NOTIFICATIONS_QUERY}"`);
  });

  it("draws the banner icon the app draws", () => {
    expect(source).toContain(`"${NOTIFICATION_ICON_PATH}"`);
  });

  it("keys the map by the messageKey Core stores", () => {
    expect(MESSAGE_KEYS.length).toBeGreaterThan(0);

    for (const key of MESSAGE_KEYS) {
      expect(source).toContain(`"${key}"`);
    }
  });
});
