import { i18next } from "@/lib/i18next";

export interface EmailVerificationTemplateProps {
  name: string;
  verificationLink: string;
  lng?: string;
}

/**
 * Renders an email verification email in HTML format
 * Uses table-based layout for maximum email client compatibility
 */
export function renderEmailVerificationTemplate({
  name,
  verificationLink,
  lng = "en",
}: EmailVerificationTemplateProps): string {
  const t = i18next.getFixedT(lng, "emails");

  return `
<!DOCTYPE html>
<html lang="${lng}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${t("verification.subject")}</title>
  </head>
  <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif; background-color: #ffffff;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0; padding: 0;">
      <tr>
        <td style="padding: 40px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 465px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 5px;">
            <tr>
              <td style="padding: 20px;">
                <!-- Heading -->
                <h1 style="text-align: center; font-size: 24px; margin: 30px 0; font-weight: normal; color: #000000;">
                  ${t("verification.title")}
                </h1>
                
                <!-- Greeting -->
                <p style="font-size: 14px; line-height: 24px; color: #000000; margin: 0 0 16px 0;">
                  ${t("verification.greeting", { name })}
                </p>
                
                <!-- Message -->
                <p style="font-size: 14px; line-height: 24px; color: #000000; margin: 0 0 32px 0;">
                  ${t("verification.message")}
                </p>
                
                <!-- Button -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="padding: 0 0 32px 0;">
                      <a href="${verificationLink}" style="display: inline-block; padding: 12px 20px; background-color: #000000; color: #ffffff; text-decoration: none; border-radius: 5px; font-size: 12px; font-weight: 600;">
                        ${t("verification.button")}
                      </a>
                    </td>
                  </tr>
                </table>
                
                <!-- Link Instructions -->
                <p style="font-size: 14px; line-height: 24px; color: #000000; margin: 0 0 26px 0;">
                  ${t("verification.linkInstructions")}
                  <a href="${verificationLink}" style="color: #2563eb; text-decoration: none; word-break: break-all;">
                    ${verificationLink}
                  </a>
                </p>
                
                <!-- Divider -->
                <hr style="border: none; border-top: 1px solid #eaeaea; margin: 26px 0;">
                
                <!-- Footer -->
                <p style="font-size: 12px; line-height: 24px; color: #666666; margin: 0;">
                  ${t("verification.footer")}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

