import { Redis, type Configuration } from '@hocuspocus/extension-redis';
import { OutgoingMessage, isTransactionOrigin, type Document, type onChangePayload, type onConfigurePayload } from '@hocuspocus/server';
import * as Y from 'yjs';

/**
 * The Hocuspocus Redis extension, changed in one respect: what a replica publishes when a document changes.
 *
 * The stock extension publishes the document's state vector (a Yjs SyncStep1) on every change, and every
 * other replica answers with `encodeStateAsUpdate(doc, thatStateVector)`. Even when the asker is already up to
 * date, that reply carries the document's whole delete set, which the asker then decodes and applies. Its size
 * is the number of deleted ranges the room has accumulated, so the cost of one edit grows with the room's edit
 * history (docs/load-tests/2026-10-30-p2-13-profile.md: busy time of two replicas 35% -> 88% in ten minutes).
 *
 * Here a change publishes the change: the Yjs update that was just made, merged with the others made in the
 * same event loop turn. The peers apply it under the `redis` origin, so it is not published again. Cost per
 * edit is the size of the edit.
 *
 * Pub/sub may lose a message (a replica's subscriber reconnecting, a slow consumer), and an update that
 * depends on one that was lost cannot be integrated until it arrives. So a replica still asks, with the
 * stock SyncStep1, for what it might be missing: every `repairIntervalMs` for each document it has open (a
 * document is asked about at a different moment from its neighbours), and for all of them when its
 * subscriber reconnects. Loading a document still does the stock initial sync.
 *
 * Everything else the stock extension does (initial sync on load, awareness, stateless broadcasts, the store
 * lock) is inherited unchanged.
 */

export const DEFAULT_REPAIR_INTERVAL_MS = 30_000;

export interface UpdateRedisConfiguration extends Partial<Configuration> {
  /** How often an open document asks the other replicas for what it may have missed. 0 turns the periodic ask off. */
  repairIntervalMs?: number;
  /** Told about a publish that failed, which would otherwise only be a console line. */
  onError?: (error: unknown, context: string) => void;
}

interface PendingUpdates {
  document: Document;
  updates: Uint8Array[];
  cancel: () => void;
}

export class UpdateRedis extends Redis {
  private pendingUpdates = new Map<string, PendingUpdates>();
  private repairedAt = new Map<string, number>();
  private repairTimer?: NodeJS.Timeout;
  private readonly repairIntervalMs: number;
  private readonly reportError: (error: unknown, context: string) => void;

  constructor({ repairIntervalMs = DEFAULT_REPAIR_INTERVAL_MS, onError, ...configuration }: UpdateRedisConfiguration) {
    super(configuration);
    this.repairIntervalMs = repairIntervalMs;
    this.reportError = onError ?? ((error, context) => console.error(`Redis: ${context}`, error));

    // ioredis resubscribes by itself after a reconnect; what was published while it was gone is lost.
    let connectedBefore = false;
    this.sub.on('ready', () => {
      if (connectedBefore) this.repairAll();
      connectedBefore = true;
    });
  }

  async onConfigure(payload: onConfigurePayload) {
    await super.onConfigure(payload);
    if (this.repairIntervalMs > 0 && !this.repairTimer) {
      // Often enough that documents are asked about close to their due time, rarely enough to cost nothing.
      const tick = Math.max(250, Math.min(1_000, Math.floor(this.repairIntervalMs / 4)));
      this.repairTimer = setInterval(() => this.repairDue(), tick);
      this.repairTimer.unref();
    }
  }

  /** A change made here goes to the other replicas as itself, not as a request for them to answer. */
  public async onChange(data: onChangePayload): Promise<void> {
    if (isTransactionOrigin(data.transactionOrigin) && data.transactionOrigin.source === 'redis') return;

    const name = data.documentName;
    const existing = this.pendingUpdates.get(name);
    if (existing && existing.document === data.document) {
      existing.updates.push(data.update);
      return;
    }
    // The document was reloaded under the same name within a turn: what is buffered belongs to the old one, and
    // it is still a change the peers have not seen, so it goes out now instead of being dropped.
    if (existing) this.publishPending(name);

    const handle = setImmediate(() => this.publishPending(name));
    this.pendingUpdates.set(name, { document: data.document, updates: [data.update], cancel: () => clearImmediate(handle) });
  }

  private publishPending(name: string): Promise<void> {
    const pending = this.pendingUpdates.get(name);
    if (!pending) return Promise.resolve();
    pending.cancel();
    this.pendingUpdates.delete(name);

    const update = pending.updates.length === 1 ? pending.updates[0]! : Y.mergeUpdates(pending.updates);
    const message = new OutgoingMessage(name).createSyncMessage().writeUpdate(update);
    return this.publishTo(name, message.toUint8Array()).then(
      () => undefined,
      (error) => this.reportError(error, `publishing an update of "${name}"`),
    );
  }

  private publishTo(name: string, message: Uint8Array): Promise<unknown> {
    // The stock extension's channel and framing: `<prefix>:<document>`, the sender's identifier in front.
    return this.pub.publish(`${this.configuration.prefix}:${name}`, Buffer.concat([this.messagePrefix, Buffer.from(message)]));
  }

  /** Ask the other replicas for what this one lacks, for one document. */
  private repair(name: string, document: Document): void {
    const message = new OutgoingMessage(name).createSyncMessage().writeFirstSyncStepFor(document);
    this.publishTo(name, message.toUint8Array()).catch((error) => this.reportError(error, `asking for updates of "${name}"`));
    this.repairedAt.set(name, Date.now());
  }

  private repairAll(): void {
    for (const [name, document] of this.instance?.documents ?? []) this.repair(name, document);
  }

  private repairDue(): void {
    const documents = this.instance?.documents;
    if (!documents) return;
    const now = Date.now();
    for (const name of this.repairedAt.keys()) if (!documents.has(name)) this.repairedAt.delete(name);
    for (const [name, document] of documents) {
      const last = this.repairedAt.get(name);
      if (last === undefined) this.repairedAt.set(name, now); // first seen: due one interval from now
      else if (now - last >= this.repairIntervalMs) this.repair(name, document);
    }
  }

  async onDestroy() {
    if (this.repairTimer) clearInterval(this.repairTimer);
    this.repairTimer = undefined;
    // Unlike the stock extension's pending SyncStep1, this is the change itself, and nobody will ask for it later.
    await Promise.all(Array.from(this.pendingUpdates.keys(), (name) => this.publishPending(name)));
    await super.onDestroy();
  }
}
