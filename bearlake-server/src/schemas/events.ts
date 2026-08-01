import { z } from 'zod';

/**
 * Request validation for events (plan D15/D17).
 *
 * The body is discriminated on `isAllDay`: a timed event carries ISO-8601
 * instants, an all-day event carries date-only strings. Enforcing the two
 * shapes here is what keeps an all-day event from ever being stored as a
 * midnight-to-midnight instant, which would shift across DST and timezones.
 */

const MAX_WINDOW_DAYS = 366;

/** A real calendar date in `YYYY-MM-DD` form — rejects 2026-02-30 and friends. */
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD form')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) return false;
    // Round-trip through UTC to confirm the components form a real date without
    // letting the host timezone shift anything.
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'is not a real calendar date');

/** An ISO-8601 instant with an explicit offset or `Z`. */
const instantSchema = z
  .string()
  .datetime({ offset: true, message: 'must be an ISO-8601 timestamp with an offset' });

const titleSchema = z.string().trim().min(1, 'is required').max(200);
const notesSchema = z.string().max(5000).nullish();

const timedEvent = z.strictObject({
  isAllDay: z.literal(false),
  title: titleSchema,
  notes: notesSchema,
  startsAt: instantSchema,
  endsAt: instantSchema,
});

const allDayEvent = z.strictObject({
  isAllDay: z.literal(true),
  title: titleSchema,
  notes: notesSchema,
  startsAt: dateOnlySchema,
  endsAt: dateOnlySchema,
});

/**
 * The authoritative shape of a complete event. Cross-field ordering is checked
 * here on the union so it runs for both create and (post-merge) patch.
 */
export const eventBodySchema = z
  .discriminatedUnion('isAllDay', [timedEvent, allDayEvent])
  .superRefine((data, ctx) => {
    if (data.isAllDay) {
      // YYYY-MM-DD sorts chronologically as text.
      if (data.startsAt > data.endsAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The end date must not be before the start date.',
          path: ['endsAt'],
        });
      }
    } else if (Date.parse(data.startsAt) >= Date.parse(data.endsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The end time must be after the start time.',
        path: ['endsAt'],
      });
    }
  });

export type EventBodyInput = z.infer<typeof eventBodySchema>;

/**
 * PATCH is partial. Fields are validated loosely here — only enough to reject
 * unknown keys and empty patches — then merged onto the stored event and
 * revalidated through `eventBodySchema`, so toggling `isAllDay` requires the
 * matching date shapes and the ordering check always sees the whole event.
 */
export const patchEventSchema = z
  .strictObject({
    isAllDay: z.boolean().optional(),
    title: titleSchema.optional(),
    notes: notesSchema,
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    { message: 'Provide at least one field to change.' },
  );

export type PatchEventInput = z.infer<typeof patchEventSchema>;

export const eventIdParamSchema = z.object({
  id: z.string().uuid('must be a valid id'),
});

/**
 * The range query (plan D16). Both bounds are required, `start` must precede
 * `end`, and the window is capped so a client cannot request the whole table.
 */
export const eventRangeQuerySchema = z
  .object({
    start: instantSchema,
    end: instantSchema,
  })
  .refine((q) => Date.parse(q.start) < Date.parse(q.end), {
    message: 'start must be before end',
    path: ['start'],
  })
  .refine(
    (q) => {
      // A coarse guard against an unbounded fetch, not day arithmetic: the
      // exact count of days does not matter, only that it is roughly a year.
      const spanMs = Date.parse(q.end) - Date.parse(q.start);
      return spanMs <= MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    },
    { message: `The range must not exceed ${String(MAX_WINDOW_DAYS)} days.`, path: ['end'] },
  );

export type EventRangeQueryInput = z.infer<typeof eventRangeQuerySchema>;
