"use client";

import { useFormatter } from "next-intl";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  EnterpriseContractPeriod,
  EnterpriseContractPreviewPeriod,
} from "@/lib/clients/generated/core/types.gen";
import { formatCreditsForDisplay } from "@/lib/utils/credits";

type PeriodRow = EnterpriseContractPeriod | EnterpriseContractPreviewPeriod;

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

interface ContractPeriodsTableProps {
  periods: PeriodRow[];
  showStatus?: boolean;
}

export function ContractPeriodsTable({
  periods,
  showStatus = false,
}: ContractPeriodsTableProps) {
  const formatter = useFormatter();

  if (periods.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No periods to display.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period start</TableHead>
            <TableHead>Period end</TableHead>
            <TableHead>Credits to grant</TableHead>
            <TableHead>Seats</TableHead>
            {showStatus ? <TableHead>Status</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.map((period, index) => (
            <TableRow key={"id" in period ? period.id : `preview-${index}`}>
              <TableCell>
                {formatter.dateTime(period.periodStart, dateTimeOptions)}
              </TableCell>
              <TableCell>
                {formatter.dateTime(period.periodEnd, dateTimeOptions)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatter.number(
                  formatCreditsForDisplay(period.creditsToGrant),
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {period.purchasedSeats}
              </TableCell>
              {showStatus && "status" in period ? (
                <TableCell className="capitalize">{period.status}</TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
