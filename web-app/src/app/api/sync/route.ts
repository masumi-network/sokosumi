import { authenticateApiRequest } from "@/lib/auth/utils";

export function GET(request: Request) {
  const authResult = authenticateApiRequest(request);
  if (!authResult.ok) return authResult.response;

  return new Response("Hello from Vercel!");
}
