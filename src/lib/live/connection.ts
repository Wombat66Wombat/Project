import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

export interface Presence {
  name: string;
  color: string;
  /** Where they are, e.g. "editing line 12" or "map: Tokyo". */
  where: string;
  /** Mind-map node label they have selected, if any. */
  mapNode?: string;
}

export interface LiveConnection {
  doc: Y.Doc;
  awareness: Awareness;
  peerCount: () => number;
  leave: () => void;
}

const APP_ID = 'atlas-notes-live-v1';

/** Relays to use instead of Trystero's public Nostr relays (for self-hosting and tests). */
function relayOverride(): string[] | undefined {
  try {
    const raw = localStorage.getItem('atlas:liveRelays');
    const urls = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(urls) && urls.every((u) => typeof u === 'string') ? (urls as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Join a peer-to-peer room and keep `doc` in sync with everyone in it.
 * Peers find each other through public Nostr relays (Trystero); after that, all data goes
 * directly between browsers over encrypted WebRTC. The room id doubles as the password that
 * encrypts the connection handshake, so only people with the invite link can join.
 */
export async function connect(roomId: string, doc: Y.Doc, me: Presence, onPeers: (n: number) => void): Promise<LiveConnection> {
  const { joinRoom } = await import('trystero'); // loaded only when someone goes live
  const urls = relayOverride();
  const room = joinRoom({ appId: APP_ID, password: roomId, ...(urls ? { relayConfig: { urls } } : {}) }, roomId);
  const awareness = new Awareness(doc);
  awareness.setLocalState(me);

  const peerClients = new Map<string, Set<number>>();
  const safely = (f: () => void) => {
    try {
      f();
    } catch {
      /* ignore malformed data from a peer */
    }
  };
  const bytes = (d: unknown) => (d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBuffer));

  const sync = room.makeAction<Uint8Array>('sync', { onMessage: (data, { peerId }) => safely(() => Y.applyUpdate(doc, bytes(data), peerId)) });
  const update = room.makeAction<Uint8Array>('update', { onMessage: (data, { peerId }) => safely(() => Y.applyUpdate(doc, bytes(data), peerId)) });
  const aware = room.makeAction<Uint8Array>('aware', {
    onMessage: (data, { peerId }) =>
      safely(() => {
        const before = new Set(awareness.getStates().keys());
        applyAwarenessUpdate(awareness, bytes(data), peerId);
        const set = peerClients.get(peerId) ?? new Set();
        for (const id of awareness.getStates().keys()) if (!before.has(id) && id !== doc.clientID) set.add(id);
        peerClients.set(peerId, set);
      }),
  });

  const count = () => Object.keys(room.getPeers()).length;
  room.onPeerJoin = (peer) => {
    void sync.send(Y.encodeStateAsUpdate(doc), { target: peer });
    void aware.send(encodeAwarenessUpdate(awareness, [doc.clientID]), { target: peer });
    onPeers(count());
  };
  room.onPeerLeave = (peer) => {
    const ids = peerClients.get(peer);
    if (ids) removeAwarenessStates(awareness, [...ids], 'peer left');
    peerClients.delete(peer);
    onPeers(count());
  };

  const onDocUpdate = (u: Uint8Array, origin: unknown) => {
    if (typeof origin === 'string' && room.getPeers()[origin]) return; // came from a peer
    if (count()) void update.send(u);
  };
  doc.on('update', onDocUpdate);
  const onAwareUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== 'local' || !count()) return;
    void aware.send(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
  };
  awareness.on('update', onAwareUpdate);

  return {
    doc,
    awareness,
    peerCount: count,
    leave: () => {
      doc.off('update', onDocUpdate);
      awareness.off('update', onAwareUpdate);
      removeAwarenessStates(awareness, [doc.clientID], 'local');
      void room.leave();
    },
  };
}
