import "server-only";

import { cookies } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  UTM_COOKIE_MAX_AGE,
  UTM_COOKIE_NAME,
  UTMData,
  utmDataSchema,
} from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Repository for UTM attribution-related database operations.
 * Provides methods to create UTM attribution records and manage UTM data in cookies.
 */
export const utmAttributionRepository = {
  /**
   * Creates a UTM attribution record for a user.
   *
   * @param userId - The unique identifier of the user to associate with the UTM attribution.
   * @param utmData - The UTM data to store in the attribution record.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the created UTMAttribution object, or null if creation fails.
   */
  async createUTMAttribution(
    userId: string,
    utmData: UTMData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UTMAttribution | null> {
    return await tx.uTMAttribution.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        utmSource: utmData.utmSource,
        utmMedium: utmData.utmMedium,
        utmCampaign: utmData.utmCampaign,
        utmTerm: utmData.utmTerm,
        utmContent: utmData.utmContent,
        referrer: utmData.referrer,
        landingPage: utmData.landingPage,
        capturedAt: new Date(utmData.capturedAt),
        convertedAt: new Date(),
      },
    });
  },

  /**
   * Retrieves UTM data from the user's cookies, if available.
   *
   * @returns A promise that resolves to the parsed UTMData object if the cookie exists and is valid, or null otherwise.
   */
  async getUTMDataFromCookie(): Promise<UTMData | null> {
    const cookieStore = await cookies();
    const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
    if (!utmCookie) {
      return null;
    }
    try {
      return utmDataSchema.parse(JSON.parse(utmCookie));
    } catch (error) {
      console.error("Failed to parse UTM cookie", error);
      return null;
    }
  },

  /**
   * Stores the provided UTM data in a cookie for attribution tracking.
   *
   * Serializes the UTMData object and sets it as a cookie in the user's browser.
   * The cookie is configured with appropriate security and domain settings.
   *
   * @param utmData - The UTMData object to store in the cookie.
   * @returns A promise that resolves when the cookie has been set.
   */
  async setUTMDataInCookie(utmData: UTMData): Promise<void> {
    const cookieValue = JSON.stringify(utmData);
    const cookieStore = await cookies();
    cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
      maxAge: UTM_COOKIE_MAX_AGE,
      domain: getEnvSecrets().COOKIE_DOMAIN,
      httpOnly: false,
      secure: getEnvSecrets().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  },

  /**
   * Removes the UTM data cookie from the user's browser.
   *
   * @returns A promise that resolves when the cookie has been deleted.
   */
  async removeUTMCookie(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(UTM_COOKIE_NAME);
  },
};
