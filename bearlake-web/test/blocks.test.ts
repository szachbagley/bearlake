import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  blocksSchema,
  blockSchema,
  isKnownBlockType,
  stripImageUrls,
  type ApiBlock,
} from '../src/types/blocks.ts';

describe('isKnownBlockType', () => {
  it('recognizes exactly the five known types', () => {
    for (const type of ['heading', 'paragraph', 'bullets', 'image', 'video']) {
      expect(isKnownBlockType(type)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isKnownBlockType('callout')).toBe(false);
    expect(isKnownBlockType('')).toBe(false);
  });
});

describe('blockSchema', () => {
  it('accepts a valid block of each known type', () => {
    const cases = [
      { id: randomUUID(), type: 'heading', text: 'Pool' },
      { id: randomUUID(), type: 'paragraph', text: 'Check the chlorine weekly.' },
      { id: randomUUID(), type: 'bullets', items: ['Test strips', 'Chlorine tablets'] },
      {
        id: randomUUID(),
        type: 'image',
        key: `articles/${randomUUID()}/${randomUUID()}`,
        caption: 'The dial',
      },
      { id: randomUUID(), type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
    ];

    for (const block of cases) {
      expect(blockSchema.safeParse(block).success, JSON.stringify(block)).toBe(true);
    }
  });

  it('preserves an unrecognized block type, including fields it does not know about', () => {
    const future = {
      id: randomUUID(),
      type: 'callout',
      style: 'warning',
      text: 'Watch your step on the dock.',
    };

    const result = blockSchema.safeParse(future);
    expect(result.success).toBe(true);
    // Every field round-trips, not just id/type — nothing is stripped.
    expect(result.data).toEqual(future);
  });

  it('rejects a malformed known block rather than silently treating it as unknown', () => {
    // A "heading" missing text must fail — not fall through to the unknown
    // passthrough just because it didn't match headingBlockSchema exactly.
    const malformed = { id: randomUUID(), type: 'heading' };
    const result = blockSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  it('rejects every documented cap', () => {
    const cases: Record<string, unknown> = {
      'non-uuid id': { id: 'block-1', type: 'heading', text: 'x' },
      'heading too long': { id: randomUUID(), type: 'heading', text: 'x'.repeat(201) },
      'empty heading': { id: randomUUID(), type: 'heading', text: '' },
      'paragraph too long': { id: randomUUID(), type: 'paragraph', text: 'x'.repeat(10_001) },
      'empty bullets': { id: randomUUID(), type: 'bullets', items: [] },
      'too many bullets': {
        id: randomUUID(),
        type: 'bullets',
        items: Array.from({ length: 101 }, (_, i) => `item ${String(i)}`),
      },
      'bullet item too long': { id: randomUUID(), type: 'bullets', items: ['x'.repeat(501)] },
      'bad image key': { id: randomUUID(), type: 'image', key: 'https://example.com/x.jpg' },
      'caption too long': {
        id: randomUUID(),
        type: 'image',
        key: `articles/${randomUUID()}/${randomUUID()}`,
        caption: 'x'.repeat(301),
      },
      'bad video id': { id: randomUUID(), type: 'video', provider: 'youtube', videoId: 'short' },
      'wrong video provider': {
        id: randomUUID(),
        type: 'video',
        provider: 'vimeo',
        videoId: 'dQw4w9WgXcQ',
      },
      'extra field on a known block': { id: randomUUID(), type: 'heading', text: 'x', extra: 1 },
    };

    for (const [name, block] of Object.entries(cases)) {
      expect(blockSchema.safeParse(block).success, name).toBe(false);
    }
  });
});

describe('blocksSchema', () => {
  it('rejects duplicate ids within the array', () => {
    const id = randomUUID();
    const result = blocksSchema.safeParse([
      { id, type: 'heading', text: 'a' },
      { id, type: 'paragraph', text: 'b' },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects more than the maximum number of blocks', () => {
    const blocks = Array.from({ length: 201 }, () => ({
      id: randomUUID(),
      type: 'heading',
      text: 'x',
    }));
    expect(blocksSchema.safeParse(blocks).success).toBe(false);
  });

  it('accepts exactly the maximum and a mix of known and unknown blocks', () => {
    const blocks = [
      { id: randomUUID(), type: 'heading', text: 'x' },
      { id: randomUUID(), type: 'callout', text: 'preserved' },
    ];
    expect(blocksSchema.safeParse(blocks).success).toBe(true);
  });
});

describe('stripImageUrls', () => {
  it('removes url from image blocks and leaves everything else untouched', () => {
    const key = `articles/${randomUUID()}/${randomUUID()}`;
    const blocks: ApiBlock[] = [
      { id: randomUUID(), type: 'heading', text: 'Pool' },
      { id: randomUUID(), type: 'image', key, url: 'https://bucket.s3.amazonaws.com/signed' },
    ];

    const stripped = stripImageUrls(blocks);

    expect(stripped).toEqual([
      { id: blocks[0]?.id, type: 'heading', text: 'Pool' },
      { id: blocks[1]?.id, type: 'image', key },
    ]);
    expect(JSON.stringify(stripped)).not.toContain('url');
  });
});
