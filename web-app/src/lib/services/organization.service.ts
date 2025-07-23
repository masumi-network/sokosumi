import {
  organizationInclude,
  organizationOrderBy,
  OrganizationWithInclude,
} from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class OrganizationService extends BaseService<OrganizationService> {
  async getOrganizationById(
    id: string,
  ): Promise<OrganizationWithInclude | null> {
    return this.client.organization.findUnique({
      where: { id },
      include: organizationInclude,
    });
  }

  async getOrganizationBySlug(
    slug: string,
  ): Promise<OrganizationWithInclude | null> {
    return this.client.organization.findUnique({
      where: { slug },
      include: organizationInclude,
    });
  }

  async getOrganizationsByEmailDomain(
    emailDomain: string,
  ): Promise<OrganizationWithInclude[]> {
    return this.client.organization.findMany({
      where: { requiredEmailDomains: { has: emailDomain } },
      include: organizationInclude,
      orderBy: organizationOrderBy,
    });
  }

  async getOrganizationsWithRelations(): Promise<OrganizationWithInclude[]> {
    return await this.client.organization.findMany({
      include: organizationInclude,
      orderBy: organizationOrderBy,
    });
  }

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
