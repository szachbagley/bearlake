import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../src/db/pool.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { testApp } from './helpers/app.js';
import { adminSession, bearer, memberSession, type Session } from './helpers/auth.js';
import { resetTables } from './helpers/db.js';

beforeEach(async () => {
  await resetTables();
  resetRateLimits();
});

afterAll(async () => {
  await closePool();
});

const app = () => request(testApp());

interface TimedFields {
  title?: string;
  notes?: string | null;
  startsAt: string;
  endsAt: string;
}

async function createTimed(session: Session, fields: TimedFields) {
  return app()
    .post('/api/v1/events')
    .set('Authorization', bearer(session))
    .send({ isAllDay: false, title: fields.title ?? 'Timed', notes: fields.notes, ...fields });
}

async function createAllDay(
  session: Session,
  fields: { title?: string; startsAt: string; endsAt: string },
) {
  return app()
    .post('/api/v1/events')
    .set('Authorization', bearer(session))
    .send({ isAllDay: true, title: fields.title ?? 'All day', ...fields });
}

/** A Denver-local month window as a client would send it (July 2026, MDT). */
const JULY = { start: '2026-07-01T06:00:00.000Z', end: '2026-08-01T06:00:00.000Z' };

async function eventsInRange(session: Session, start: string, end: string) {
  return app()
    .get('/api/v1/events')
    .query({ start, end })
    .set('Authorization', bearer(session));
}

