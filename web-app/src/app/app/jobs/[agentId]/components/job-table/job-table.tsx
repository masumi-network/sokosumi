"use client";

import { useFormatter, useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { cn } from "@/lib/utils";

import { columns } from "./columns";
import { dummyJobData } from "./data";

export default function JobTable() {
  const t = useTranslations("App.Jobs.JobTable");
  const dateFormatter = useFormatter();

  return (
    <DataTable
      columns={columns(t, dateFormatter)}
      data={dummyJobData.sort(
        (a, b) =>
          new Date(b.startedTime).getTime() - new Date(a.startedTime).getTime(),
      )}
      containerClassName={cn("w-full lg:w-[max(400px,36%)] rounded-md border")}
    />
  );
}
