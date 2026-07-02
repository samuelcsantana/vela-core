import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_REGION = 'test-region-1';
const TEST_BUCKET = 'test-bucket';

const { sendMock } = vi.hoisted(() => {
  // s3.ts reads these at module load time, so they must be set before it's
  // imported below - independent of whatever real AWS_* values are (or
  // aren't) present in the environment (e.g. CI has none).
  process.env.AWS_REGION = 'test-region-1';
  process.env.AWS_S3_BUCKET_NAME = 'test-bucket';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key-id';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-access-key';

  return { sendMock: vi.fn() };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3ClientMock() {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommandMock(input: unknown) {
    return { input };
  }),
}));

import { uploadLogo } from '../lib/s3.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';

describe('uploadLogo', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('uploads the file to S3 and returns its public URL', async () => {
    const url = await uploadLogo(Buffer.from('fake-png-bytes'), 'logo.png', 'image/png');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(url).toMatch(new RegExp(`^https://${TEST_BUCKET}\\.s3\\.${TEST_REGION}\\.amazonaws\\.com/logos/.+-logo\\.png$`));
  });

  it('sends the correct bucket, content type and body to S3', async () => {
    const buffer = Buffer.from('fake-png-bytes');
    await uploadLogo(buffer, 'brand.png', 'image/png');

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: TEST_BUCKET,
        Body: buffer,
        ContentType: 'image/png',
        Key: expect.stringMatching(/^logos\/.+-brand\.png$/),
      }),
    );
  });

  it('does not set an ACL (public read must come from a bucket policy)', async () => {
    await uploadLogo(Buffer.from('fake'), 'logo.png', 'image/png');

    const call = vi.mocked(PutObjectCommand).mock.calls[0][0] as Record<string, unknown>;
    expect(call.ACL).toBeUndefined();
  });
});
