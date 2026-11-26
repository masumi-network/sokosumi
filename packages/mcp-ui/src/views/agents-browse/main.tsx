import { mountView } from "../../shell/mount.tsx";
import {
  AGENTS_EMPTY,
  AgentsBrowse,
  AgentsList,
  hireable,
} from "./AgentsBrowse.tsx";

mountView("agents-browse", {
  skeleton: "cards",
  schema: AgentsList,
  isEmpty: (data) => hireable(data).length === 0,
  empty: AGENTS_EMPTY,
  children: (data, context) => <AgentsBrowse data={data} context={context} />,
});
