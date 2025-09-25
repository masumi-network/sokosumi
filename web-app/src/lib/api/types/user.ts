// Explicit TypeScript types so next-openapi-gen (schemaType: typescript) can resolve nested shapes
export type UserResponse = {
  id: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  name: string;
  email: string;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  jobStatusEmailNotificationsEnabled: boolean;
  stripeCustomerId: string | null;
};

export type UserSuccessResponse = {
  success: true;
  data: UserResponse;
  timestamp: string;
};
// PUT and PATCH /users/me
export type UpdateUserProfileSchema = {
  name: string; // Full name
  marketingOptIn: boolean; // Marketing opt-in status
  jobStatusEmailNotificationsEnabled: boolean; // Job status notification preference
};

export type DeleteUserSchema = {
  currentPassword: string; // Current account password
};
