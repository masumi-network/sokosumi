import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TransactionSource } from "@/lib/clients/generated/core";
import { transactionHistoryService } from "@/lib/services/transaction-history.service";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

interface TransactionHistorySectionProps {
  cursor?: string;
  returnPath: string;
}

const SOURCE_LABEL_KEYS: Record<TransactionSource, string> = {
  [TransactionSource.JOB_PURCHASE]: "sources.jobPurchase",
  [TransactionSource.JOB_REFUND]: "sources.jobRefund",
  [TransactionSource.TASK_USAGE]: "sources.taskUsage",
  [TransactionSource.COWORKER_USAGE]: "sources.coworkerUsage",
  [TransactionSource.ORCHESTRATOR_USAGE]: "sources.orchestratorUsage",
  [TransactionSource.CREDIT_GRANT]: "sources.creditGrant",
  [TransactionSource.OTHER]: "sources.other",
};

export async function TransactionHistorySection({
  cursor,
  returnPath,
}: TransactionHistorySectionProps) {
  const [t, formatter, { transactions, pagination }] = await Promise.all([
    getTranslations("App.Billing.History"),
    getFormatter(),
    transactionHistoryService.listTransactionHistory({ cursor }),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {transactions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.type")}</TableHead>
                <TableHead className="text-right">
                  {t("columns.credits")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => {
                const credits = formatCreditsForDisplay(transaction.credits);
                const jobHref =
                  transaction.jobId && transaction.agentId
                    ? `/agents/${encodeURIComponent(transaction.agentId)}/jobs/${encodeURIComponent(transaction.jobId)}`
                    : null;
                const typeLabel = t(SOURCE_LABEL_KEYS[transaction.source]);

                return (
                  <TableRow key={transaction.id}>
                    <TableCell className="text-muted-foreground">
                      {formatter.dateTime(transaction.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell>
                      {jobHref ? (
                        <Link href={jobHref} className="hover:underline">
                          {typeLabel}
                        </Link>
                      ) : (
                        typeLabel
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        credits >= 0
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {t("creditsValue", { credits })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {pagination?.nextCursor ? (
          <Link
            href={`${returnPath}&historyCursor=${encodeURIComponent(pagination.nextCursor)}`}
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            {t("loadMore")}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
