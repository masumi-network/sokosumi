import * as Postmark from "postmark";

import { getEnv } from "@/config/env.js";

export const postmarkClient = new Postmark.ServerClient(
  getEnv().POSTMARK_SERVER_ID,
);
