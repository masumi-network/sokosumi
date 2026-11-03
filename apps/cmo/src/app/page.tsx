import { Home, type HomeSearchParams } from "./home";

/** The chat with Cuso; signed out, the proxy serves the waitlist site here. */
export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  return Home({ searchParams, view: "chat" });
}
