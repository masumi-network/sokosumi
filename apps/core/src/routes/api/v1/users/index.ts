import { OpenAPIHonoWithAuth } from "../../../../lib/hono";
import idRouter from "./id";
import meRouter from "./me";

const app = new OpenAPIHonoWithAuth();

app.route("/", meRouter);
app.route("/", idRouter);

export default app;
