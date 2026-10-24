import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { CatchUpView } from "./components/catch-up-view";

/** "While you were away" across the reader's rooms (chat signals). */
export default async function ChatCatchUpPage() {
  await getSessionOrRedirect();
  return <CatchUpView />;
}
