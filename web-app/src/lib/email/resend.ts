import { Resend } from "resend";

import { getEnvSecrets } from "@/config/env.config";

export const resend = new Resend(getEnvSecrets().RESEND_API_KEY);
