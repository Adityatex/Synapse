import * as Y from 'yjs';
import { contentKey } from './schema.js';

/**
 * Which files a raw Yjs update would change the text of (P2-08, focus locks).
 *
 * An update is opaque binary, but each inserted item names where it goes in one of two ways:
 * the first item in a type carries the type's name, and every later item points at its left
 * or right neighbour, which is already in the document (or earlier in the same update).
 * Following those pointers finds the owning `content:<fileId>` text without applying the
 * update or copying the document, so it costs the size of the update, not of the room.
 */
export interface TouchedFiles {
  /** Files whose text the update inserts into or deletes from. */
  fileIds: Set<string>;
  /** Some part could not be attributed (malformed, or it depends on content the room lacks). */
  unresolved: boolean;
}

const CONTENT_PREFIX = contentKey('');

type Struct = Y.Item | Y.GC | Y.Skip;
type DecodedUpdate = ReturnType<typeof Y.decodeUpdate>;
const isId = (value: unknown): value is Y.ID =>
  typeof value === 'object' && value !== null && typeof (value as Y.ID).client === 'number' && typeof (value as Y.ID).clock === 'number';

function rootKeyOfType(type: Y.AbstractType<unknown>): string | null {
  let current = type;
  while (current._item !== null) current = current._item.parent as Y.AbstractType<unknown>;
  try {
    return Y.findRootTypeKey(current);
  } catch {
    return null;
  }
}

export function touchedFileIds(doc: Y.Doc, update: Uint8Array): TouchedFiles {
  const result: TouchedFiles = { fileIds: new Set(), unresolved: false };

  let decoded: DecodedUpdate;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    result.unresolved = true;
    return result;
  }

  // Items carried by this update, per client in clock order, for pointers that stay inside it.
  const inUpdate = new Map<number, Y.Item[]>();
  for (const struct of decoded.structs) {
    if (!(struct instanceof Y.Item)) continue;
    const list = inUpdate.get(struct.id.client) ?? [];
    list.push(struct);
    inUpdate.set(struct.id.client, list);
  }
  const updateItemAt = (id: Y.ID): Y.Item | null =>
    inUpdate.get(id.client)?.find((item) => id.clock >= item.id.clock && id.clock < item.id.clock + item.length) ?? null;
  const docStructAt = (id: Y.ID): Struct | null => {
    try {
      return Y.getItem(doc.store, id) as Struct;
    } catch {
      return null; // the client or clock is not in the document
    }
  };

  const ownerKeys = new Map<Y.Item, string | null>();
  const keyOfUpdateItem = (item: Y.Item): string | null => {
    if (ownerKeys.has(item)) return ownerKeys.get(item) ?? null;
    ownerKeys.set(item, null); // pointers only go backwards in time; this guards a malformed loop
    const key = resolveOwner(item);
    ownerKeys.set(item, key);
    return key;
  };

  /** The root type that holds the thing the id points at. */
  const keyOfId = (id: Y.ID): string | null => {
    const local = updateItemAt(id);
    if (local) return keyOfUpdateItem(local);
    const struct = docStructAt(id);
    if (!(struct instanceof Y.Item)) return null;
    return rootKeyOfType(struct.parent as Y.AbstractType<unknown>);
  };

  /** The root type that holds the type created by the item at `id` (a nested map or array). */
  const keyOfTypeAt = (id: Y.ID): string | null => {
    const local = updateItemAt(id);
    if (local) return keyOfUpdateItem(local);
    const struct = docStructAt(id);
    if (!(struct instanceof Y.Item) || !(struct.content instanceof Y.ContentType)) return null;
    return rootKeyOfType(struct.content.type);
  };

  function resolveOwner(item: Y.Item): string | null {
    const parent = item.parent as unknown;
    if (typeof parent === 'string') return parent;
    if (isId(parent)) return keyOfTypeAt(parent);
    if (item.origin) return keyOfId(item.origin);
    if (item.rightOrigin) return keyOfId(item.rightOrigin);
    return null;
  }

  const note = (key: string | null) => {
    if (key === null) result.unresolved = true;
    else if (key.startsWith(CONTENT_PREFIX)) result.fileIds.add(key.slice(CONTENT_PREFIX.length));
  };

  for (const items of inUpdate.values()) {
    for (const item of items) note(keyOfUpdateItem(item));
  }

  // A delete range is by client and clock, so it can span items of several files.
  for (const [client, ranges] of decoded.ds.clients) {
    for (const range of ranges) {
      let clock = range.clock;
      const end = range.clock + range.len;
      while (clock < end) {
        const id = Y.createID(client, clock);
        const local = updateItemAt(id);
        if (local) {
          note(keyOfUpdateItem(local));
          clock = local.id.clock + local.length;
          continue;
        }
        const struct = docStructAt(id);
        if (!struct) {
          result.unresolved = true;
          break;
        }
        if (struct instanceof Y.Item) note(rootKeyOfType(struct.parent as Y.AbstractType<unknown>));
        clock = struct.id.clock + struct.length;
      }
    }
  }

  return result;
}
