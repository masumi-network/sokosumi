import { Badge } from "@/components/ui/badge";

import { JobStatus } from "./schema";

export default function JobStatusBadge({ status }: { status: JobStatus }) {
  if (status == "Completed")
    return (
      <Badge variant="default" className="bg-green-700 text-white">
        Completed
      </Badge>
    );

  if (status == "Failed") return <Badge variant="destructive">Failed</Badge>;

  if (status == "Pending")
    return (
      <Badge variant="default" className="bg-yellow-700 text-white">
        Pending
      </Badge>
    );

  if (status == "Cancelled") return <Badge variant="outline">Cancelled</Badge>;
}