describe('POST /events', () => {
  it('creates a timed event owned by the caller', async () => {
    const member = await memberSession({ displayName: 'Rachel' });

    const res = await createTimed(member, {
      title: 'Sauna delivery',
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Sauna delivery',
      isAllDay: false,
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
      createdBy: member.user.id,
      creatorDisplayName: 'Rachel',
    });
  });

  it('stores an all-day event as date-only, with the end day inclusive', async () => {
    const member = await memberSession();

    const res = await createAllDay(member, {
      title: 'Zach and Rachel at the big cabin',
      startsAt: '2026-07-16',
      endsAt: '2026-07-20',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      isAllDay: true,
      startsAt: '2026-07-16',
      endsAt: '2026-07-20',
    });
  });

  it('accepts an offset-bearing instant and normalizes it to UTC', async () => {
    const member = await memberSession();

    const res = await createTimed(member, {
      startsAt: '2026-07-16T10:00:00.000-06:00',
      endsAt: '2026-07-16T12:00:00.000-06:00',
    });

    expect(res.body.startsAt).toBe('2026-07-16T16:00:00.000Z');
  });

  it('rejects invalid bodies', async () => {
    const member = await memberSession();
    const bodies = [
      { isAllDay: false, title: '', startsAt: '2026-07-16T16:00:00Z', endsAt: '2026-07-16T18:00:00Z' },
      { isAllDay: false, title: 'x', startsAt: '2026-07-16T18:00:00Z', endsAt: '2026-07-16T16:00:00Z' },
      { isAllDay: false, title: 'x', startsAt: '2026-07-16T16:00:00Z', endsAt: '2026-07-16T16:00:00Z' },
      { isAllDay: true, title: 'x', startsAt: '2026-07-20', endsAt: '2026-07-16' },
      { isAllDay: true, title: 'x', startsAt: '2026-02-30', endsAt: '2026-03-01' },
      // Mixed shapes: all-day flag with a time-bearing value.
      { isAllDay: true, title: 'x', startsAt: '2026-07-16T00:00:00Z', endsAt: '2026-07-20T00:00:00Z' },
      { isAllDay: false, title: 'x', startsAt: '2026-07-16', endsAt: '2026-07-20' },
      // Instant without an offset.
      { isAllDay: false, title: 'x', startsAt: '2026-07-16T16:00:00', endsAt: '2026-07-16T18:00:00' },
    ];

    for (const body of bodies) {
      const res = await app()
        .post('/api/v1/events')
        .set('Authorization', bearer(member))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const res = await app()
      .post('/api/v1/events')
      .send({ isAllDay: false, title: 'x', startsAt: '2026-07-16T16:00:00Z', endsAt: '2026-07-16T18:00:00Z' });
    expect(res.status).toBe(401);
  });
});

describe('GET /events range query', () => {
  it('requires both start and end', async () => {
    const member = await memberSession();

    expect((await app().get('/api/v1/events').set('Authorization', bearer(member))).status).toBe(400);
    expect(
      (await app().get('/api/v1/events').query({ start: JULY.start }).set('Authorization', bearer(member)))
        .status,
    ).toBe(400);
  });

  it('rejects start on or after end and an over-long window', async () => {
    const member = await memberSession();

    const backwards = await eventsInRange(member, JULY.end, JULY.start);
    expect(backwards.status).toBe(400);

    const tooLong = await eventsInRange(member, '2026-01-01T00:00:00Z', '2027-02-01T00:00:00Z');
    expect(tooLong.status).toBe(400);
  });

  it('applies half-open overlap to timed events, without boundary double-counting', async () => {
    const member = await memberSession();
    const window = { start: '2026-07-10T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z' };

    const before = await createTimed(member, {
      title: 'entirely before',
      startsAt: '2026-07-05T00:00:00.000Z',
      endsAt: '2026-07-06T00:00:00.000Z',
    });
    const startsBefore = await createTimed(member, {
      title: 'starts before, ends inside',
      startsAt: '2026-07-09T00:00:00.000Z',
      endsAt: '2026-07-11T00:00:00.000Z',
    });
    const endsAfter = await createTimed(member, {
      title: 'starts inside, ends after',
      startsAt: '2026-07-19T00:00:00.000Z',
      endsAt: '2026-07-21T00:00:00.000Z',
    });
    const spans = await createTimed(member, {
      title: 'spans the whole window',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-31T00:00:00.000Z',
    });
    const touchesStart = await createTimed(member, {
      title: 'ends exactly at window start',
      startsAt: '2026-07-08T00:00:00.000Z',
      endsAt: '2026-07-10T00:00:00.000Z',
    });
    const touchesEnd = await createTimed(member, {
      title: 'starts exactly at window end',
      startsAt: '2026-07-20T00:00:00.000Z',
      endsAt: '2026-07-22T00:00:00.000Z',
    });

    const res = await eventsInRange(member, window.start, window.end);
    expect(res.status).toBe(200);
    const ids = (res.body.events as { id: string }[]).map((e) => e.id);

    expect(ids).toContain(startsBefore.body.id);
    expect(ids).toContain(endsAfter.body.id);
    expect(ids).toContain(spans.body.id);
    expect(ids).not.toContain(before.body.id);
    // Half-open: an event ending exactly at start or starting exactly at end
    // does not overlap.
    expect(ids).not.toContain(touchesStart.body.id);
    expect(ids).not.toContain(touchesEnd.body.id);
  });

  it('returns results ordered by start time', async () => {
    const member = await memberSession();
    await createTimed(member, { title: 'second', startsAt: '2026-07-20T00:00:00.000Z', endsAt: '2026-07-20T01:00:00.000Z' });
    await createTimed(member, { title: 'first', startsAt: '2026-07-10T00:00:00.000Z', endsAt: '2026-07-10T01:00:00.000Z' });

    const res = await eventsInRange(member, JULY.start, JULY.end);
    const titles = (res.body.events as { title: string }[]).map((e) => e.title);
    expect(titles).toEqual(['first', 'second']);
  });
});

describe('GET /events all-day semantics', () => {
  it('includes an all-day event on the window’s inclusive last day', async () => {
    const member = await memberSession();
    // Stay Jul 16–20; window covers only Jul 20 (Denver).
    const stay = await createAllDay(member, { startsAt: '2026-07-16', endsAt: '2026-07-20' });

    const res = await eventsInRange(member, '2026-07-20T06:00:00.000Z', '2026-07-21T06:00:00.000Z');
    const ids = (res.body.events as { id: string }[]).map((e) => e.id);

    expect(ids).toContain(stay.body.id);
  });

  it('does not leak an all-day event into an adjacent-day window', async () => {
    const member = await memberSession();
    const jul20 = await createAllDay(member, { startsAt: '2026-07-20', endsAt: '2026-07-20' });

    const dayBefore = await eventsInRange(member, '2026-07-19T06:00:00.000Z', '2026-07-20T06:00:00.000Z');
    const dayAfter = await eventsInRange(member, '2026-07-21T06:00:00.000Z', '2026-07-22T06:00:00.000Z');

    expect((dayBefore.body.events as { id: string }[]).map((e) => e.id)).not.toContain(jul20.body.id);
    expect((dayAfter.body.events as { id: string }[]).map((e) => e.id)).not.toContain(jul20.body.id);
  });

  it('places an all-day event on the same day regardless of the viewer’s window offset', async () => {
    const member = await memberSession();
    const jul20 = await createAllDay(member, { startsAt: '2026-07-20', endsAt: '2026-07-20' });

    // Same Jul 20 window expressed from three different offsets: Denver, UTC,
    // and an eastern-Australia client. All must find the event.
    const windows: Array<[string, string]> = [
      ['2026-07-20T06:00:00.000Z', '2026-07-21T06:00:00.000Z'], // Denver day
      ['2026-07-20T00:00:00.000Z', '2026-07-21T00:00:00.000Z'], // UTC day
      ['2026-07-19T14:00:00.000Z', '2026-07-20T14:00:00.000Z'], // Sydney day
    ];

    for (const [start, end] of windows) {
      const res = await eventsInRange(member, start, end);
      const ids = (res.body.events as { id: string }[]).map((e) => e.id);
      expect(ids, `${start}..${end}`).toContain(jul20.body.id);
    }
  });

  it('keeps all-day events on the correct day across the spring-forward transition', async () => {
    const member = await memberSession();
    // 2026-03-08 is the spring-forward day in Denver.
    const onTransition = await createAllDay(member, { startsAt: '2026-03-08', endsAt: '2026-03-08' });

    const thatDay = await eventsInRange(member, '2026-03-08T07:00:00.000Z', '2026-03-09T06:00:00.000Z');
    const nextDay = await eventsInRange(member, '2026-03-09T06:00:00.000Z', '2026-03-10T06:00:00.000Z');

    expect((thatDay.body.events as { id: string }[]).map((e) => e.id)).toContain(onTransition.body.id);
    expect((nextDay.body.events as { id: string }[]).map((e) => e.id)).not.toContain(onTransition.body.id);
  });

  it('keeps all-day events on the correct day across the fall-back transition', async () => {
    const member = await memberSession();
    // 2026-11-01 is the fall-back day in Denver.
    const onTransition = await createAllDay(member, { startsAt: '2026-11-01', endsAt: '2026-11-01' });

    const thatDay = await eventsInRange(member, '2026-11-01T06:00:00.000Z', '2026-11-02T07:00:00.000Z');
    const dayBefore = await eventsInRange(member, '2026-10-31T06:00:00.000Z', '2026-11-01T06:00:00.000Z');

    expect((thatDay.body.events as { id: string }[]).map((e) => e.id)).toContain(onTransition.body.id);
    expect((dayBefore.body.events as { id: string }[]).map((e) => e.id)).not.toContain(onTransition.body.id);
  });
});

describe('GET /events with events crossing boundaries', () => {
  it('returns a timed event spanning midnight in both days’ windows', async () => {
    const member = await memberSession();
    // 23:00–01:00 Denver across Jul 20/21 (05:00–07:00 UTC on Jul 21).
    const overnight = await createTimed(member, {
      title: 'late night',
      startsAt: '2026-07-21T05:00:00.000Z',
      endsAt: '2026-07-21T07:00:00.000Z',
    });

    const jul20 = await eventsInRange(member, '2026-07-20T06:00:00.000Z', '2026-07-21T06:00:00.000Z');
    const jul21 = await eventsInRange(member, '2026-07-21T06:00:00.000Z', '2026-07-22T06:00:00.000Z');

    expect((jul20.body.events as { id: string }[]).map((e) => e.id)).toContain(overnight.body.id);
    expect((jul21.body.events as { id: string }[]).map((e) => e.id)).toContain(overnight.body.id);
  });

  it('returns a multi-day event that crosses a month boundary in both months', async () => {
    const member = await memberSession();
    const straddle = await createAllDay(member, { startsAt: '2026-07-30', endsAt: '2026-08-02' });

    const july = await eventsInRange(member, JULY.start, JULY.end);
    const august = await eventsInRange(member, '2026-08-01T06:00:00.000Z', '2026-09-01T06:00:00.000Z');

    expect((july.body.events as { id: string }[]).map((e) => e.id)).toContain(straddle.body.id);
    expect((august.body.events as { id: string }[]).map((e) => e.id)).toContain(straddle.body.id);
  });
});

describe('GET /events/:id', () => {
  it('returns an event by id, and 404 for an unknown one', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const found = await app()
      .get(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member));
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(created.body.id);

    const missing = await app()
      .get(`/api/v1/events/${randomUUID()}`)
      .set('Authorization', bearer(member));
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /events/:id', () => {
  it('lets the creator edit their own event', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      title: 'Old title',
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const res = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ title: 'New title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New title');
    // Untouched fields survive the partial update.
    expect(res.body.startsAt).toBe('2026-07-16T16:00:00.000Z');
  });

  it('clears notes when sent null', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      notes: 'bring firewood',
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const res = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ notes: null });

    expect(res.body.notes).toBeNull();
  });

  it('converts a timed event to all-day when given matching date shapes', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const res = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ isAllDay: true, startsAt: '2026-07-16', endsAt: '2026-07-18' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isAllDay: true, startsAt: '2026-07-16', endsAt: '2026-07-18' });
  });

  it('refuses to toggle isAllDay without the matching field shapes', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    // Flipping to all-day while the stored bounds are still instants must fail.
    const res = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ isAllDay: true });

    expect(res.status).toBe(400);
  });

  it('revalidates ordering against the merged event', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    // New end lands before the existing start.
    const res = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ endsAt: '2026-07-16T15:00:00.000Z' });

    expect(res.status).toBe(400);
  });

  it('rejects an empty patch and an unknown field', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const empty = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({});
    expect(empty.status).toBe(400);

    const unknown = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member))
      .send({ createdBy: randomUUID() });
    expect(unknown.status).toBe(400);
  });
});

