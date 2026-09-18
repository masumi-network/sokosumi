import { connection } from "next/server";
import { TableEditor } from "@/app/drive/tables/table-editor";
export default async function TablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return <TableEditor id={id} />;
}
