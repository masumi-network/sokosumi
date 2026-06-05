import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { EnterpriseContractActivationBlocker } from "@/lib/clients/generated/core/types.gen";

interface ActivationBlockerAlertProps {
  message: string;
  blocker: EnterpriseContractActivationBlocker;
}

export function ActivationBlockerAlert({
  message,
  blocker,
}: ActivationBlockerAlertProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Activation blocked</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{message}</p>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">Subscription ID</dt>
            <dd className="font-mono text-xs">{blocker.subscriptionId}</dd>
          </div>
          <div>
            <dt className="font-medium">Stripe subscription</dt>
            <dd className="font-mono text-xs">
              {blocker.stripeSubscriptionId}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Plan</dt>
            <dd>{blocker.plan}</dd>
          </div>
          <div>
            <dt className="font-medium">Scope</dt>
            <dd className="capitalize">{blocker.scope}</dd>
          </div>
        </dl>
      </AlertDescription>
    </Alert>
  );
}