describe('event ownership', () => {
  it('lets the admin edit and delete any event', async () => {
    const admin = await adminSession();
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const edit = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'Admin edited' });
    expect(edit.status).toBe(200);

    const del = await app()
      .delete(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(admin));
    expect(del.status).toBe(204);
  });

  it('forbids a member from editing or deleting another member’s event', async () => {
    const owner = await memberSession({ email: 'owner@example.com' });
    const other = await memberSession({ email: 'other@example.com' });
    const created = await createTimed(owner, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const edit = await app()
      .patch(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(other))
      .send({ title: 'hijack' });
    const del = await app()
      .delete(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(other));

    expect(edit.status).toBe(403);
    expect(del.status).toBe(403);
  });

  it('returns 404 before 403 for a nonexistent event', async () => {
    const member = await memberSession();

    // A member probing a random id cannot distinguish "not yours" from "gone".
    const edit = await app()
      .patch(`/api/v1/events/${randomUUID()}`)
      .set('Authorization', bearer(member))
      .send({ title: 'x' });
    expect(edit.status).toBe(404);
  });

  it('lets the creator delete their own event', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });

    const del = await app()
      .delete(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member));
    expect(del.status).toBe(204);

    const after = await app()
      .get(`/api/v1/events/${String(created.body.id)}`)
      .set('Authorization', bearer(member));
    expect(after.status).toBe(404);
  });

  it('requires authentication for every route', async () => {
    const member = await memberSession();
    const created = await createTimed(member, {
      startsAt: '2026-07-16T16:00:00.000Z',
      endsAt: '2026-07-16T18:00:00.000Z',
    });
    const id = String(created.body.id);

    expect((await app().get('/api/v1/events').query(JULY)).status).toBe(401);
    expect((await app().get(`/api/v1/events/${id}`)).status).toBe(401);
    expect((await app().patch(`/api/v1/events/${id}`).send({ title: 'x' })).status).toBe(401);
    expect((await app().delete(`/api/v1/events/${id}`)).status).toBe(401);
  });
});
