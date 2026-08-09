import { YOUTUBE_ID_PATTERN } from '../types/limits.ts';

/**
 * YouTube ID extraction (plan W26). Accepts a pasted URL in any of the four
 * documented shapes, or a bare 11-character id — the server only ever
 * stores and validates the id itself.
 */
const YOUTUBE_URL_PATTERNS: RegExp[] = [
  /(?:^|\/\/)(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
  /(?:^|\/\/)(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})/,
  /(?:^|\/\/)(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /(?:^|\/\/)(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

/** Returns the 11-character video id, or `null` if `input` is neither a
 * recognized YouTube URL nor a bare valid id. */
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (YOUTUBE_ID_PATTERN.test(trimmed)) return trimmed;

  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = pattern.exec(trimmed);
    const id = match?.[1];
    if (id !== undefined) return id;
  }

  return null;
}
