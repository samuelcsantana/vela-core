import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { verifyAdmin } from '../lib/auth.js';
import { bypassBodyValidation, parseTenantMultipart } from '../lib/multipart.js';
import { errorResponseSchema, validationErrorResponseSchema, withDescription } from '../lib/schemas.js';
import {
  createTenant,
  deleteTenant,
  getTenantBySlug,
  listPublicTenants,
  listTenants,
  updateTenant,
} from '../services/tenant.service.js';

// The `logo` and `backgroundImage` fields only exist here to drive Swagger's
// multipart/form-data documentation (see bypassBodyValidation in lib/multipart.ts) -
// the actual files are parsed separately by parseTenantMultipart and never appear
// in `fields`.
const logoDocsField = z.string().optional().meta({
  type: 'string',
  format: 'binary',
  description: 'Optional logo image file, uploaded to S3. Sets logoUrl on the tenant.',
});
const backgroundImageDocsField = z.string().optional().meta({
  type: 'string',
  format: 'binary',
  description: 'Optional background image file, uploaded to S3. Sets backgroundImageUrl on the tenant.',
});

const createTenantFieldsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  primaryColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  logoWidth: z.coerce.number().int().min(16).max(512).optional(),
  logo: logoDocsField,
  backgroundImage: backgroundImageDocsField,
});

const updateTenantFieldsSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  primaryColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  logoWidth: z.coerce.number().int().min(16).max(512).optional(),
  logo: logoDocsField,
  backgroundImage: backgroundImageDocsField,
});

const tenantSlugParamsSchema = z.object({
  slug: z.string(),
});

const tenantResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  primaryColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  backgroundImageUrl: z.string().nullable(),
  logoWidth: z.number().int().nullable(),
  createdAt: z.date(),
});

const tenantPublicListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

const tenantIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const deleteTenantResponseSchema = z.object({
  message: z.string(),
});

// Query string values are always strings - `z.coerce.boolean()` would treat
// "false" as truthy (JS coerces any non-empty string to true), silently
// making ?force=false behave like force=true. An explicit string enum with a
// manual `=== 'true'` check in the handler avoids that trap.
const deleteTenantQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
});

const tenantHasUsersErrorSchema = z.object({
  error: z.literal('TENANT_HAS_USERS'),
  userCount: z.number().int().nonnegative(),
});

export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/tenants',
    {
      preHandler: [app.authenticate, verifyAdmin],
      validatorCompiler: bypassBodyValidation,
      schema: {
        tags: ['Tenants'],
        summary: 'Create a new tenant',
        description:
          'Admin only. Creates a new tenant company. Accepts multipart/form-data so a logo can be uploaded to S3.',
        security: [{ cookieAuth: [] }],
        consumes: ['multipart/form-data'],
        body: createTenantFieldsSchema,
        response: {
          201: withDescription(tenantResponseSchema, 'Tenant created successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(
            errorResponseSchema,
            'Authenticated user is not an admin, or the free tier tenant limit has been reached',
          ),
          409: withDescription(errorResponseSchema, 'A tenant with this slug already exists'),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      const { fields, logo, backgroundImage } = await parseTenantMultipart(request);
      const { name, slug, primaryColor, backgroundColor, logoWidth } = createTenantFieldsSchema.parse(fields);

      const tenant = await createTenant({ name, slug, primaryColor, logo, backgroundColor, backgroundImage, logoWidth });

      return reply.status(201).send(tenant);
    },
  );

  app.get(
    '/tenants',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Tenants'],
        summary: 'List all tenants',
        description: 'Any authenticated user can list tenants.',
        security: [{ cookieAuth: [] }],
        response: {
          200: withDescription(z.array(tenantResponseSchema), 'List of tenants'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
        },
      },
    },
    async (request, reply) => {
      const tenants = await listTenants();

      return reply.send(tenants);
    },
  );

  app.get(
    '/tenants/public',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'List tenants (public, minimal fields)',
        description:
          'Public. Returns only non-sensitive fields (id, name, slug) for every tenant, ' +
          'to populate the tenant picker on the registration screen.',
        response: {
          200: withDescription(z.array(tenantPublicListItemSchema), 'List of tenants (public fields only)'),
        },
      },
    },
    async (request, reply) => {
      const tenants = await listPublicTenants();

      return reply.send(tenants);
    },
  );

  app.patch(
    '/tenants/:id',
    {
      preHandler: [app.authenticate, verifyAdmin],
      validatorCompiler: bypassBodyValidation,
      schema: {
        tags: ['Tenants'],
        summary: 'Update a tenant',
        description:
          'Admin only. Partially updates name, slug, primaryColor and/or logo (uploaded to S3). ' +
          'Accepts multipart/form-data.',
        security: [{ cookieAuth: [] }],
        consumes: ['multipart/form-data'],
        params: tenantIdParamsSchema,
        body: updateTenantFieldsSchema,
        response: {
          200: withDescription(tenantResponseSchema, 'Tenant updated successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
          404: withDescription(errorResponseSchema, 'No tenant matches the given id'),
          409: withDescription(errorResponseSchema, 'Another tenant already uses this slug'),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { fields, logo, backgroundImage } = await parseTenantMultipart(request);
      const { name, slug, primaryColor, backgroundColor, logoWidth } = updateTenantFieldsSchema.parse(fields);

      const tenant = await updateTenant(id, { name, slug, primaryColor, logo, backgroundColor, backgroundImage, logoWidth });

      return reply.send(tenant);
    },
  );

  app.delete(
    '/tenants/:id',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Tenants'],
        summary: 'Delete a tenant',
        description:
          'Admin only. By default, fails with 409 if the tenant still has users - pass ' +
          '?force=true to delete the tenant and cascade-delete its users too. Intended to back ' +
          'a "type to confirm" / double-confirmation flow on the frontend.',
        security: [{ cookieAuth: [] }],
        params: tenantIdParamsSchema,
        querystring: deleteTenantQuerySchema,
        response: {
          200: withDescription(deleteTenantResponseSchema, 'Tenant deleted successfully'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
          404: withDescription(errorResponseSchema, 'No tenant matches the given id'),
          409: withDescription(
            tenantHasUsersErrorSchema,
            'Tenant still has users; retry with ?force=true to delete them too',
          ),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { force } = request.query;

      await deleteTenant(id, force === 'true');

      return reply.status(200).send({ message: 'Tenant deleted successfully' });
    },
  );

  app.get(
    '/tenants/:slug',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'Get a tenant by slug',
        description: 'Public white-label lookup, used to fetch branding before login.',
        params: tenantSlugParamsSchema,
        response: {
          200: withDescription(tenantResponseSchema, 'Tenant found'),
          404: withDescription(errorResponseSchema, 'No tenant matches the given slug'),
        },
      },
    },
    async (request, reply) => {
      const tenant = await getTenantBySlug(request.params.slug);

      return reply.send(tenant);
    },
  );
};
