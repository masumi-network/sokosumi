/**
 * Email templates for the Core API
 * Each template is in its own file for better organization
 */

export {
  type EmailVerificationTemplateProps,
  renderEmailVerificationTemplate,
} from "./emailVerification.template.js";
export {
  type OrganizationInvitationTemplateProps,
  renderOrganizationInvitationTemplate,
} from "./organizationInvitation.template.js";
export {
  type PasswordResetTemplateProps,
  renderPasswordResetTemplate,
} from "./passwordReset.template.js";
