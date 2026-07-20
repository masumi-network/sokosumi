import { redirect } from "next/navigation";

export default function OAuthClientPage() {
  redirect("/developer?tab=oauth-clients");
}
