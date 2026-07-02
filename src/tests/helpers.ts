import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export const GUEST_CREDENTIALS = { email: 'guest@vela.com', password: 'guest123' };
export const ADMIN_CREDENTIALS = { email: 'admin@vela.com', password: 'admin123' };

export async function seedBaseData() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'vela' },
    update: {},
    create: { slug: 'vela', name: 'Vela Admin' },
  });

  await prisma.user.upsert({
    where: { email: ADMIN_CREDENTIALS.email },
    update: {},
    create: {
      email: ADMIN_CREDENTIALS.email,
      passwordHash: await bcrypt.hash(ADMIN_CREDENTIALS.password, 10),
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });

  await prisma.user.upsert({
    where: { email: GUEST_CREDENTIALS.email },
    update: {},
    create: {
      email: GUEST_CREDENTIALS.email,
      passwordHash: await bcrypt.hash(GUEST_CREDENTIALS.password, 10),
      role: 'MEMBER',
      tenantId: tenant.id,
    },
  });

  return tenant;
}
