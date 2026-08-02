import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config.js';
import type { ImageUrlResolver } from './imageUrlService.js';

/**
 * S3 access for knowledge-base images (plan D24/D25).
 *
 * Presigning is a local HMAC computation — no network call — so this works in
 * tests with dummy credentials. The bucket is private (Block Public Access on),
 * so every read and write goes through a short-lived presigned URL.
 */

const PUT_TTL_SECONDS = 10 * 60;
const GET_TTL_SECONDS = 15 * 60;

/** Thrown when a presign is attempted without S3 configured (plan D30a). */
export class S3NotConfiguredError extends Error {
  constructor() {
    super('Image storage (S3) is not configured.');
    this.name = 'S3NotConfiguredError';
  }
}

let client: S3Client | undefined;

function s3(): { client: S3Client; bucket: string } {
  const { s3: cfg } = getConfig();
  if (
    cfg.bucket === '' ||
    cfg.region === '' ||
    cfg.accessKeyId === '' ||
    cfg.secretAccessKey === ''
  ) {
    throw new S3NotConfiguredError();
  }
  client ??= new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return { client, bucket: cfg.bucket };
}

/** Whether S3 is configured; boot uses this to decide the image URL resolver. */
export function isS3Configured(): boolean {
  const { s3: cfg } = getConfig();
  return (
    cfg.bucket !== '' && cfg.region !== '' && cfg.accessKeyId !== '' && cfg.secretAccessKey !== ''
  );
}

/** Namespaced per article so orphan cleanup can scope by prefix later. */
export function generateImageKey(articleId: string): string {
  return `articles/${articleId}/${randomUUID()}`;
}

/**
 * A presigned PUT. `ContentType` and `ContentLength` are set on the command so
 * they become signed headers: S3 rejects an upload whose actual type or size
 * differs from what was presigned, which is what makes the size cap a hard one
 * rather than an honor-system client check (plan D25).
 */
export async function presignPut(params: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  const { client: s3Client, bucket } = s3();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });
  return getSignedUrl(s3Client, command, {
    expiresIn: PUT_TTL_SECONDS,
    // Sign content-length as a header so S3 enforces the declared size.
    signableHeaders: new Set(['content-length', 'content-type']),
  });
}

/** A presigned GET, 15-minute expiry (plan D24). */
export async function presignGet(key: string): Promise<string> {
  const { client: s3Client, bucket } = s3();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: GET_TTL_SECONDS });
}

/** The production image-URL resolver, wired into imageUrlService at boot. */
export const s3ImageUrlResolver: ImageUrlResolver = {
  presignImageGet: presignGet,
};
