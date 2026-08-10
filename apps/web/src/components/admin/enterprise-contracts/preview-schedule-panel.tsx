"use client";

import { useFormatter } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ContractPeriodsTable } from "@/components/admin/enterprise-contracts/contract-periods-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { previewEnterpriseContractPeriodsAction } from "@/lib/actions/enterprise-contract/action";
import type { EnterpriseContractPreview } from "@/lib/clients/generated/core/types.gen";

const dateTimeOptions = {
  dateStyle: "medium",
  timeStyle: "short",
} as const;

interface PreviewSchedulePanelProps {
  contractId: string;
}

export function PreviewSchedulePanel({
  contractId,
}: PreviewSchedulePanelProps) {
  const formatter = useFormatter();
  const [activatedAt, setActivatedAt] = useState("");
  const [preview, setPreview] = useState<EnterpriseContractPreview | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handlePreview() {
    if (!activatedAt.trim()) {
      toast.error("Choose an activation date before previewing the schedule.");
      return;
    }

    setIsLoading(true);
    try {
      const result = await previewEnterpriseContractPeriodsAction({
        id: contractId,
        activatedAt: new Date(activatedAt).toISOString(),
      });

      if (!result.ok) {
        toast.error(result.error.message ?? "Failed to preview schedule");
        setPreview(null);
        return;
      }

      setPreview(result.value);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="preview-activatedAt">
              Hypothetical activation time
            </Label>
            <Input
              id="preview-activatedAt"
              type="datetime-local"
              value={activatedAt}
              onChange={(event) => setActivatedAt(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Required. The preview uses this go-live time; it is not defaulted
              to now.
            </p>
          </div>
          <Button
            type="button"
            onClick={handlePreview}
            disabled={isLoading || !activatedAt.trim()}
          >
            Preview schedule
          </Button>
        </div>

        {preview ? (
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Activated at</dt>
                <dd className="font-medium">
                  {formatter.dateTime(preview.activatedAt, dateTimeOptions)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contract ends</dt>
                <dd className="font-medium">
                  {formatter.dateTime(preview.endsAt, dateTimeOptions)}
                </dd>
              </div>
            </dl>
            <ContractPeriodsTable periods={preview.periods} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
