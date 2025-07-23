import {
  organizationMembersCountInclude,
  organizationOrderBy,
  OrganizationWithRelations,
} from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class OrganizationService extends BaseService<OrganizationService> {
  async getOrganizationById(
    id: string,
  ): Promise<OrganizationWithRelations | null> {
    return this.client.organization.findUnique({
      where: { id },
      include: { ...organizationMembersCountInclude },
    });
  }

  async getOrganizationBySlug(
    slug: string,
  ): Promise<OrganizationWithRelations | null> {
    return this.client.organization.findUnique({
      where: { slug },
      include: { ...organizationMembersCountInclude },
    });
  }

  async getOrganizationsByEmailDomain(
    emailDomain: string,
  ): Promise<OrganizationWithRelations[]> {
    return this.client.organization.findMany({
      where: { requiredEmailDomains: { has: emailDomain } },
      include: { ...organizationMembersCountInclude },
    });
  }

  async getOrganizationsWithRelations(): Promise<OrganizationWithRelations[]> {
    return await this.client.organization.findMany({
      include: { ...organizationMembersCountInclude },
      orderBy: organizationOrderBy,
    });
  }

  async createOrganization(
    slug: string,
    name: string,
    requiredEmailDomains: string[],
  ): Promise<OrganizationWithRelations> {
    return await this.client.organization.create({
      data: { slug, name, requiredEmailDomains },
      include: { ...organizationMembersCountInclude },
    });
  }

  async updateOrganizationById(
    organizationId: string,
    data: Prisma.OrganizationUpdateInput,
  ): Promise<OrganizationWithRelations> {
    return await this.client.organization.update({
      where: { id: organizationId },
      data,
      include: { ...organizationMembersCountInclude },
    });
  }
}
