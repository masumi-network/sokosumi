import { connection } from "next/server";
import { TableEditor } from "@/app/drive/tables/table-editor";

// A table editor is entirely URL-specific and authenticated. Keep it out of
// the instant-navigation shell until it has a meaningful shared boundary.
export const instant = false;

export default async function TablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  return <TableEditor id={id} />;
}
