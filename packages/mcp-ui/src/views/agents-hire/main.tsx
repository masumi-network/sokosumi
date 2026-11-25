import { mountView } from "../../shell/mount.tsx";
import { AgentsHire, HireResult } from "./AgentsHire.tsx";

mountView("agents-hire", {
  schema: HireResult,
  children: (data, context) => <AgentsHire data={data} context={context} />,
});
