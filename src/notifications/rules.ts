import { CLOSED_STATUSES } from '../config/schemaGroups';
import type { LocalItem } from '../db/repositories/items';
import type { FieldValues } from '../graph/types';
import type { Schema } from '../schema/columnMapper';
import { daysBetween, isoToYmd, parseExpiry, type YMD } from '../schema/dates';
import { displayValue, fieldKey } from '../schema/values';
import type { ChangeEvent } from '../sync/types';

/** User-configurable alert rules (Settings > Notifications). */
export interface NotificationPrefs {
  enabled: boolean;
  /** Only alert about POs where I am the Account Manager. */
  onlyMine: boolean;
  newPo: boolean;
  statusChange: boolean;
  /** Only these new statuses trigger a status alert (empty = any status). */
  statusFilter: string[];
  remarksChange: boolean;
  assignedToMe: boolean;
  /** Alert when a product expires within this many days (0 = off). */
  expiryWithinDays: number;
  /** Alert when received but not dispatched for this many days (0 = off). */
  readyToShipDays: number;
  /** Alert about sync conflicts and failed uploads. */
  syncProblems: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  onlyMine: false,
  newPo: true,
  statusChange: true,
  statusFilter: [],
  remarksChange: false,
  assignedToMe: true,
  expiryWithinDays: 60,
  readyToShipDays: 7,
  syncProblems: true,
};

export interface Notice {
  /** Stable key used to avoid sending the same alert twice. */
  key: string;
  title: string;
  body: string;
  itemLocalId?: string;
}

export interface RuleContext {
  schema: Schema;
  timeZone: string;
  people: Record<string, string>;
  /** Person-column lookup ids that are me on this site. */
  myLookupIds: string[];
  myDisplayName: string | null;
}

