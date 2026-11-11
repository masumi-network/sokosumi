import { readConnectResult } from "../../../lib/connect-window";
import { ConnectDone } from "./connect-done";

interface ConnectDonePageProps {
  searchParams: Promise<{
    result?: string | string[];
    project?: string | string[];
  }>;
}

/** Where Launch's connect window ends; it tells Launch and closes. */
export default async function ConnectDonePage({
  searchParams,
}: ConnectDonePageProps) {
  const { result, project } = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return (
    <ConnectDone
      result={readConnectResult(first(result))}
      project={first(project) || null}
    />
  );
}
