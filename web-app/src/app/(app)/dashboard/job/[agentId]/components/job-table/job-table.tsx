import { DataTable } from "@/components/data-table";

import { columns } from "./columns";
import { dummyJobData } from "./data";

export default function JobTable() {
  return (
    <DataTable
      columns={columns}
      data={dummyJobData.slice(0, 18)}
      containerClassName="w-[calc(100vw-64px)] lg:w-[max(400px,36%)] rounded-md border overflow-y-auto"
    />
  );
}
