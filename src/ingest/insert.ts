import type { DB } from '../db/connection.js';
import type { Device } from './device.js';
import type { ValidatedEvent } from './payload.js';

/** A fully-resolved event row, ready to insert. */
export interface EventRow {
  site: string;
  ts: number;
  kind: 'pageview' | 'event';
  name: string | null;
  path: string | null;
  referrer: string | null;
  visitor: string;
  session: string;
  device: Device;
  props: string | null;
}

/** Build an {@link EventRow} from a validated payload plus derived fields. */
export function buildEventRow(
  e: ValidatedEvent,
  derived: { ts: number; visitor: string; session: string; device: Device },
): EventRow {
  return {
    site: e.site,
    ts: derived.ts,
    kind: e.kind,
    name: e.name,
    path: e.path,
    referrer: e.referrer,
    visitor: derived.visitor,
    session: derived.session,
    device: derived.device,
    props: e.props,
  };
}

/** Insert one event row. */
export function insertEvent(db: DB, row: EventRow): void {
  db.prepare(
    `INSERT INTO events (site, ts, kind, name, path, referrer, visitor, session, device, props)
     VALUES (@site, @ts, @kind, @name, @path, @referrer, @visitor, @session, @device, @props)`,
  ).run(row);
}
