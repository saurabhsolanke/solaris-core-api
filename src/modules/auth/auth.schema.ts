import { z } from 'zod';

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address format'),
  tenant_id: z.string().regex(uuidRegex, 'Invalid tenant UUID format').optional(),
  sub: z.string().regex(uuidRegex, 'Invalid user UUID format').optional(),
  user_id: z.string().regex(uuidRegex, 'Invalid user UUID format').optional(),
  role: z.enum(['ADMIN', 'EMPLOYEE']).optional(),
  password: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
