import { prisma } from '../lib/prisma.js';
import type { JwtPayload } from '../lib/auth.js';

// `scope` is the discriminant the frontend switches on to know which shape it
// got back - VELA_ADMIN sees the whole system, everyone else only their tenant.
// The RBAC decision lives here (not in the route) so no caller can ask for
// the GLOBAL shape without actually holding the VELA_ADMIN role.
export async function getDashboardMetrics({ role, tenantId }: JwtPayload) {
  if (role === 'VELA_ADMIN') {
    return getGlobalMetrics();
  }

  return getTenantMetrics(tenantId);
}

async function getGlobalMetrics() {
  const [totalTenants, totalUsers, tenants, recentSignups] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, _count: { select: { users: true } } },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, email: true, role: true, tenantId: true, createdAt: true },
    }),
  ]);

  return {
    scope: 'GLOBAL' as const,
    totalTenants,
    totalUsers,
    usersByTenant: tenants.map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      userCount: tenant._count.users,
    })),
    recentSignups,
  };
}

async function getTenantMetrics(tenantId: string) {
  const [totalUsers, usersByRole] = await Promise.all([
    prisma.user.count({ where: { tenantId } }),
    prisma.user.groupBy({
      by: ['role'],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  return {
    scope: 'TENANT' as const,
    totalUsers,
    usersByRole: usersByRole.map((group) => ({ role: group.role, count: group._count._all })),
  };
}
