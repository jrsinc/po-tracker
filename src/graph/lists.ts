import type { GraphHttp } from './http';
import { normalizeEtag } from './etag';
import type { ColumnDefinition, FieldValues, GraphListItem, GraphUser, Paged } from './types';

export interface SiteUser {
  lookupId: string;
  name: string;
  email: string | null;
}

/** Operations the sync engine needs from the list. Implemented by ListsApi; faked in tests. */
export interface ListClient {
  getColumns(): Promise<ColumnDefinition[]>;
  firstItemsUrl(pageSize?: number): string;
  deltaStartUrl(): string;
  deltaLatestUrl(): string;
  getPage(url: string): Promise<Paged<GraphListItem>>;
  getItem(id: string): Promise<GraphListItem>;
  createItem(fields: FieldValues): Promise<GraphListItem>;
  updateFields(id: string, fields: FieldValues, eTag: string | null): Promise<FieldValues>;
  deleteItem(id: string, eTag: string | null): Promise<void>;
  getSiteUsers(): Promise<SiteUser[]>;
}

/** Typed wrapper around the list endpoints. Holds the resolved site and list IDs. */
export class ListsApi implements ListClient {
  constructor(
    private readonly http: GraphHttp,
    private readonly siteId: string,
    private readonly listId: string,
  ) {}

  private get base() {
    return `/sites/${this.siteId}/lists/${this.listId}`;
  }

  async getColumns(): Promise<ColumnDefinition[]> {
    const out: ColumnDefinition[] = [];
    let next: string | undefined = `${this.base}/columns`;
    while (next) {
      const page: Paged<ColumnDefinition> = await this.http.request<Paged<ColumnDefinition>>(next);
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  /** First page of the full item load; follow @odata.nextLink with getPage(). */
  firstItemsUrl(pageSize = 500): string {
    return `${this.base}/items?expand=fields&$top=${pageSize}`;
  }

  /** Initial delta URL (enumerates everything, then returns a deltaLink). */
  deltaStartUrl(): string {
    return `${this.base}/items/delta?expand=fields`;
  }

  /** Delta URL that returns a deltaLink for "now" without enumerating items. */
  deltaLatestUrl(): string {
    // Query options are carried into the returned deltaLink, so ask for fields here too.
    return `${this.base}/items/delta?expand=fields&token=latest`;
  }

  getPage(url: string): Promise<Paged<GraphListItem>> {
    return this.http.request<Paged<GraphListItem>>(url, { retries: 4 });
  }

  getItem(id: string): Promise<GraphListItem> {
    return this.http.request<GraphListItem>(`${this.base}/items/${id}?expand=fields`);
  }

  createItem(fields: FieldValues): Promise<GraphListItem> {
    return this.http.request<GraphListItem>(`${this.base}/items`, {
      method: 'POST',
      body: { fields },
      retries: 0,
    });
  }

  /** PATCH with optimistic concurrency. Returns the updated field set (includes @odata.etag). */
  updateFields(id: string, fields: FieldValues, eTag: string | null): Promise<FieldValues> {
    return this.http.request<FieldValues>(`${this.base}/items/${id}/fields`, {
      method: 'PATCH',
      body: fields,
      headers: { 'If-Match': normalizeEtag(eTag) ?? '*' },
      retries: 0,
    });
  }

  async deleteItem(id: string, eTag: string | null): Promise<void> {
    await this.http.request<void>(`${this.base}/items/${id}`, {
      method: 'DELETE',
      headers: normalizeEtag(eTag) ? { 'If-Match': normalizeEtag(eTag)! } : {},
      retries: 0,
    });
  }

  /**
   * People who can appear in Person columns (the hidden "User Information List"), so Person
   * values (stored as lookup IDs) can be shown by name and written back.
   */
  async getSiteUsers(): Promise<SiteUser[]> {
    const out: SiteUser[] = [];
    let next: string | undefined =
      `/sites/${this.siteId}/lists/User Information List/items?expand=fields(select=Title,EMail,UserName)&$top=500`;
    while (next) {
      const page: Paged<GraphListItem> = await this.http.request<Paged<GraphListItem>>(next);
      for (const it of page.value) {
        const f = it.fields ?? {};
        const name = typeof f.Title === 'string' ? f.Title : '';
        const email =
          typeof f.EMail === 'string' ? f.EMail : typeof f.UserName === 'string' ? f.UserName : null;
        if (name) out.push({ lookupId: it.id, name, email });
      }
      next = page['@odata.nextLink'];
    }
    return out;
  }
}

export function getMe(http: GraphHttp): Promise<GraphUser> {
  return http.request<GraphUser>('/me?$select=id,displayName,mail,userPrincipalName');
}
