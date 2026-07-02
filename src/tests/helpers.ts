import type { Response } from 'light-my-request';
import bcrypt from 'bcryptjs';
import FormData from 'form-data';
import { prisma } from '../lib/prisma.js';

export function extractTokenCookie(response: Response): string {
  const token = response.cookies.find((cookie) => cookie.name === 'token')?.value;

  if (!token) {
    throw new Error('Login response did not set a token cookie');
  }

  return token;
}

export function buildTenantMultipart(
  fields: Record<string, string>,
  file?: { buffer: Buffer; filename: string; contentType: string; fieldname?: string },
): { payload: Buffer; headers: Record<string, string> } {
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  if (file) {
    form.append(file.fieldname ?? 'logo', file.buffer, {
      filename: file.filename,
      contentType: file.contentType,
    });
  }

  return {
    payload: form.getBuffer(),
    headers: form.getHeaders(),
  };
}

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
