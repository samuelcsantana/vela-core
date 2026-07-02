import { z } from 'zod';
import { validatorCompiler as zodValidatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest, FastifySchemaCompiler } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { verifyAdmin } from '../lib/auth.js';
import { uploadLogo } from '../lib/s3.js';
import { errorResponseSchema, validationErrorResponseSchema, withDescription } from '../lib/schemas.js';

// The `logo` field only exists here to drive Swagger's multipart/form-data
// documentation (see bypassBodyValidation below) - the actual file is parsed
// separately by parseTenantMultipart and never appears in `fields`.
const logoDocsField = z
  .string()
  .optional()
  .meta({
    type: 'string',
    format: 'binary',
    description: 'Optional logo image file, uploaded to S3. Sets logoUrl on the tenant.',
  });

const createTenantFieldsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  primaryColor: z.string().optional(),
  logo: logoDocsField,
});

const updateTenantFieldsSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  primaryColor: z.string().optional(),
  logo: logoDocsField,
});

// Fastify would otherwise run the global zod validatorCompiler against
// request.body, but multipart requests never populate request.body (fields
// are parsed manually via parseTenantMultipart) - so body validation is a
// harmless no-op here, while params/querystring/etc. still validate normally.
const bypassBodyValidation: FastifySchemaCompiler<any> = (routeSchema) => {
  if (routeSchema.httpPart === 'body') {
    return () => ({ value: undefined });
  }

  return zodValidatorCompiler(routeSchema);
};

const tenantSlugParamsSchema = z.object({
  slug: z.string(),
});

const tenantResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  primaryColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
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

// Portfolio demo safeguard against exhausting the free-tier database plan.
// Set well above the tenant count our own test suite creates in a single
// run (see tenant.routes.spec.ts + auth.e2e.spec.ts), so CI never trips it.
export const MAX_TENANTS_LIMIT = 20;

interface ParsedLogo {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

class InvalidLogoError extends Error {
  statusCode = 400;
}

// Fastify's schema-based body validation only understands application/json,
// so multipart routes parse and validate the form manually instead of
// relying on the zod type provider's automatic request.body handling.
async function parseTenantMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; logo?: ParsedLogo }> {
  const fields: Record<string, string> = {};
  let logo: ParsedLogo | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname === 'logo') {
        if (!part.mimetype.startsWith('image/')) {
          throw new InvalidLogoError('logo must be an image file');
        }

        logo = {
          buffer: await part.toBuffer(),
          filename: part.filename,
          mimetype: part.mimetype,
        };
      } else {
        // Drain and discard any file sent under a field we don't care about -
        // busboy won't advance to the next part until this stream is consumed.
        await part.toBuffer();
      }
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }

  return { fields, logo };
}

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
      const { fields, logo } = await parseTenantMultipart(request);
      const { name, slug, primaryColor } = createTenantFieldsSchema.parse(fields);

      const tenantCount = await prisma.tenant.count();

      if (tenantCount >= MAX_TENANTS_LIMIT) {
        return reply.status(403).send({
          error: `Free tier limit reached. Maximum number of tenants allowed in this demo is ${MAX_TENANTS_LIMIT}.`,
        });
      }

      const logoUrl = logo ? await uploadLogo(logo.buffer, logo.filename, logo.mimetype) : undefined;

      const tenant = await prisma.tenant.create({
        data: { name, slug, primaryColor, logoUrl },
      });

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
      const tenants = await prisma.tenant.findMany();

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
      const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true },
      });

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
      const { fields, logo } = await parseTenantMultipart(request);
      const { name, slug, primaryColor } = updateTenantFieldsSchema.parse(fields);

      const existingTenant = await prisma.tenant.findUnique({ where: { id } });

      if (!existingTenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      if (slug) {
        const tenantWithSlug = await prisma.tenant.findUnique({ where: { slug } });

        if (tenantWithSlug && tenantWithSlug.id !== id) {
          return reply.status(409).send({ error: 'Another tenant already uses this slug' });
        }
      }

      const logoUrl = logo ? await uploadLogo(logo.buffer, logo.filename, logo.mimetype) : undefined;

      const tenant = await prisma.tenant.update({
        where: { id },
        data: { name, slug, primaryColor, logoUrl },
      });

      return reply.send(tenant);
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
      const { slug } = request.params;

      const tenant = await prisma.tenant.findUnique({ where: { slug } });

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      return reply.send(tenant);
    },
  );
};
