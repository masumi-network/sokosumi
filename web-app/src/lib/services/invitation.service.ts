import { InvitationStatus } from "@/lib/db";
import { Invitation } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class InvitationService extends BaseService<InvitationService> {
  async getPendingInvitations(organizationId: string): Promise<Invitation[]> {
    return await this.client.invitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
    });
  }
}
