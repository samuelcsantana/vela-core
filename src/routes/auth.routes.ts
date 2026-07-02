import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const { email, password } = loginBodySchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return reply.unauthorized('Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      return reply.unauthorized('Invalid credentials');
    }

    const token = app.jwt.sign({
      id: user.id,
      role: user.role,
      tenantId: user.tenantId,
    });

    return reply.send({ token });
  });
}
