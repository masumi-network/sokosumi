import { mountView } from "../../shell/mount.tsx";
import { AgentsHire, HireResult } from "./AgentsHire.tsx";

mountView("agents-hire", {
  skeleton: "form",
  schema: HireResult,
  children: (data, context) => <AgentsHire data={data} context={context} />,
});
