"use client";

import type { SeoConsoleExportInput } from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readOrImportConsoleExport } from "@/lib/actions/seo/console-export";
import type { SeoOwner } from "@/lib/seo/owner";

export function useSeoConsoleExports(
  owner: SeoOwner,
  taskId: string,
  userId: string,
  organizationId: string | null,
) {
  const client = useQueryClient();
  const key = [
    "seo-console-exports",
    organizationId,
    userId,
    owner.kind,
    owner.id,
    taskId,
  ];
  const context = { owner, taskId, userId, organizationId };
  const reports = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await readOrImportConsoleExport(context);
      if (!result.ok) throw new Error(String(result.error));
      return result.value;
    },
    retry: false,
    gcTime: 0,
  });
  const upload = useMutation({
    mutationFn: async ({
      file,
      input,
    }: {
      file: File;
      input: {
        kind: SeoConsoleExportInput["kind"];
        date: string;
        inspectExamples: boolean;
        reason: Extract<
          SeoConsoleExportInput,
          { kind: "indexing_examples" }
        >["reason"];
      };
    }) => {
      if (file.size > 256 * 1024 || !file.name.toLowerCase().endsWith(".csv"))
        throw new Error("422");
      const csv = await file.text();
      const body: SeoConsoleExportInput =
        input.kind !== "indexing_examples"
          ? { kind: input.kind, date: input.date, csv }
          : {
              kind: input.kind,
              date: input.date,
              reason: input.reason,
              csv,
              ...(input.inspectExamples && { inspectExamples: true as const }),
            };
      const result = await readOrImportConsoleExport({ ...context, body });
      if (!result.ok) throw new Error(String(result.error));
      return result.value;
    },
    onSuccess: (data) => client.setQueryData(key, data),
  });
  return { reports, upload };
}
