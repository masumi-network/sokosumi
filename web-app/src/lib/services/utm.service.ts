import "server-only";

import { cookies } from "next/headers";

import prisma from "@/lib/db/repositories/prisma";
import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

/**
 * UTMService provides methods for handling UTM (Urchin Tracking Module) attribution data.
 *
 * Responsibilities:
 * - Creating UTM attribution records in the database for user conversions.
 * - Retrieving and parsing UTM data from cookies for attribution purposes.
 *
 * Usage:
 * - Use `UTMService.getInstance()` for singleton access with the default Prisma client.
 * - Use `UTMService.createInstance(client)` for transactional operations with a specific Prisma client.
 */
export class UTMService {
  /**
   * Private constructor to enforce singleton and transactional instantiation.
   * @param client Prisma transaction client for database operations.
   */
  private constructor(protected client: Prisma.TransactionClient) {}

  /**
   * Create a new UTMService instance with a specific Prisma transaction client.
   * Useful for transactional workflows.
   * @param client Prisma.TransactionClient
   * @returns UTMService instance
   */
  static createInstance(client: Prisma.TransactionClient): UTMService {
    return new UTMService(client);
  }

  private static instance?: UTMService;

  /**
   * Get a singleton UTMService instance using the default Prisma client.
   * @returns UTMService singleton instance
   */
  public static getInstance(): UTMService {
    UTMService.instance ??= new UTMService(prisma);
    return UTMService.instance;
  }

  /**
   * Create a UTM attribution record in the database for a user conversion event.
   *
   * @param userId The user ID to associate with the UTM attribution.
   * @param utmData The UTM data object (source, medium, campaign, etc.).
   * @param convertedAt The timestamp when the conversion occurred.
   * @returns The created UTMAttribution record, or null if creation fails.
   */
  async createUTMAttribution(
    userId: string,
    utmData: UTMData,
    convertedAt: Date,
  ): Promise<UTMAttribution | null> {
    return await this.client.uTMAttribution.create({
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
        convertedAt,
      },
    });
  }

  /**
   * Retrieve and parse UTM data from the UTM cookie, if present and valid.
   *
   * @returns The parsed UTMData object if the cookie exists and is valid, or null otherwise.
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
  }
}
