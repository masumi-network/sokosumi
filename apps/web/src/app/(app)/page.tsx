import { redirect } from "next/navigation";

import { getDefaultAppPath } from "@/lib/flags/task-rail";

export default async function Page() {
  redirect(await getDefaultAppPath());
}
