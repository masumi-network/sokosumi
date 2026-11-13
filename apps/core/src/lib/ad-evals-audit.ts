import type { AdEvalExportManifest } from "@/services/ad-evals-export.service";

import { tryUseLogger } from "./evlog";

/** The audit manifest links an export version to hashed workspace membership for revocation requests. */
export function auditAdEvalsExport(
  adminId: string,
  manifest: AdEvalExportManifest,
) {
  tryUseLogger()?.audit({
    action: "ad-evals.export",
    actor: { type: "user", id: adminId },
    target: { type: "ad-evals-export", id: manifest.exportId, ...manifest },
    outcome: "success",
  });
}

export function auditAdEvalsExportFailure(adminId: string, requestId: string) {
  tryUseLogger()?.audit({
    action: "ad-evals.export",
    actor: { type: "user", id: adminId },
    target: { type: "ad-evals-export", id: requestId },
    outcome: "failure",
    reason: "Export could not be completed",
  });
}
