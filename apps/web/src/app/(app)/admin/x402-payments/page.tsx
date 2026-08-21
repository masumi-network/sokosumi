import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { X402PaymentAction } from "@/components/admin/x402-payments/x402-payment-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminTaskX402Payment } from "@/lib/clients/generated/core";
import {
  type AdminTaskX402PaymentStatus,
  adminTaskX402PaymentService,
} from "@/lib/services/admin-task-x402-payment.service";

export const metadata: Metadata = {
  title: "x402 payments",
  description: "Inspect and resolve task x402 payments.",
};

const STATUSES: AdminTaskX402PaymentStatus[] = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "REFUNDED",
];

const FAILURE_REASONS = [
  "node_refused_payload",
  "node_refused_operational",
] as const;

function isFailureReason(
  value: string,
): value is (typeof FAILURE_REASONS)[number] {
  return FAILURE_REASONS.some((reason) => reason === value);
}

interface AdminX402PaymentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readStatus(
  value: string | string[] | undefined,
): AdminTaskX402PaymentStatus | undefined {
  const candidate = firstValue(value);
  return STATUSES.find((status) => status === candidate);
}

function statusVariant(
  status: AdminTaskX402PaymentStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "VERIFIED") return "default";
  if (status === "FAILED") return "destructive";
  if (status === "REFUNDED") return "secondary";
  return "outline";
}

function buildPageHref(
  filters: {
    status?: AdminTaskX402PaymentStatus;
    agentId?: string;
    caip2Network?: string;
  },
  cursor: string,
): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.agentId) query.set("agentId", filters.agentId);
  if (filters.caip2Network) query.set("caip2Network", filters.caip2Network);
  query.set("cursor", cursor);
  return `/admin/x402-payments?${query.toString()}`;
}