function val(fields: FieldValues | null, schema: Schema, key: keyof Schema['bySemantic']): unknown {
  const def = schema.bySemantic[key];
  return def && fields ? fields[fieldKey(def)] : undefined;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function poLabel(fields: FieldValues, rc: RuleContext): string {
  const folder = str(val(fields, rc.schema, 'folder'));
  const customer = str(val(fields, rc.schema, 'customer'));
  const product = str(val(fields, rc.schema, 'product'));
  const head = folder ? `PO ${folder}` : 'PO';
  return [head, customer || product].filter(Boolean).join(' · ');
}

function isMine(fields: FieldValues | null, rc: RuleContext): boolean {
  const am = str(val(fields, rc.schema, 'accountManager'));
  return !!am && rc.myLookupIds.includes(am);
}

/** Alerts for changes that arrived from SharePoint during a sync. */
export function evaluateChanges(changes: ChangeEvent[], prefs: NotificationPrefs, rc: RuleContext): Notice[] {
  if (!prefs.enabled) return [];
  const out: Notice[] = [];
  for (const c of changes) {
    if (c.kind === 'deleted' || !c.after) continue;
    // Skip changes I made myself (e.g. from SharePoint in a browser).
    if (rc.myDisplayName && c.modifiedBy === rc.myDisplayName) continue;
    const label = poLabel(c.after, rc);
    const by = c.modifiedBy ? ` by ${c.modifiedBy}` : '';
    const mineNow = isMine(c.after, rc);

    const assignedNow = prefs.assignedToMe && mineNow && !isMine(c.before, rc);
    if (assignedNow) {
      out.push({ key: `assigned:${c.spId}:${str(val(c.after, rc.schema, 'accountManager'))}`, title: 'PO assigned to you', body: `${label}${by}`, itemLocalId: c.localId });
      continue;
    }
    if (prefs.onlyMine && !mineNow) continue;

    if (c.kind === 'created') {
      if (prefs.newPo) out.push({ key: `new:${c.spId}`, title: 'New PO', body: `${label}${by}`, itemLocalId: c.localId });
      continue;
    }

    const oldStatus = str(val(c.before, rc.schema, 'status'));
    const newStatus = str(val(c.after, rc.schema, 'status'));
    if (prefs.statusChange && oldStatus !== newStatus && newStatus) {
      if (prefs.statusFilter.length === 0 || prefs.statusFilter.includes(newStatus)) {
        out.push({
          key: `status:${c.spId}:${newStatus}:${c.after['Modified'] ?? ''}`,
          title: `Status: ${newStatus}`,
          body: `${label} changed from ${oldStatus || '(blank)'} to ${newStatus}${by}`,
          itemLocalId: c.localId,
        });
        continue;
      }
    }

    const oldRemarks = str(val(c.before, rc.schema, 'remarksOnStatus'));
    const newRemarks = str(val(c.after, rc.schema, 'remarksOnStatus'));
    if (prefs.remarksChange && oldRemarks !== newRemarks && newRemarks) {
      out.push({
        key: `remarks:${c.spId}:${newRemarks}:${c.after['Modified'] ?? ''}`,
        title: 'Remarks updated',
        body: `${label}: ${newRemarks}${by}`,
        itemLocalId: c.localId,
      });
    }
  }
  return out;
}

/** Date-based alerts over the whole cache (expiry, waiting to ship). Run once per sync/day. */
export function evaluateDaily(items: LocalItem[], prefs: NotificationPrefs, rc: RuleContext, today: YMD): Notice[] {
  if (!prefs.enabled) return [];
  const out: Notice[] = [];
  const statusDef = rc.schema.bySemantic.status;
  const expiryDef = rc.schema.bySemantic.expiry;
  const receivedDef = rc.schema.bySemantic.receivedDate;
  const dispatchDef = rc.schema.bySemantic.dispatchDate;

  for (const it of items) {
    const f = it.fields;
    if (prefs.onlyMine && !isMine(f, rc)) continue;
    const status = statusDef ? str(f[fieldKey(statusDef)]) : '';
    const closed = CLOSED_STATUSES.includes(status);
    const label = poLabel(f, rc);

    if (prefs.expiryWithinDays > 0 && expiryDef && !closed) {
      const raw = str(f[fieldKey(expiryDef)]);
      const exp = parseExpiry(raw);
      if (exp) {
        const days = daysBetween(today, exp);
        if (days >= 0 && days <= prefs.expiryWithinDays) {
          out.push({
            key: `expiry:${it.localId}:${exp}`,
            title: days === 0 ? 'Product expires today' : `Product expires in ${days} day${days === 1 ? '' : 's'}`,
            body: `${label} (expiry ${raw})`,
            itemLocalId: it.localId,
          });
        }
      }
    }

    if (prefs.readyToShipDays > 0 && receivedDef && dispatchDef && !closed) {
      const rec = f[fieldKey(receivedDef)];
      const disp = f[fieldKey(dispatchDef)];
      const recYmd = typeof rec === 'string' ? isoToYmd(rec, rc.timeZone) : null;
      if (recYmd && !disp) {
        const waiting = daysBetween(recYmd, today);
        if (waiting >= prefs.readyToShipDays) {
          out.push({
            key: `waiting:${it.localId}:${recYmd}:${prefs.readyToShipDays}`,
            title: `Waiting to ship for ${waiting} days`,
            body: `${label} was received on ${displayValue(f, receivedDef, rc)} and has not been dispatched.`,
            itemLocalId: it.localId,
          });
        }
      }
    }
  }
  return out;
}

export function evaluateSyncProblems(
  counts: { conflicts: number; failedChanges: number; failedUploads: number },
  prefs: NotificationPrefs,
  today: YMD,
): Notice[] {
  if (!prefs.enabled || !prefs.syncProblems) return [];
  const out: Notice[] = [];
  if (counts.conflicts > 0) {
    out.push({
      key: `conflicts:${today}:${counts.conflicts}`,
      title: 'Sync conflict needs your decision',
      body: `${counts.conflicts} PO change${counts.conflicts === 1 ? '' : 's'} conflict with SharePoint. Open Sync to resolve.`,
    });
  }
  const failed = counts.failedChanges + counts.failedUploads;
  if (failed > 0) {
    out.push({
      key: `failed:${today}:${failed}`,
      title: 'Some items could not sync',
      body: `${failed} item${failed === 1 ? '' : 's'} failed to sync. Open Sync to retry.`,
    });
  }
  return out;
}

/** Person lookup ids that match my email / UPN. */
export function myLookupIds(people: { lookupId: string; email: string | null }[], emails: string[]): string[] {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase());
  return people
    .filter((p) => {
      if (!p.email) return false;
      const e = p.email.toLowerCase();
      // UserName in the User Information List may look like "i:0#.f|membership|user@x.com".
      return wanted.some((w) => e === w || e.endsWith(`|${w}`));
    })
    .map((p) => p.lookupId);
}
