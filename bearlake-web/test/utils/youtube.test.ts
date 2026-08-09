import { describe, expect, it } from 'vitest';
import { extractYouTubeId } from '../../src/utils/youtube.ts';

const ID = 'dQw4w9WgXcQ';

describe('extractYouTubeId', () => {
  it('accepts a bare id', () => {
    expect(extractYouTubeId(ID)).toBe(ID);
  });

  it('extracts from a watch?v= URL', () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('extracts from a watch?v= URL with extra query params', () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?list=PL123&v=${ID}&t=30s`)).toBe(ID);
  });

  it('extracts from a youtu.be short link', () => {
    expect(extractYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it('extracts from an /embed/ URL', () => {
    expect(extractYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  it('extracts from a /shorts/ URL', () => {
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
  });

  it('trims surrounding whitespace', () => {
    expect(extractYouTubeId(`  ${ID}  `)).toBe(ID);
  });

  it('rejects junk', () => {
    expect(extractYouTubeId('not a url')).toBeNull();
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('')).toBeNull();
    expect(extractYouTubeId('too-short')).toBeNull();
  });
});
