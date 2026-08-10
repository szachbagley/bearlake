import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadImage, UploadRejectedError } from '../../../src/features/articles/upload.ts';
import { MAX_UPLOAD_BYTES } from '../../../src/types/limits.ts';
import { createFakeApiClient } from '../../auth/testUtils.tsx';

/** A controllable stand-in for XMLHttpRequest (plan step 5's XHR-based PUT,
 * for real upload progress) — the test triggers upload.onprogress/onload
 * itself rather than hitting a real network. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  status = 200;
  headers: Record<string, string> = {};
  sentBody: unknown = null;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.sentBody = body;
  }
}

afterEach(() => {
  FakeXHR.instances = [];
  vi.unstubAllGlobals();
});

function installFakeXHR(): typeof FakeXHR {
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  return FakeXHR;
}

describe('uploadImage', () => {
  it('rejects a disallowed content type before calling presignUpload', async () => {
    installFakeXHR();
    const presignUpload = vi.fn();
    const api = createFakeApiClient({ presignUpload });
    const file = new File(['x'], 'clip.gif', { type: 'image/gif' });

    await expect(uploadImage(api, 'article-1', file)).rejects.toThrow(UploadRejectedError);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('rejects an oversize file before calling presignUpload', async () => {
    installFakeXHR();
    const presignUpload = vi.fn();
    const api = createFakeApiClient({ presignUpload });
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    // HEIC skips canvas downscaling entirely, so its blob size is exactly
    // the file's own size — the simplest way to exercise the size check
    // without mocking canvas.
    const file = new File([oversized], 'photo.heic', { type: 'image/heic' });

    await expect(uploadImage(api, 'article-1', file)).rejects.toThrow(UploadRejectedError);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it('presigns, PUTs with the exact content-type and byte length, and returns the key', async () => {
    const XHR = installFakeXHR();
    const presignUpload = vi
      .fn()
      .mockResolvedValue({ key: 'articles/a1/img1', uploadUrl: 'https://s3.example/put-here' });
    const api = createFakeApiClient({ presignUpload });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([bytes], 'photo.heic', { type: 'image/heic' });

    const promise = uploadImage(api, 'article-1', file);
    await Promise.resolve();
    await Promise.resolve();

    expect(presignUpload).toHaveBeenCalledExactlyOnceWith({
      articleId: 'article-1',
      contentType: 'image/heic',
      contentLength: bytes.length,
    });

    const xhr = XHR.instances[0];
    if (xhr === undefined) throw new Error('no XHR instance created');
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://s3.example/put-here');
    expect(xhr.headers['Content-Type']).toBe('image/heic');
    expect((xhr.sentBody as Blob).size).toBe(bytes.length);

    xhr.status = 200;
    xhr.onload?.();

    await expect(promise).resolves.toBe('articles/a1/img1');
  });

  it('reports upload progress via onProgress', async () => {
    const XHR = installFakeXHR();
    const presignUpload = vi
      .fn()
      .mockResolvedValue({ key: 'articles/a1/img1', uploadUrl: 'https://s3.example/put-here' });
    const api = createFakeApiClient({ presignUpload });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.heic', { type: 'image/heic' });
    const onProgress = vi.fn();

    const promise = uploadImage(api, 'article-1', file, onProgress);
    await Promise.resolve();
    await Promise.resolve();

    const xhr = XHR.instances[0];
    if (xhr === undefined) throw new Error('no XHR instance created');
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(50);

    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it('rejects when the PUT returns a non-2xx status', async () => {
    const XHR = installFakeXHR();
    const presignUpload = vi
      .fn()
      .mockResolvedValue({ key: 'articles/a1/img1', uploadUrl: 'https://s3.example/put-here' });
    const api = createFakeApiClient({ presignUpload });
    const file = new File([new Uint8Array([1])], 'photo.heic', { type: 'image/heic' });

    const promise = uploadImage(api, 'article-1', file);
    await Promise.resolve();
    await Promise.resolve();

    const xhr = XHR.instances[0];
    if (xhr === undefined) throw new Error('no XHR instance created');
    xhr.status = 403;
    xhr.onload?.();

    await expect(promise).rejects.toThrow('status 403');
  });
});
