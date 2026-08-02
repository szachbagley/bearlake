import { z } from 'zod';

/** Request validation for announcements. */

export const announcementIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

export const createAnnouncementSchema = z.strictObject({
  body: z.string().trim().min(1, 'is required').max(5000),
});

/** Only the body is editable; `postedAt` is fixed at creation (plan D18). */
export const updateAnnouncementSchema = z.strictObject({
  body: z.string().trim().min(1, 'is required').max(5000),
});

export const listAnnouncementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
