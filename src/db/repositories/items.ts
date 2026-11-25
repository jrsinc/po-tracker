import type { FieldValues } from '../../graph/types';
import type { SqlDriver, SqlValue } from '../SqlDriver';

export interface LocalItem {
  localId: string;
  /** SharePoint item id; null until an offline-created item is uploaded. */
  spId: string | null;
  fields: FieldValues;
  etag: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
  createdAt: string | null;
  /** True while the item has queued local changes. */
  dirty: boolean;
}

interface Row {
  local_id: string;
  sp_id: string | null;
  fields_json: string;
  etag: string | null;
  modified_at: string | null;
  modified_by: string | null;
  created_at: string | null;
  dirty: number;
}

function fromRow(r: Row): LocalItem {
  return {
    localId: r.local_id,
    spId: r.sp_id,
    fields: JSON.parse(r.fields_json) as FieldValues,
    etag: r.etag,
    modifiedAt: r.modified_at,
    modifiedBy: r.modified_by,
    createdAt: r.created_at,
    dirty: r.dirty === 1,
  };
}

/** JSON path for a field key (keys may contain characters like "_x002f_"). */
export function jsonPath(key: string): string {
  return `$."${key.replace(/"/g, '\\"')}"`;
}

export interface ItemQuery {
  search?: string;
  /** Graph field key -> allowed values (OR within a key, AND across keys). */
  filters?: Record<string, string[]>;
  sort?: { key: string; direction: 'asc' | 'desc'; numeric?: boolean } | { special: 'modified' | 'dirty' };
  onlyDirty?: boolean;
  limit?: number;
}

export class ItemsRepo {
  constructor(private readonly db: SqlDriver) {}

  async get(localId: string): Promise<LocalItem | null> {
    const r = await this.db.get<Row>('SELECT * FROM items WHERE local_id = ?', [localId]);
    return r ? fromRow(r) : null;
  }

  async getBySpId(spId: string): Promise<LocalItem | null> {
    const r = await this.db.get<Row>('SELECT * FROM items WHERE sp_id = ?', [spId]);
    return r ? fromRow(r) : null;
  }

  async upsert(item: LocalItem, searchText: string): Promise<void> {
    await this.db.run(
      `INSERT INTO items (local_id, sp_id, fields_json, etag, modified_at, modified_by, created_at, dirty, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(local_id) DO UPDATE SET
         sp_id = excluded.sp_id, fields_json = excluded.fields_json, etag = excluded.etag,
         modified_at = excluded.modified_at, modified_by = excluded.modified_by,
         created_at = excluded.created_at, dirty = excluded.dirty, search_text = excluded.search_text`,
      [
        item.localId,
        item.spId,
        JSON.stringify(item.fields),
        item.etag,
        item.modifiedAt,
        item.modifiedBy,
        item.createdAt,
        item.dirty ? 1 : 0,
        searchText.toLowerCase(),
      ],
    );
  }

  async setDirty(localId: string, dirty: boolean): Promise<void> {
    await this.db.run('UPDATE items SET dirty = ? WHERE local_id = ?', [dirty ? 1 : 0, localId]);
  }

  async delete(localId: string): Promise<void> {
    await this.db.run('DELETE FROM items WHERE local_id = ?', [localId]);
  }

  /** Replaces a temporary local id with the SharePoint id. */
  async remapId(oldLocalId: string, newLocalId: string, spId: string): Promise<void> {
    await this.db.run('UPDATE items SET local_id = ?, sp_id = ? WHERE local_id = ?', [newLocalId, spId, oldLocalId]);
  }

  async allSpIds(): Promise<{ localId: string; spId: string; dirty: boolean }[]> {
    const rows = await this.db.all<{ local_id: string; sp_id: string; dirty: number }>(
      'SELECT local_id, sp_id, dirty FROM items WHERE sp_id IS NOT NULL',
    );
    return rows.map((r) => ({ localId: r.local_id, spId: r.sp_id, dirty: r.dirty === 1 }));
  }

  async all(): Promise<LocalItem[]> {
    return (await this.db.all<Row>('SELECT * FROM items')).map(fromRow);
  }

  async count(): Promise<number> {
    return (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items'))?.n ?? 0;
  }

  async query(q: ItemQuery): Promise<LocalItem[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (q.search?.trim()) {
      for (const term of q.search.trim().toLowerCase().split(/\s+/)) {
        where.push("search_text LIKE ? ESCAPE '\\'");
        params.push(`%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
      }
    }
    for (const [key, values] of Object.entries(q.filters ?? {})) {
      if (!values.length) continue;
      const hasBlank = values.includes('');
      const nonBlank = values.filter((v) => v !== '');
      const parts: string[] = [];
      if (nonBlank.length) {
        parts.push(`CAST(json_extract(fields_json, ?) AS TEXT) IN (${nonBlank.map(() => '?').join(',')})`);
        params.push(jsonPath(key), ...nonBlank);
      }
      if (hasBlank) {
        parts.push(`COALESCE(CAST(json_extract(fields_json, ?) AS TEXT), '') = ''`);
        params.push(jsonPath(key));
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    if (q.onlyDirty) where.push('dirty = 1');

    let order = 'modified_at DESC';
    if (q.sort && 'special' in q.sort) {
      order = q.sort.special === 'dirty' ? 'dirty DESC, modified_at DESC' : 'modified_at DESC';
    } else if (q.sort) {
      const dir = q.sort.direction === 'asc' ? 'ASC' : 'DESC';
      const expr = q.sort.numeric
        ? 'CAST(json_extract(fields_json, ?) AS REAL)'
        : 'LOWER(CAST(json_extract(fields_json, ?) AS TEXT))';
      // Empty values always last.
      order = `json_extract(fields_json, ?) IS NULL, ${expr} ${dir}, modified_at DESC`;
      params.push(jsonPath(q.sort.key), jsonPath(q.sort.key));
    }
    const sql =
      `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}` +
      (q.limit ? ` LIMIT ${Math.floor(q.limit)}` : '');
    return (await this.db.all<Row>(sql, params)).map(fromRow);
  }

  /** Distinct non-empty values of a field, for filter options. */
  async distinctValues(key: string): Promise<string[]> {
    const rows = await this.db.all<{ v: string }>(
      `SELECT DISTINCT CAST(json_extract(fields_json, ?) AS TEXT) AS v FROM items
       WHERE json_extract(fields_json, ?) IS NOT NULL ORDER BY v`,
      [jsonPath(key), jsonPath(key)],
    );
    return rows.map((r) => r.v).filter((v) => v !== '');
  }
}
