import { redirect } from "next/navigation";

import { AppRoute } from "@/types/routes";

export default function Page() {
  redirect(AppRoute.Agents);
}
