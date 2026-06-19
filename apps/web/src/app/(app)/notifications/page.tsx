import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { NotificationsPageContent } from "./page-content";

export default async function NotificationsPage() {
  const session = await getSessionOrRedirect();

  return <NotificationsPageContent userId={session.user.id} />;
}
