import { Resend } from "resend";

import { envServer } from "../../../config/env.config";

export const resend = new Resend(envServer.RESEND_API_KEY);
