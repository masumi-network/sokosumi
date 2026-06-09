"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { cancelEnterpriseContractAction } from "@/lib/actions/enterprise-contract/action";

interface CancelContractDialogProps {
  contractId: string;
}

export function CancelContractDialog({
  contractId,
}: CancelContractDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCancel() {
    setIsSubmitting(true);
    try {
      const result = await cancelEnterpriseContractAction({ id: contractId });
      if (!result.ok) {
        toast.error(result.error.message ?? "Failed to cancel contract");
        return;
      }

      toast.success("Contract canceled");
      setOpen(false);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Cancel contract</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel active contract</DialogTitle>
          <DialogDescription>
            This marks the contract as canceled. Existing entitlements follow
            the current lifecycle rules in Core.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Keep active
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
