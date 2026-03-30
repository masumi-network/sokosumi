import { redirect } from "next/navigation";

import {
  type AuthRedirectSearchParams,
  getRedirectQueryString,
} from "@/lib/utils/auth-redirect";

interface RegisterRedirectProps {
  searchParams: Promise<AuthRedirectSearchParams>;
}

export default async function RegisterRedirect({
  searchParams,
}: RegisterRedirectProps) {
  const query = await getRedirectQueryString(searchParams);
  redirect(query ? `/signup?${query}` : "/signup");
}
