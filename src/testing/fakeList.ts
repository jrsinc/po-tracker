// Test-only in-memory fake of a SharePoint list behind Microsoft Graph.
import { GraphError, NetworkError } from '../graph/http';
import type { ListClient, SiteUser } from '../graph/lists';
import type { ColumnDefinition, FieldValues, GraphListItem, Paged } from '../graph/types';

interface ServerItem {
  id: string;
  fields: FieldValues;
  version: number;
  modified: string;
}

/** Columns modelled on the real "PO Tracking 2026 JRS INC" list (internal names differ from titles). */
export const SAMPLE_COLUMNS: ColumnDefinition[] = [
  { name: 'Title', displayName: 'Title', text: {} },
  { name: '_x0077_tp0', displayName: 'Line#', number: {} },
  { name: 'Service', displayName: 'Service', choice: { choices: ['Comparator', 'CTSM', 'Logistics'] } },
  { name: 'Status', displayName: 'Status', choice: { choices: ['Active', 'Completed', 'Cancelled', 'Ready to Ship', 'Stored'] } },
  { name: 'Customer', displayName: 'Customer Name', choice: { choices: ['Rigen Pharma', 'BM Clinical'] } },
  { name: 'CustomerPO', displayName: 'Customer PO', text: {} },
  { name: 'PaymentStatus', displayName: 'Payment Status', text: {} },
  { name: 'ProductName', displayName: 'Product Name', text: {} },
  { name: 'ProductSourceCountry', displayName: 'Product Source Country', choice: { choices: ['USA'] } },
  { name: 'ProductSourceCountry0', displayName: 'Product Source Country', choice: { choices: ['USA', 'UK'] } },
  { name: 'AccountManager', displayName: 'Account Manager', personOrGroup: {} },
  { name: 'ExpiryDate', displayName: 'Expiry Date', text: {} },
  { name: 'ReceivedDate', displayName: 'Received Date', dateTime: { format: 'dateOnly' } },
  { name: 'DispatchDate', displayName: 'Dispatch Date', dateTime: { format: 'dateOnly' } },
  { name: 'Carrier', displayName: 'Carrier', choice: { choices: ['FedEx', 'UPS'] } },
  { name: 'Carrierthrough', displayName: 'Carrier through', choice: { choices: ['FedEx', 'DHL'] } },
  { name: 'EPCISDataRequired', displayName: 'EPCIS Data Required', boolean: {} },
  { name: 'NewColumn', displayName: 'Brand New Column', text: {} },
  {
    name: 'Ready_x0020_To_x0020_Ship_x002d_',
    displayName: 'Ready To Ship- Days',
    readOnly: true,
    calculated: { formula: '=TODAY()-[Received Date]' },
  },
  { name: 'ID', displayName: 'ID', readOnly: true, number: {} },
  { name: 'Modified', displayName: 'Modified', readOnly: true, dateTime: { format: 'dateTime' } },
  { name: 'ContentType', displayName: 'Content Type', text: {} },
  { name: 'Attachments', displayName: 'Attachments', boolean: {} },
  { name: '_UIVersionString', displayName: 'Version', readOnly: true, text: {} },
  { name: 'HiddenThing', displayName: 'Hidden', hidden: true, text: {} },
];

type Failure = { op: 'create' | 'update' | 'delete' | 'getPage' | 'getItem'; error: Error };

export class FakeList implements ListClient {
  items = new Map<string, ServerItem>();
  private changes: { seq: number; id: string; deleted: boolean }[] = [];
  private seq = 0;
  private nextId = 1;
  private clock = Date.parse('2026-11-01T00:00:00Z');
  pageSize = 2;
  expiredTokens = new Set<string>();
  /** Simulates Graph rejecting ?token=latest. */
  supportsLatestToken = true;
  failures: Failure[] = [];
  calls: string[] = [];
  /**
   * Behave like real SharePoint: the listItem eTag in list/delta pages comes WITHOUT quotes,
   * and an If-Match that does not match exactly fails with 409 resourceModified.
   */
  sharePointMode = false;
  columns: ColumnDefinition[] = SAMPLE_COLUMNS;
  users: SiteUser[] = [{ lookupId: '7', name: 'Pat Shah', email: 'pat@example.com' }];

  // ----- server-side helpers (simulate other users) -----

  private touch(id: string, deleted = false) {
    this.changes.push({ seq: ++this.seq, id, deleted });
    this.clock += 60_000;
  }

  etagOf(id: string): string {
    const it = this.items.get(id);
    return `"guid-${id},${it?.version ?? 0}"`;
  }

  serverCreate(fields: FieldValues): string {
    const id = String(this.nextId++);
    this.touch(id);
    this.items.set(id, { id, fields: { ...fields }, version: 1, modified: new Date(this.clock).toISOString() });
    return id;
  }

  serverEdit(id: string, patch: FieldValues): void {
    const it = this.items.get(id);
    if (!it) throw new Error('no item');
    this.touch(id);
    it.fields = { ...it.fields, ...patch };
    it.version++;
    it.modified = new Date(this.clock).toISOString();
  }

  serverDelete(id: string): void {
    this.items.delete(id);
    this.touch(id, true);
  }

