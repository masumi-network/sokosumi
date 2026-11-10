import { readConnectResult } from "../../../lib/connect-window";
import { ConnectDone } from "./connect-done";

interface ConnectDonePageProps {
  searchParams: Promise<{ result?: string | string[] }>;
}

/** Where Launch's connect window ends; it tells Launch and closes. */
export default async function ConnectDonePage({
  searchParams,
}: ConnectDonePageProps) {
  const { result } = await searchParams;
  return (
    <ConnectDone
      result={readConnectResult(Array.isArray(result) ? result[0] : result)}
    />
  );
}
