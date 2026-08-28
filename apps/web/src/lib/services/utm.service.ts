import "server-only";

import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";
import type { z } from "zod";

import { postUsersByIdUtmAttribution } from "@/lib/clients/generated/core";
import { createClient } from "@/lib/clients/generated/core/client";
import { buildCalendarClientVersionHeaders } from "@/lib/clients/utils/calendar-client-version-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { UTM_COOKIE_NAME, utmDataSchema } from "@/lib/utils/utm";

type UTMData = z.infer<typeof utmDataSchema>;

/**
 * Service for handling UTM attribution logic and cookie management.
 * Provides methods to create UTM attribution records and manage UTM data in cookies.
 */
export const utmService = (() => {
  /**
   * Retrieves and parses UTM data from the provided cookie store.
   *
   * - Attempts to read the UTM attribution cookie by its configured name.
   * - If the cookie exists, parses its JSON value and validates it against the UTM data schema.
   * - Returns the parsed and validated UTMData object if successful, or null if the cookie is missing or invalid.
   *
   * @param cookieStore - The cookie store (typically from Next.js `cookies()` API) to read the UTM cookie from.
   * @returns The parsed UTMData object if available and valid, otherwise null.
   */
  function getUTMDataFromCookie(
    cookieStore: ReadonlyRequestCookies,
  ): UTMData | null {
    const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
    if (!utmCookie) return null;
    try {
      return utmDataSchema.parse(JSON.parse(utmCookie));
    } catch (error) {
      console.error("Failed to parse UTM cookie", error);
      return null;
    }
  }

  return {
    /**
     * Handles the conversion of UTM data for the current session user.
     *
     * This method:
     * - Retrieves UTM data from the user's cookies.
     * - If valid UTM data is found, records a UTM attribution in the core API for the session user.
     * - Removes the UTM cookie after processing, regardless of success or failure.
     *
     * The core endpoint resolves the user from the session via the `me` path, so
     * no user id is passed. The call sources its auth cookie from the cookie store
     * (not the incoming request headers) because this runs right after sign-up: the
     * freshly issued Better Auth session cookie has been set on `cookies()` for this
     * request but is not yet present on the original request headers.
     */
    async handleUTMConversion(): Promise<void> {
      const cookieStore = await cookies();
      try {
        const utmData = getUTMDataFromCookie(cookieStore);
        if (!utmData) return;

        const client = createClient({
          baseUrl: getServerCoreApiBaseUrl(),
          headers: {
            ...buildCalendarClientVersionHeaders(),
            cookie: cookieStore.toString(),
          },
        });

        await postUsersByIdUtmAttribution({
          client,
          path: { id: "me" },
          body: { ...utmData, capturedAt: new Date(utmData.capturedAt) },
          cache: "no-store",
          throwOnError: true,
        });
      } catch (error) {
        console.error("Failed to create utm attribution", error);
      } finally {
        cookieStore.delete(UTM_COOKIE_NAME);
      }
    },
  };
})();
