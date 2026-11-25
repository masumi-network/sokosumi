import { mountView } from "../../shell/mount.tsx";
import { HelloData, HelloView } from "./HelloView.tsx";

mountView("hello", {
  schema: HelloData,
  isEmpty: (data) => data.name === "",
  children: (data, context) => <HelloView data={data} context={context} />,
});
