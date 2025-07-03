import { Resend } from "resend";

import { getEnvSecrets } from "@/config/env.secrets";

export const resend = new Resend(getEnvSecrets().RESEND_API_KEY);
