import { JobStatus } from "@prisma/client";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

export default function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useTranslations("App.Jobs.JobTable.JobStatusBadge");

  switch (status) {
    case JobStatus.COMPLETED:
      return (
        <Badge variant="default" className="bg-green-700 text-white">
          {t("completed")}
        </Badge>
      );
    case JobStatus.FAILED:
      return <Badge variant="destructive">{t("failed")}</Badge>;
    case JobStatus.PAYMENT_PENDING:
      return (
        <Badge variant="default" className="bg-yellow-600 text-white">
          {t("paymentPending")}
        </Badge>
      );
    case JobStatus.PROCESSING:
      return (
        <Badge variant="default" className="bg-yellow-600 text-white">
          {t("processing")}
        </Badge>
      );
    case JobStatus.PAYMENT_FAILED:
      return <Badge variant="destructive">{t("paymentFailed")}</Badge>;
  }
}
