import { redirect } from "next/navigation";

export default function CreateOAuthClientPage() {
  redirect("/developer?tab=oauth-clients");
}
