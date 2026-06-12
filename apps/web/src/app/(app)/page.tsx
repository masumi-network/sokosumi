import { redirect } from "next/navigation";

import { getDefaultAuthenticatedLandingPath } from "@/lib/utils/landing-path";

export default async function Page() {
  const path = await getDefaultAuthenticatedLandingPath();
  redirect(path);
}
