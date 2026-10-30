import { z } from 'zod';
import { CREATABLE_ROLES } from '@/lib/domain/roles';
import { emailSchema } from './auth';

export const createOfficerSchema = z.strictObject({
  email: emailSchema,
  displayName: z.string().trim().min(2).max(60),
  role: z.enum(CREATABLE_ROLES),
});

export const updateOfficerSchema = z.strictObject({
  action: z.enum(['disable', 'enable', 'reset_password', 'reset_mfa']),
});

export const uuidSchema = z.uuid();
