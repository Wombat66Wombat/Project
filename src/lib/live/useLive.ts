import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Atlas } from '../useAtlas';
import { dbGet, dbSet } from '../db';
import type { LiveConnection, Presence } from './connection';
import { applyTextDiff, colorFor, newRoomId } from './text';
import { uniqueTitle } from '../links';

interface RoomRecord {
  roomId: string;
  noteId: string;
  /** Reconnect automatically when Atlas opens. */
  active: boolean;
}

export interface Person extends Presence {
  id: number;
}

export interface RoomState {
  roomId: string;
  status: 'connecting' | 'live';
  peers: number;
  people: Person[];
}

interface Open {
  noteId: string;
  doc: Y.Doc;
  text: Y.Text;
  conn: LiveConnection | null;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const ROOMS_KEY = 'live:rooms';
const NAME_KEY = 'live:name';
const docKey = (roomId: string) => `live:doc:${roomId}`;

export function inviteLink(roomId: string, title: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/live/${roomId}/${encodeURIComponent(title)}`;
}

/**
 * Live collaboration on notes. A live note is bound to a shared Yjs document that peers edit
 * together over WebRTC; the note itself stays an ordinary note (it saves, syncs and searches
 * as usual), and the shared document is kept on this device so a session can be rejoined.
 */
export function useLive(atlas: Atlas) {
  const [records, setRecords] = useState<RoomRecord[]>([]);
  const [rooms, setRooms] = useState<Record<string, RoomState>>({});
  const [name, setNameState] = useState('');
  const [loaded, setLoaded] = useState(false);
  const open = useRef(new Map<string, Open>());
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  const nameRef = useRef('');

  useEffect(() => {
    void (async () => {
      const recs = (await dbGet<RoomRecord[]>(ROOMS_KEY)) ?? [];
      let n = (await dbGet<string>(NAME_KEY)) ?? '';
      if (!n) {
        n = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
        await dbSet(NAME_KEY, n);
      }
      nameRef.current = n;
      setNameState(n);
      setRecords(Array.isArray(recs) ? recs : []);
      setLoaded(true);
    })();
  }, []);

  const saveRecords = useCallback((next: RoomRecord[]) => {
    setRecords(next);
    void dbSet(ROOMS_KEY, next);
  }, []);

  const refreshPeople = useCallback((roomId: string) => {
    const o = open.current.get(roomId);
    if (!o?.conn) return;
    const people: Person[] = [];
    o.conn.awareness.getStates().forEach((st, id) => {
      if (id !== o.doc.clientID && st && typeof (st as Presence).name === 'string') people.push({ id, ...(st as Presence) });
    });
    const peers = o.conn.peerCount();
    setRooms((r) => ({ ...r, [roomId]: { roomId, status: 'live', peers, people } }));
  }, []);

  /** Bind a room's shared document to its note and connect to peers. */
  const openRoom = useCallback(
    async (roomId: string, noteId: string, seed?: string) => {
      if (open.current.has(roomId)) return;
      // Yjs and the networking code load only when a note actually goes live.
      const [Y, { connect }] = await Promise.all([import('yjs'), import('./connection')]);
      if (open.current.has(roomId)) return;
      const doc = new Y.Doc();
      const saved = await dbGet<Uint8Array>(docKey(roomId));
      if (saved instanceof Uint8Array) Y.applyUpdate(doc, saved, 'storage');
      const text = doc.getText('body');
      if (seed !== undefined && text.length === 0 && seed) doc.transact(() => text.insert(0, seed), 'local');
      const o: Open = { noteId, doc, text, conn: null, saveTimer: null };
      open.current.set(roomId, o);
      setRooms((r) => ({ ...r, [roomId]: { roomId, status: 'connecting', peers: 0, people: [] } }));

      // Remote edits → the note.
      text.observe((e) => {
        if (e.transaction.origin === 'local') return;
        atlasRef.current.updateBody(noteId, text.toString());
      });
      // Keep the shared document on this device (to rejoin later without duplicating text).
      doc.on('update', () => {
        if (o.saveTimer) clearTimeout(o.saveTimer);
        o.saveTimer = setTimeout(() => void dbSet(docKey(roomId), Y.encodeStateAsUpdate(doc)), 800);
      });
      // A rejoin may hold edits made by others since: show them.
      const current = atlasRef.current.getState().notes.find((n) => n.id === noteId);
      if (current && text.length > 0 && current.body !== text.toString()) {
        if (seed === undefined) atlasRef.current.updateBody(noteId, text.toString());
      }

      const me: Presence = { name: nameRef.current, color: colorFor(nameRef.current + doc.clientID), where: 'here' };
      try {
        o.conn = await connect(roomId, doc, me, () => refreshPeople(roomId));
        o.conn.awareness.on('change', () => refreshPeople(roomId));
        setRooms((r) => ({ ...r, [roomId]: { roomId, status: 'live', peers: o.conn!.peerCount(), people: [] } }));
      } catch {
        open.current.delete(roomId);
        setRooms((r) => {
          const { [roomId]: _gone, ...rest } = r;
          return rest;
        });
      }
    },
    [refreshPeople],
  );

  const active = loaded && atlas.ready && !atlas.inactive;

  // Reconnect rooms that were live when Atlas was last open.
  useEffect(() => {
    if (!active) return;
    const ids = new Set(atlasRef.current.getState().notes.map((n) => n.id));
    for (const r of records) if (r.active && ids.has(r.noteId)) void openRoom(r.roomId, r.noteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Leave everything when this tab becomes inactive or closes.
  useEffect(() => {
    const leaveAll = () => {
      for (const o of open.current.values()) o.conn?.leave();
      open.current.clear();
    };
    if (atlas.inactive) leaveAll();
    window.addEventListener('pagehide', leaveAll);
    return () => window.removeEventListener('pagehide', leaveAll);
  }, [atlas.inactive]);

  const roomOf = useCallback((noteId: string) => records.find((r) => r.noteId === noteId), [records]);

  /** Start (or resume) a live session for a note. Returns the room id. */
  const start = useCallback(
    async (noteId: string) => {
      const existing = records.find((r) => r.noteId === noteId);
      const roomId = existing?.roomId ?? newRoomId();
      saveRecords([...records.filter((r) => r.noteId !== noteId), { roomId, noteId, active: true }]);
      const note = atlasRef.current.getState().notes.find((n) => n.id === noteId);
      await openRoom(roomId, noteId, existing ? undefined : note?.body ?? '');
      return roomId;
    },
    [records, saveRecords, openRoom],
  );

  /** Open an invite link: the note for that room, created empty if this device hasn't seen it. */
  const join = useCallback(
    async (roomId: string, title: string): Promise<string> => {
      const existing = records.find((r) => r.roomId === roomId && atlasRef.current.index.byId.has(r.noteId));
      let noteId = existing?.noteId;
      if (!noteId) {
        noteId = atlasRef.current.add(uniqueTitle(atlasRef.current.index.byTitle, title || 'Shared note'), '').id;
      }
      saveRecords([...records.filter((r) => r.roomId !== roomId), { roomId, noteId, active: true }]);
      await openRoom(roomId, noteId);
      return noteId;
    },
    [records, saveRecords, openRoom],
  );

  const leave = useCallback(
    (noteId: string) => {
      const rec = records.find((r) => r.noteId === noteId);
      if (!rec) return;
      const o = open.current.get(rec.roomId);
      o?.conn?.leave();
      open.current.delete(rec.roomId);
      setRooms((r) => {
        const { [rec.roomId]: _gone, ...rest } = r;
        return rest;
      });
      saveRecords(records.map((r) => (r.noteId === noteId ? { ...r, active: false } : r)));
    },
    [records, saveRecords],
  );

  /** Edit a note. For live notes the change goes into the shared document right away. */
  const edit = useCallback((noteId: string, body: string) => {
    for (const o of open.current.values()) {
      if (o.noteId !== noteId) continue;
      o.doc.transact(() => applyTextDiff(o.text, o.text.toString(), body), 'local');
    }
    atlasRef.current.updateBody(noteId, body);
  }, []);

  // Changes made to a live note some other way (renames rewriting links, sync…) still reach peers.
  useEffect(() => {
    for (const o of open.current.values()) {
      const n = atlas.index.byId.get(o.noteId);
      if (n && n.body !== o.text.toString()) o.doc.transact(() => applyTextDiff(o.text, o.text.toString(), n.body), 'local');
    }
  }, [atlas.index]);

  /** Tell others where you are in the note ("line 12", "map: Tokyo"). */
  const setWhere = useCallback((noteId: string, where: string, mapNode?: string) => {
    for (const o of open.current.values()) {
      if (o.noteId !== noteId || !o.conn) continue;
      const st = o.conn.awareness.getLocalState() as Presence | null;
      if (st && (st.where !== where || st.mapNode !== mapNode)) o.conn.awareness.setLocalState({ ...st, where, mapNode });
    }
  }, []);

  const setName = useCallback((n: string) => {
    const clean = n.trim().slice(0, 40) || nameRef.current;
    nameRef.current = clean;
    setNameState(clean);
    void dbSet(NAME_KEY, clean);
    for (const o of open.current.values()) {
      const st = o.conn?.awareness.getLocalState() as Presence | null;
      if (st) o.conn!.awareness.setLocalState({ ...st, name: clean });
    }
  }, []);

  const stateFor = useCallback(
    (noteId: string): RoomState | null => {
      const rec = records.find((r) => r.noteId === noteId);
      return rec ? rooms[rec.roomId] ?? null : null;
    },
    [records, rooms],
  );

  return { name, setName, start, join, leave, edit, setWhere, roomOf, stateFor };
}

export type Live = ReturnType<typeof useLive>;
