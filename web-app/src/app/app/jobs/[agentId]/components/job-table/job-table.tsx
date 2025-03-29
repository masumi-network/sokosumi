"use client";

import { useFormatter, useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";
import { cn } from "@/lib/utils";

import { columns } from "./columns";

interface JobTableProps {
  jobs: JobWithRelations[];
}

export default function JobTable({ jobs }: JobTableProps) {
  const t = useTranslations("App.Jobs.JobTable");
  const dateFormatter = useFormatter();

  return (
    <DataTable
      columns={columns(t, dateFormatter)}
      data={jobs}
      containerClassName={cn("w-full lg:w-[max(400px,36%)] rounded-md border")}
    />
  );
}
