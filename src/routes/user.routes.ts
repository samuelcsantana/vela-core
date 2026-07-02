import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyAdmin } from '../lib/auth.js';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  tenantId: z.string().uuid(),
});

export async function userRoutes(app: FastifyInstance) {
  app.post('/users', { preHandler: [app.authenticate, verifyAdmin] }, async (request, reply) => {
    const { email, password, tenantId } = createUserBodySchema.parse(request.body);

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, passwordHash, tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    return reply.status(201).send(user);
  });

  app.get('/users', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.user;

    const users = await prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        createdAt: true,
      },
    });

    return reply.send(users);
  });
}
