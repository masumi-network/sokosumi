import { Home, type HomeSearchParams } from "./home";

/** Today, the home; signed out, the proxy serves the waitlist site here. */
export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  return Home({ searchParams, view: "today" });
}
