import {
  organizationInclude,
  organizationOrderBy,
  OrganizationWithInclude,
} from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

/**
 * Service for managing organizations and their related data.
 * Provides methods to retrieve, create, and update organizations,
 * including fetching by ID, slug, or email domain, and retrieving
 * organizations with their relations.
 */
export class OrganizationService extends BaseService<OrganizationService> {
  /**
   * Retrieve an organization by its unique ID, including related data.
   *
   * @param id - The unique identifier of the organization.
   * @returns A Promise resolving to the organization with included relations, or null if not found.
   */
  async getOrganizationById(
    id: string,
  ): Promise<OrganizationWithInclude | null> {
    return this.client.organization.findUnique({
      where: { id },
      include: organizationInclude,
    });
  }

  /**
   * Retrieve an organization by its unique slug, including related data.
   *
   * @param slug - The unique slug of the organization.
   * @returns A Promise resolving to the organization with included relations, or null if not found.
   */
  async getOrganizationBySlug(
    slug: string,
  ): Promise<OrganizationWithInclude | null> {
    return this.client.organization.findUnique({
      where: { slug },
      include: organizationInclude,
    });
  }

  /**
   * Retrieve organizations that require a specific email domain for membership.
   *
   * @param emailDomain - The email domain to filter organizations by.
   * @returns A Promise resolving to an array of organizations with included relations.
   */
  async getOrganizationsByEmailDomain(
    emailDomain: string,
  ): Promise<OrganizationWithInclude[]> {
    return this.client.organization.findMany({
      where: { requiredEmailDomains: { has: emailDomain } },
      include: organizationInclude,
      orderBy: organizationOrderBy,
    });
  }

  /**
   * Retrieve all organizations with their related data.
   *
   * @returns A Promise resolving to an array of organizations with included relations.
   */
  async getOrganizationsWithRelations(): Promise<OrganizationWithInclude[]> {
    return await this.client.organization.findMany({
      include: organizationInclude,
      orderBy: organizationOrderBy,
    });
  }

  /**
   * Create a new organization with the specified slug, name, and required email domains.
   *
   * @param slug - The unique slug for the organization.
   * @param name - The display name of the organization.
   * @param requiredEmailDomains - Array of email domains required for membership.
   * @returns A Promise resolving to the newly created organization with included relations.
   */
  async createOrganization(
    slug: string,
    name: string,
    requiredEmailDomains: string[],
  ): Promise<OrganizationWithInclude> {
    return await this.client.organization.create({
      data: { slug, name, requiredEmailDomains },
      include: organizationInclude,
    });
  }

  /**
   * Update an existing organization by its ID.
   *
   * @param organizationId - The unique identifier of the organization to update.
   * @param data - The update data for the organization.
   * @returns A Promise resolving to the updated organization with included relations.
   */
  async updateOrganizationById(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
  ): Promise<OrganizationWithInclude> {
    return await this.client.organization.update({
      where: { id: organizationId },
      data,
      include: organizationInclude,
    });
  }
}
