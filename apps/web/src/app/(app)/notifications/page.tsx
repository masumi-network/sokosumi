import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { NotificationsPageContent } from "./page-content";

export default async function NotificationsPage() {
  await getSessionOrRedirect();

  return <NotificationsPageContent />;
}
