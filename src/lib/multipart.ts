import { validatorCompiler as zodValidatorCompiler } from 'fastify-type-provider-zod';
import type { FastifyRequest, FastifySchemaCompiler } from 'fastify';
import type { LogoFile } from '../services/tenant.service.js';

class InvalidLogoError extends Error {
  statusCode = 400;
}

// Fastify would otherwise run the global zod validatorCompiler against
// request.body, but multipart requests never populate request.body (fields
// are parsed manually via parseTenantMultipart) - so body validation is a
// harmless no-op here, while params/querystring/etc. still validate normally.
export const bypassBodyValidation: FastifySchemaCompiler<any> = (routeSchema) => {
  if (routeSchema.httpPart === 'body') {
    return () => ({ value: undefined });
  }

  return zodValidatorCompiler(routeSchema);
};

// Fastify's schema-based body validation only understands application/json,
// so multipart routes parse and validate the form manually instead of
// relying on the zod type provider's automatic request.body handling.
export async function parseTenantMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; logo?: LogoFile }> {
  const fields: Record<string, string> = {};
  let logo: LogoFile | undefined;

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
