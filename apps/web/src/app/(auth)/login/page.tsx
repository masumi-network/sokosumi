import { redirect } from "next/navigation";

import {
  type AuthRedirectSearchParams,
  getRedirectQueryString,
} from "@/lib/auth/auth.utils";

// `instant` is read per segment, so the (auth) layout's opt-out does not
// cover this page. Auth/admin entry stays blocking on purpose.
export const instant = false;

interface LoginRedirectProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function LoginRedirect({
  searchParams,
}: LoginRedirectProps) {
  const query = await getRedirectQueryString(searchParams);
  redirect(query ? `/signin?${query}` : "/signin");
}
