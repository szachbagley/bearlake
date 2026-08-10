import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeDownscaleDimensions, downscaleImage } from '../../src/utils/image.ts';

describe('computeDownscaleDimensions', () => {
  it('never upscales an image already under the cap', () => {
    expect(computeDownscaleDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales the long edge down to the cap, keeping aspect ratio', () => {
    expect(computeDownscaleDimensions(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it('scales a portrait image by its long (vertical) edge', () => {
    expect(computeDownscaleDimensions(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it('is a no-op for an image exactly at the cap', () => {
    expect(computeDownscaleDimensions(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
  });
});

describe('downscaleImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads HEIC as-is, without touching canvas at all', async () => {
    const heicBytes = new Uint8Array([1, 2, 3]);
    const file = new File([heicBytes], 'photo.heic', { type: 'image/heic' });

    const result = await downscaleImage(file);

    expect(result.contentType).toBe('image/heic');
    expect(result.blob).toBe(file);
  });

  it('downscales a JPEG via canvas and re-encodes at the target dimensions', async () => {
    const closeSpy = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 2000, close: closeSpy }),
    );

    const drawImage = vi.fn();
    const outputBlob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    const toBlob = vi.fn((cb: BlobCallback) => cb(outputBlob));
    const getContext = vi.fn().mockReturnValue({ drawImage });

    let capturedWidth = 0;
    let capturedHeight = 0;
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return document.createElement(tag);
      const canvas = {
        getContext,
        toBlob,
        set width(value: number) {
          capturedWidth = value;
        },
        get width() {
          return capturedWidth;
        },
        set height(value: number) {
          capturedHeight = value;
        },
        get height() {
          return capturedHeight;
        },
      };
      return canvas as unknown as HTMLCanvasElement;
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const result = await downscaleImage(file);

    expect(capturedWidth).toBe(2000);
    expect(capturedHeight).toBe(1000);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1000);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(result).toEqual({ blob: outputBlob, contentType: 'image/jpeg' });
    expect(closeSpy).toHaveBeenCalledOnce();

    createElementSpy.mockRestore();
  });

  it('throws if the canvas cannot produce a 2D context', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }),
    );
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return document.createElement(tag);
      return { getContext: () => null } as unknown as HTMLCanvasElement;
    });

    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    await expect(downscaleImage(file)).rejects.toThrow('Canvas 2D context is not available.');

    createElementSpy.mockRestore();
  });
});
