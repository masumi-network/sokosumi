import * as Postmark from "postmark";

import { getEnv } from "@/config/env";

export const postmarkClient = new Postmark.ServerClient(
  getEnv().POSTMARK_SERVER_ID,
);
