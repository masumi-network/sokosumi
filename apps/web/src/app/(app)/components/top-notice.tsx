import { AlertTriangle } from "lucide-react";
import { type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const TOP_NOTICE_ACTION_CLASS_NAME =
  "border-semantic-warning-tertiary text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning self-start bg-transparent";

interface TopNoticeProps {
  title: string;
  description: string;
  action: ReactNode;
}

export default function TopNotice({
  title,
  description,
  action,
}: TopNoticeProps) {
  return (
    <div className="sticky top-0 z-10 mb-4">
      <Alert className="border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning">
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className="text-semantic-warning">{title}</AlertTitle>
        <AlertDescription className="text-semantic-warning">
          <div className="flex flex-col gap-2">
            <p>{description}</p>
            {action}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
