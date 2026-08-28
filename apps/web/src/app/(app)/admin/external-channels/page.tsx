import { redirect } from "next/navigation";

export default function LegacyExternalChannelsRedirect() {
  redirect("/admin/matched-channels");
}
