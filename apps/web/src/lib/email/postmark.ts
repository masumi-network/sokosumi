import * as Postmark from "postmark";

import { getEnvSecrets } from "@/config/env.secrets";

export const postmarkClient = new Postmark.ServerClient(
  getEnvSecrets().POSTMARK_SERVER_ID,
);
