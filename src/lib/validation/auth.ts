import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const MIN_PASSWORD_LENGTH = 10;

export const changePasswordSchema = z.strictObject({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(72),
});
