import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  AdminTaskX402Payment,
  AdminTaskX402PaymentAgentAggregate,
  AggregateAdminTaskX402PaymentsByAgentData,
  ListAdminTaskX402PaymentsData,
  RefundAdminTaskX402PaymentData,
  ResolveAdminTaskX402PaymentData,
} from "@/lib/clients/generated/core";

export type AdminTaskX402PaymentStatus = AdminTaskX402Payment["status"];
export type AdminTaskX402RefundReason =
  RefundAdminTaskX402PaymentData["body"]["reason"];
export type AdminTaskX402ResolveReason =
  ResolveAdminTaskX402PaymentData["body"]["reason"];
export type ListAdminTaskX402PaymentsParams = NonNullable<
  ListAdminTaskX402PaymentsData["query"]
>;
export type AggregateAdminTaskX402PaymentsParams = NonNullable<
  AggregateAdminTaskX402PaymentsByAgentData["query"]
>;

export interface AdminTaskX402PaymentPage {
  payments: AdminTaskX402Payment[];
  total: number;
  nextCursor: string | null;
}

export const adminTaskX402PaymentService = {
  async listPayments(
    params: ListAdminTaskX402PaymentsParams,
  ): Promise<AdminTaskX402PaymentPage> {
    const result = await coreClient.listAdminTaskX402Payments(params);
    return {
      payments: result.data,
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async aggregatePayments(
    params: AggregateAdminTaskX402PaymentsParams,
  ): Promise<AdminTaskX402PaymentAgentAggregate[]> {
    const result = await coreClient.aggregateAdminTaskX402Payments(params);
    return result.data;
  },

  async refundPayment(
    paymentId: string,
    reason: AdminTaskX402RefundReason,
  ): Promise<void> {
    await coreClient.refundAdminTaskX402Payment(paymentId, reason);
  },

  async resolvePayment(
    paymentId: string,
    reason: AdminTaskX402ResolveReason,
  ): Promise<void> {
    await coreClient.resolveAdminTaskX402Payment(paymentId, reason);
  },
};
