"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ActivationBlockerAlert } from "@/components/admin/enterprise-contracts/activation-blocker-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { activateEnterpriseContractAction } from "@/lib/actions/enterprise-contract/action";
import type { EnterpriseContractActivationBlocker } from "@/lib/clients/generated/core/types.gen";

interface ActivateContractDialogProps {
  contractId: string;
}

export function ActivateContractDialog({
  contractId,
}: ActivateContractDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [blocker, setBlocker] =
    useState<EnterpriseContractActivationBlocker | null>(null);
  const [blockerMessage, setBlockerMessage] = useState<string | null>(null);

  function resetState() {
    setPaymentReference("");
    setBlocker(null);
    setBlockerMessage(null);
  }

  async function handleActivate() {
    setIsSubmitting(true);
    setBlocker(null);
    setBlockerMessage(null);

    try {
      const result = await activateEnterpriseContractAction({
        id: contractId,
        paymentReference: paymentReference.trim() || undefined,
      });

      if (!result.ok) {
        if (
          "kind" in result.error &&
          result.error.kind === "enterprise_activation_blocked"
        ) {
          setBlocker(result.error.blocker);
          setBlockerMessage(result.error.message);
          return;
        }

        toast.error(result.error.message ?? "Failed to activate contract");
        return;
      }

      toast.success("Contract activated");
      setOpen(false);
      resetState();
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Activate contract</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activate contract</DialogTitle>
          <DialogDescription>
            Activates the draft contract and creates the initial entitlement
            buckets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="activate-paymentReference">
              Payment reference (optional)
            </Label>
            <Input
              id="activate-paymentReference"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder="Wire transfer ID, PO number, etc."
            />
          </div>

          {blocker && blockerMessage ? (
            <ActivationBlockerAlert
              message={blockerMessage}
              blocker={blocker}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleActivate}
            disabled={isSubmitting}
          >
            Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
