import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'vela' },
    update: { name: 'Vela Admin' },
    create: { slug: 'vela', name: 'Vela Admin' },
  });

  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const guestPasswordHash = await bcrypt.hash('guest123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@vela.com' },
    update: {},
    create: {
      email: 'admin@vela.com',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'guest@vela.com' },
    update: {},
    create: {
      email: 'guest@vela.com',
      passwordHash: guestPasswordHash,
      role: 'MEMBER',
      tenantId: tenant.id,
    },
  });

  console.log('Seed completed.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
