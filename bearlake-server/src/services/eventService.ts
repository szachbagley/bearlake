import {
  deleteEvent,
  findEventById,
  insertEvent,
  listEventsInRange,
  updateEvent,
} from '../db/queries/events.js';
import type { Event, EventWrite, User } from '../types/domain.js';
import { ForbiddenError, InternalError, NotFoundError } from '../types/errors.js';
import {
  type EventBodyInput,
  eventBodySchema,
  type PatchEventInput,
} from '../schemas/events.js';
import { windowDenverDates } from './dateRange.js';

/**
 * Event business logic (spec §8.3–8.5).
 *
 * Any authenticated user may create events and read them. Editing and deleting
 * are limited to the event's creator and to admins — enforced here, not by the
 * client hiding a button.
 */

/** A validated event body → the columns to write. */
function toWrite(body: EventBodyInput): EventWrite {
  return {
    title: body.title,
    notes: body.notes ?? null,
    isAllDay: body.isAllDay,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
  };
}

/** Creator or admin. 404 is decided before this, so the event is known to exist. */
function assertCanModify(event: Event, caller: User): void {
  if (caller.role !== 'admin' && event.createdBy !== caller.id) {
    throw new ForbiddenError('You can only change events you created.');
  }
}

export async function listInRange(startInstant: string, endInstant: string): Promise<Event[]> {
  const { firstDate, lastDate } = windowDenverDates(
    new Date(startInstant),
    new Date(endInstant),
  );

  return listEventsInRange({
    startInstant,
    endInstant,
    windowFirstDate: firstDate,
    windowLastDate: lastDate,
  });
}

export async function get(id: string): Promise<Event> {
  const event = await findEventById(id);
  if (event === null) {
    throw new NotFoundError('That event could not be found.');
  }
  return event;
}

export async function create(body: EventBodyInput, createdBy: string): Promise<Event> {
  return insertEvent(toWrite(body), createdBy);
}

/**
 * Applies a partial change.
 *
 * 404 is resolved before the ownership check, so a member probing for another
 * member's event id cannot tell an existing event they can't touch from one
 * that isn't there. The patch is merged onto the stored event's API form and
 * revalidated as a whole, which is what makes toggling `isAllDay` demand the
 * matching date shapes and keeps the ordering rule honest.
 */
export async function update(id: string, patch: PatchEventInput, caller: User): Promise<Event> {
  const existing = await findEventById(id);
  if (existing === null) {
    throw new NotFoundError('That event could not be found.');
  }

  assertCanModify(existing, caller);

  const merged: Record<string, unknown> = {
    isAllDay: existing.isAllDay,
    title: existing.title,
    notes: existing.notes,
    startsAt: existing.startsAt,
    endsAt: existing.endsAt,
  };
  for (const key of ['isAllDay', 'title', 'notes', 'startsAt', 'endsAt'] as const) {
    if (patch[key] !== undefined) {
      merged[key] = patch[key];
    }
  }

  const validated = eventBodySchema.parse(merged);

  const updated = await updateEvent(id, toWrite(validated));
  if (updated === null) {
    throw new InternalError();
  }
  return updated;
}

export async function remove(id: string, caller: User): Promise<void> {
  const existing = await findEventById(id);
  if (existing === null) {
    throw new NotFoundError('That event could not be found.');
  }

  assertCanModify(existing, caller);

  await deleteEvent(id);
}
