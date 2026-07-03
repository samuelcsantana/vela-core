import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { prisma } from '../lib/prisma.js';
import { errorResponseSchema, roleSchema, withDescription } from '../lib/schemas.js';

const usersByTenantItemSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  userCount: z.number().int().nonnegative(),
});

const recentSignupSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: roleSchema,
  tenantId: z.string().uuid(),
  createdAt: z.date(),
});

const usersByRoleItemSchema = z.object({
  role: roleSchema,
  count: z.number().int().nonnegative(),
});

// `scope` is the discriminant the frontend switches on to know which shape it
// got back - VELA_ADMIN sees the whole system, everyone else only their tenant.
const globalDashboardMetricsSchema = z.object({
  scope: z.literal('GLOBAL'),
  totalTenants: z.number().int().nonnegative(),
  totalUsers: z.number().int().nonnegative(),
  usersByTenant: z.array(usersByTenantItemSchema),
  recentSignups: z.array(recentSignupSchema),
});

const tenantDashboardMetricsSchema = z.object({
  scope: z.literal('TENANT'),
  totalUsers: z.number().int().nonnegative(),
  usersByRole: z.array(usersByRoleItemSchema),
});

const dashboardMetricsSchema = z.discriminatedUnion('scope', [
  globalDashboardMetricsSchema,
  tenantDashboardMetricsSchema,
]);

export const metricsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/metrics/dashboard',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Metrics'],
        summary: 'Get aggregated metrics for the dashboard',
        description:
          'Any authenticated user - not admin-restricted, since MEMBER already has read access ' +
          'to comparable tenant-level data elsewhere in the API. VELA_ADMIN gets system-wide ' +
          'metrics (scope: GLOBAL): total tenants, total users, a per-tenant user breakdown for a ' +
          'donut chart, and the 5 most recent signups. ADMIN and MEMBER get metrics scoped to ' +
          'their own tenant (scope: TENANT): total users and a per-role breakdown for a local ' +
          'donut chart.',
        security: [{ cookieAuth: [] }],
        response: {
          200: withDescription(
            dashboardMetricsSchema,
            'Aggregated dashboard metrics - shape depends on the requester role (see scope)',
          ),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
        },
      },
    },
    async (request, reply) => {
      const { role, tenantId } = request.user;

      if (role === 'VELA_ADMIN') {
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

        return reply.send({
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
        });
      }

      const [totalUsers, usersByRole] = await Promise.all([
        prisma.user.count({ where: { tenantId } }),
        prisma.user.groupBy({
          by: ['role'],
          where: { tenantId },
          _count: { _all: true },
        }),
      ]);

      return reply.send({
        scope: 'TENANT' as const,
        totalUsers,
        usersByRole: usersByRole.map((group) => ({ role: group.role, count: group._count._all })),
      });
    },
  );
};
