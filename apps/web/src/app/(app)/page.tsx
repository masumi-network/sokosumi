import { redirect } from "next/navigation";

import { chatUIEnabled } from "@/lib/flags/chat";

export default async function Page() {
  const isChatEnabled = await chatUIEnabled();

  if (isChatEnabled) {
    redirect("/chat");
  } else {
    redirect("/agents");
  }
}
