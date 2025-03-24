import { Resend } from "resend";

import { env } from "../../../config/env.config";

export const resend = new Resend(env.RESEND_API_KEY);
