import { Resend } from "resend";

import { envSecrets } from "@/config/env.config";

export const resend = new Resend(envSecrets.RESEND_API_KEY);
