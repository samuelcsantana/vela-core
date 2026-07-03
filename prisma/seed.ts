import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'vela' },
    update: { name: 'Vela Admin' },
    create: { slug: 'vela', name: 'Vela Admin' },
  });

  const rootAdminPasswordHash = await bcrypt.hash('admin123', 10);
  const tenantAdminPasswordHash = await bcrypt.hash('tenantadmin123', 10);
  const guestPasswordHash = await bcrypt.hash('guest123', 10);

  // admin@vela.com is the root demo account the frontend expects to be
  // VELA_ADMIN. `update` explicitly sets the role too, not just `create`,
  // so re-running the seed against a database where this account already
  // exists (e.g. from before this role tier existed) still promotes it.
  await prisma.user.upsert({
    where: { email: 'admin@vela.com' },
    update: { role: 'VELA_ADMIN' },
    create: {
      email: 'admin@vela.com',
      passwordHash: rootAdminPasswordHash,
      role: 'VELA_ADMIN',
      tenantId: tenant.id,
    },
  });

  // Tenant-scoped admin demo account, distinct from the root VELA_ADMIN above.
  await prisma.user.upsert({
    where: { email: 'tenantadmin@vela.com' },
    update: {},
    create: {
      email: 'tenantadmin@vela.com',
      passwordHash: tenantAdminPasswordHash,
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
