import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.string(),
});

export const validationErrorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.any()).optional(),
});

export const roleSchema = z.enum(['VELA_ADMIN', 'ADMIN', 'MEMBER']);

export const userPublicSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: roleSchema,
  tenantId: z.string().uuid(),
  createdAt: z.date(),
});

export function withDescription<T extends z.ZodTypeAny>(schema: T, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  };
}
