import { DataTable } from "@/components/data-table";

import { columns } from "./columns";
import { dummyJobData } from "./data";

export default function JobTable() {
  return <DataTable columns={columns} data={dummyJobData} className="w-min" />;
}
