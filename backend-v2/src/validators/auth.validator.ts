import { z } from 'zod';

/** Shared password policy — requirements §13. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

export const emailSchema = z.string().trim().toLowerCase().email('Invalid email address').max(255);

export const loginSchema = z
  .object({
    /**
     * Requirements §4: students and staff sign in against their school's code.
     * Omitted for the platform owner, who belongs to no school.
     */
    schoolCode: z.string().trim().max(32).optional().default(''),
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export const createSchoolSchema = z
  .object({
    schoolCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9-]+$/, 'School code may contain only letters, digits and hyphens'),
    name: z.string().trim().min(2).max(160),
    city: z.string().trim().max(120).optional(),
    plan: z.enum(['BASIC', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
    /**
     * Optional hex. An empty string — what a form submits when no colour was
     * chosen — is normalised to absent rather than stored; the column is
     * nullable and an "" would sit awkwardly alongside real hex values.
     */
    primaryColor: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #2D6CDF').optional()
    ),
    customDomain: z.string().trim().toLowerCase().max(255).optional(),

    /**
     * The school's first administrator, created in the same transaction.
     *
     * Required, not optional. A school without an admin is a school nobody can
     * log into — §3's purchase → create → provision flow does not complete, and
     * until this existed the only way to finish it was a seed script. Making it
     * optional would leave that dead end reachable.
     *
     * The password is optional: omit it and the account is created without a
     * usable one and sent a reset link, so the platform owner never handles a
     * customer's credential. Supplying one is supported for automation.
     */
    admin: z
      .object({
        email: emailSchema,
        name: z.string().trim().min(2).max(120),
        password: passwordSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const createUserSchema = z
  .object({
    email: emailSchema,
    /**
     * Optional, for the same reason it is optional on `createSchoolSchema`
     * above: omit it and the account is created unusable and sent a set-password
     * link, so a school admin never has to invent a credential for a child and
     * hand it over in person.
     *
     * It was mandatory until 2026-08-07, which forced exactly that — and the
     * passwords a harried administrator invents for thirty pupils in a row are
     * not passwords. Supplying one is still supported for automation.
     */
    password: passwordSchema.optional(),
    name: z.string().trim().min(2).max(120),
    // A school admin may create staff and learners, never another super admin.
    role: z.enum(['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT']),
  })
  .strict();

/**
 * A second factor is either a 6-digit TOTP code or a recovery code. One field
 * takes both: asking the user to declare which they are using adds a step, and
 * the two are trivially distinguishable by shape.
 */
const secondFactorCode = z.string().trim().min(6).max(20);

export const twoFactorVerifySchema = z
  .object({
    challengeToken: z.string().min(1),
    code: secondFactorCode,
  })
  .strict();

export const twoFactorEnableSchema = z
  .object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your app') })
  .strict();

/** Disabling 2FA and reissuing recovery codes both re-check the password. */
export const twoFactorDisableSchema = z
  .object({ password: z.string().min(1, 'Password is required') })
  .strict();

/**
 * A reset request is school-scoped like login: the same address may hold
 * accounts at several institutions, and they must not be conflated.
 */
export const forgotPasswordSchema = z
  .object({
    schoolCode: z.string().trim().max(32).optional().default(''),
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required').max(256),
    // The new password must satisfy the same policy as any other; a reset is
    // not a way around it.
    password: passwordSchema,
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;
export type TwoFactorEnableInput = z.infer<typeof twoFactorEnableSchema>;
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