export default async function AdminX402PaymentsPage({
  searchParams,
}: AdminX402PaymentsPageProps) {
  const raw = await searchParams;
  const filters = {
    status: readStatus(raw.status),
    agentId: firstValue(raw.agentId)?.trim() || undefined,
    caip2Network: firstValue(raw.caip2Network)?.trim() || undefined,
  };
  const cursor = firstValue(raw.cursor);
  const [page, rollups, t, locale] = await Promise.all([
    adminTaskX402PaymentService.listPayments({
      ...filters,
      cursor,
      limit: 25,
    }),
    adminTaskX402PaymentService.aggregatePayments(filters),
    getTranslations("App.Admin.X402Payments"),
    getLocale(),
  ]);
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <form className="grid gap-3 rounded-lg border p-4 md:grid-cols-[10rem_1fr_1fr_auto_auto]">
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            aria-label={t("Filters.status")}
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
          >
            <option value="">{t("Filters.allStatuses")}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`Statuses.${status}`)}
              </option>
            ))}
          </select>
          <Input
            name="agentId"
            defaultValue={filters.agentId}
            placeholder={t("Filters.agentId")}
          />
          <Input
            name="caip2Network"
            defaultValue={filters.caip2Network}
            placeholder={t("Filters.network")}
          />
          <Button type="submit">{t("Filters.apply")}</Button>
          <Button variant="ghost" asChild>
            <Link href="/admin/x402-payments">{t("Filters.clear")}</Link>
          </Button>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>{t("Rollup.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Columns.agent")}</TableHead>
                  <TableHead>{t("Rollup.total")}</TableHead>
                  <TableHead>{t("Rollup.pending")}</TableHead>
                  <TableHead>{t("Rollup.verified")}</TableHead>
                  <TableHead>{t("Rollup.failed")}</TableHead>
                  <TableHead>{t("Rollup.refunded")}</TableHead>
                  <TableHead>{t("Rollup.goodwill")}</TableHead>
                  <TableHead>{t("Rollup.failures")}</TableHead>
                  <TableHead>{t("Rollup.resolves")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>{t("Rollup.empty")}</TableCell>
                  </TableRow>
                ) : (
                  rollups.map((rollup) => (
                    <TableRow key={rollup.agentId}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          className="hover:underline"
                          href={`/admin/agents/${rollup.agentId}`}
                        >
                          {rollup.agentId}
                        </Link>
                      </TableCell>
                      <TableCell>{rollup.total}</TableCell>
                      <TableCell>{rollup.pending}</TableCell>
                      <TableCell>{rollup.verified}</TableCell>
                      <TableCell>{rollup.failed}</TableCell>
                      <TableCell>{rollup.refunded}</TableCell>
                      <TableCell>{rollup.goodwillRefundCount}</TableCell>
                      <TableCell>{rollup.failureCount}</TableCell>
                      <TableCell>{rollup.operatorResolveCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Payments.title", { count: page.total })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Columns.created")}</TableHead>
                  <TableHead>{t("Columns.status")}</TableHead>
                  <TableHead>{t("Columns.payment")}</TableHead>
                  <TableHead>{t("Columns.task")}</TableHead>
                  <TableHead>{t("Columns.agent")}</TableHead>
                  <TableHead>{t("Columns.network")}</TableHead>
                  <TableHead>{t("Columns.amount")}</TableHead>
                  <TableHead>{t("Columns.credits")}</TableHead>
                  <TableHead>{t("Columns.attempts")}</TableHead>
                  <TableHead className="text-right">
                    {t("Columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>{t("Payments.empty")}</TableCell>
                  </TableRow>
                ) : (
                  page.payments.map((payment: AdminTaskX402Payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {dateFormatter.format(payment.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(payment.status)}>
                          {t(`Statuses.${payment.status}`)}
                        </Badge>
                        {payment.refundKind ? (
                          <div className="text-muted-foreground mt-1">
                            {t(`RefundKinds.${payment.refundKind}`)}
                          </div>
                        ) : null}
                        {payment.failureReason ? (
                          <div className="text-muted-foreground mt-1">
                            {isFailureReason(payment.failureReason)
                              ? t(`FailureReasons.${payment.failureReason}`)
                              : payment.failureReason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-48 font-mono text-xs">
                        <div className="break-all">{payment.id}</div>
                        {payment.status === "PENDING" &&
                        payment.signRiskExpiresAt ? (
                          <div className="mt-1 text-muted-foreground">
                            {t("Payments.resolveAfter", {
                              date: dateFormatter.format(
                                payment.signRiskExpiresAt,
                              ),
                            })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          className="hover:underline"
                          href={`/admin/tasks/${payment.taskId}`}
                        >
                          {payment.taskId}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          className="hover:underline"
                          href={`/admin/agents/${payment.agentId}`}
                        >
                          {payment.agentId}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-52 text-xs">
                        <div>{payment.caip2Network}</div>
                        <div className="break-all font-mono text-muted-foreground">
                          {t("Columns.asset")}: {payment.asset}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-52 font-mono text-xs">
                        <div>{payment.amount}</div>
                        <div className="break-all text-muted-foreground">
                          {t("Columns.payTo")}: {payment.payTo}
                        </div>
                      </TableCell>
                      <TableCell>{payment.creditsCharged}</TableCell>
                      <TableCell>{payment.signAttemptCount}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {payment.status === "VERIFIED" ? (
                            <X402PaymentAction
                              paymentId={payment.id}
                              asset={payment.asset}
                              payTo={payment.payTo}
                              action="refund"
                            />
                          ) : null}
                          {payment.status === "PENDING" ? (
                            <X402PaymentAction
                              paymentId={payment.id}
                              asset={payment.asset}
                              payTo={payment.payTo}
                              action="resolve"
                              disabledUntil={
                                payment.signRiskExpiresAt
                                  ? new Date(payment.signRiskExpiresAt)
                                  : null
                              }
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {page.nextCursor ? (
              <div className="flex justify-end">
                <Button variant="outline" asChild>
                  <Link href={buildPageHref(filters, page.nextCursor)}>
                    {t("Payments.next")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
