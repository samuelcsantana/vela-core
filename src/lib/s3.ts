import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const bucketName = process.env.AWS_S3_BUCKET_NAME!;

export async function uploadLogo(file: Buffer, filename: string, mimetype: string): Promise<string> {
  const key = `logos/${randomUUID()}-${filename}`;

  // No ACL is set here on purpose: buckets created since April 2023 default to
  // "Bucket owner enforced" object ownership, which disables ACLs entirely -
  // a PutObjectCommand with ACL: 'public-read' would fail on such a bucket.
  // Public read access must be granted via a bucket policy instead.
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: mimetype,
    }),
  );

  return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