  failNext(op: Failure['op'], error: Error): void {
    this.failures.push({ op, error });
  }

  private maybeFail(op: Failure['op']) {
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [f] = this.failures.splice(i, 1);
      throw f!.error;
    }
  }

  private toGraph(it: ServerItem): GraphListItem {
    return {
      id: it.id,
      eTag: this.sharePointMode ? this.etagOf(it.id).replace(/"/g, '') : this.etagOf(it.id),
      lastModifiedDateTime: it.modified,
      createdDateTime: it.modified,
      lastModifiedBy: { user: { displayName: 'Server User' } },
      fields: { ...it.fields, '@odata.etag': this.etagOf(it.id), id: it.id },
    };
  }

  // ----- ListClient -----

  async getColumns() {
    return this.columns;
  }

  async getSiteUsers() {
    return this.users;
  }

  firstItemsUrl() {
    return 'items?skip=0';
  }

  deltaStartUrl() {
    return 'delta?start&skip=0';
  }

  deltaLatestUrl() {
    return 'delta?latest';
  }

  async getPage(url: string): Promise<Paged<GraphListItem>> {
    this.calls.push(`GET ${url}`);
    this.maybeFail('getPage');
    const skip = Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);

    if (url.startsWith('items')) {
      const all = [...this.items.values()].sort((a, b) => Number(a.id) - Number(b.id));
      const page = all.slice(skip, skip + this.pageSize).map((it) => this.toGraph(it));
      const next = skip + this.pageSize < all.length ? `items?skip=${skip + this.pageSize}` : undefined;
      return { value: page, '@odata.nextLink': next };
    }
    if (url === 'delta?latest') {
      if (!this.supportsLatestToken) throw new GraphError(400, 'invalidRequest', 'token=latest not supported');
      return { value: [], '@odata.deltaLink': `delta?token=${this.seq}` };
    }
    if (url.startsWith('delta?start')) {
      const all = [...this.items.values()].map((it) => this.toGraph(it));
      const page = all.slice(skip, skip + this.pageSize);
      if (skip + this.pageSize < all.length) return { value: page, '@odata.nextLink': `delta?start&skip=${skip + this.pageSize}` };
      return { value: page, '@odata.deltaLink': `delta?token=${this.seq}` };
    }
    const token = /token=(\d+)/.exec(url)?.[1];
    if (token !== undefined) {
      if (this.expiredTokens.has(token)) throw new GraphError(410, 'resyncRequired', 'Resync required');
      const since = Number(token);
      const latest = new Map<string, boolean>();
      for (const c of this.changes) if (c.seq > since) latest.set(c.id, c.deleted);
      const value: GraphListItem[] = [...latest.entries()].map(([id, deleted]) => {
        const it = this.items.get(id);
        return deleted || !it ? { id, deleted: { state: 'deleted' } } : this.toGraph(it);
      });
      const pageOffset = Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);
      const page = value.slice(pageOffset, pageOffset + this.pageSize);
      if (pageOffset + this.pageSize < value.length) {
        return { value: page, '@odata.nextLink': `delta?token=${token}&skip=${pageOffset + this.pageSize}` };
      }
      return { value: page, '@odata.deltaLink': `delta?token=${this.seq}` };
    }
    throw new Error(`Unexpected URL ${url}`);
  }

  async getItem(id: string) {
    this.calls.push(`GET item ${id}`);
    this.maybeFail('getItem');
    const it = this.items.get(id);
    if (!it) throw new GraphError(404, 'itemNotFound', 'Item not found');
    return this.toGraph(it);
  }

  async createItem(fields: FieldValues) {
    this.calls.push(`POST ${JSON.stringify(fields)}`);
    this.maybeFail('create');
    const id = this.serverCreate(fields);
    return this.toGraph(this.items.get(id)!);
  }

  async updateFields(id: string, fields: FieldValues, eTag: string | null) {
    this.calls.push(`PATCH ${id} ${eTag} ${JSON.stringify(fields)}`);
    this.maybeFail('update');
    const it = this.items.get(id);
    if (!it) throw new GraphError(404, 'itemNotFound', 'Item not found');
    if (eTag && eTag !== '*' && eTag !== this.etagOf(id)) {
      throw this.sharePointMode
        ? new GraphError(409, 'resourceModified', 'The resource has changed since the caller last read it; usually an eTag mismatch.')
        : new GraphError(412, 'preconditionFailed', 'eTag mismatch');
    }
    this.serverEdit(id, fields);
    return { ...it.fields, '@odata.etag': this.etagOf(id) };
  }

  async deleteItem(id: string, eTag: string | null) {
    this.calls.push(`DELETE ${id} ${eTag}`);
    this.maybeFail('delete');
    if (!this.items.has(id)) throw new GraphError(404, 'itemNotFound', 'Item not found');
    if (eTag && eTag !== '*' && eTag !== this.etagOf(id)) {
      throw this.sharePointMode
        ? new GraphError(409, 'resourceModified', 'The resource has changed since the caller last read it; usually an eTag mismatch.')
        : new GraphError(412, 'preconditionFailed', 'eTag mismatch');
    }
    this.serverDelete(id);
  }
}

export const offline = () => new NetworkError('Network request failed');
