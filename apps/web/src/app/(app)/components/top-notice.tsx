import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const TOP_NOTICE_STYLES = {
  warning: {
    action:
      "border-semantic-warning-tertiary text-semantic-warning hover:bg-semantic-warning-quinary hover:text-semantic-warning self-start bg-transparent",
    alert:
      "border-semantic-warning-tertiary bg-semantic-warning-quinary text-semantic-warning",
    text: "text-semantic-warning",
  },
  destructive: {
    action:
      "border-semantic-destructive-tertiary text-semantic-destructive hover:bg-semantic-destructive-quinary hover:text-semantic-destructive self-start bg-transparent",
    alert:
      "border-semantic-destructive-tertiary bg-semantic-destructive-quinary text-semantic-destructive",
    text: "text-semantic-destructive",
  },
} as const;

export type TopNoticeTone = keyof typeof TOP_NOTICE_STYLES;

export const TOP_NOTICE_ACTION_CLASS_NAME = TOP_NOTICE_STYLES.warning.action;

export function getTopNoticeActionClassName(
  tone: TopNoticeTone = "warning",
): string {
  return TOP_NOTICE_STYLES[tone].action;
}

interface TopNoticeProps {
  title: string;
  description: string;
  action: ReactNode;
  tone?: TopNoticeTone;
}

export default function TopNotice({
  title,
  description,
  action,
  tone = "warning",
}: TopNoticeProps) {
  const styles = TOP_NOTICE_STYLES[tone];

  return (
    <div className="sticky top-0 z-10 mb-4">
      <Alert className={styles.alert}>
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle className={styles.text}>{title}</AlertTitle>
        <AlertDescription className={cn(styles.text)}>
          <div className="flex flex-col gap-2">
            <p>{description}</p>
            {action}
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
