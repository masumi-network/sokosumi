import { Home, type HomeSearchParams } from "./home";

/** Today, the home; signed out, it goes on to sign in. */
export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  return Home({ searchParams, view: "today" });
}
