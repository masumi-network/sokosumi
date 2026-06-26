import { redirect } from "next/navigation";

import { DEFAULT_AUTHENTICATED_LANDING_PATH } from "@/lib/utils/landing-path";

export default async function Page() {
  redirect(DEFAULT_AUTHENTICATED_LANDING_PATH);
}
