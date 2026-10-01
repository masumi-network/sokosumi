import { APPLE_APP_SITE_ASSOCIATION } from "@/config/apple-app-site-association";

export function GET() {
  return Response.json(APPLE_APP_SITE_ASSOCIATION);
}
