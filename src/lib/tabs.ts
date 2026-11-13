/**
 * Only one Atlas tab per browser edits at a time. Each tab keeps all notes in memory and
 * saves them as a whole, so two active tabs would silently overwrite each other's edits.
 *
 * The newest tab takes over: the active tab holds a Web Lock; a new tab that finds the lock
 * taken asks the holder (over a BroadcastChannel) to save and step aside, then waits for the
 * lock before reading storage, so it always loads the latest notes. With only one tab open
 * there is no waiting at all.
 */
type Msg = { type: 'claim'; from: string } | { type: 'released'; to: string };

const LOCK = 'atlas-active-tab';
const tabId = Math.random().toString(36).slice(2);

let channel: BroadcastChannel | null = null;
let onLost: (() => Promise<void>) | null = null;
let releaseLock: (() => void) | null = null;
let claiming: Promise<void> | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel('atlas-tabs');
  channel.addEventListener('message', (e: MessageEvent<Msg>) => {
    const msg = e.data;
    if (msg?.type === 'claim' && msg.from !== tabId && onLost) {
      const lost = onLost;
      onLost = null; // this tab is now read-only
      void lost().finally(() => {
        releaseLock?.();
        releaseLock = null;
        channel?.postMessage({ type: 'released', to: msg.from } satisfies Msg);
      });
    }
  });
  return channel;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Hold the lock until released. Resolves true once held, false if `ifAvailable` and it's taken. */
function holdLock(ifAvailable: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK, { ifAvailable }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => (releaseLock = release));
      })
      .catch(() => resolve(false));
  });
}

function waitForReleased(ms: number): Promise<void> {
  const ch = getChannel();
  if (!ch) return sleep(0);
  return new Promise((resolve) => {
    const done = () => {
      ch.removeEventListener('message', onMsg);
      clearTimeout(timer);
      resolve();
    };
    const onMsg = (e: MessageEvent<Msg>) => e.data?.type === 'released' && e.data.to === tabId && done();
    const timer = setTimeout(done, ms);
    ch.addEventListener('message', onMsg);
    ch.postMessage({ type: 'claim', from: tabId } satisfies Msg);
  });
}

/**
 * Become the active tab; resolves when it's safe to load notes.
 * `lost` runs if a newer tab takes over later: it should save, then make this tab read-only.
 * Safe to call more than once (React StrictMode); later calls just update `lost`.
 */
export function claimTab(lost: () => Promise<void>, waitMs = 1500): Promise<void> {
  onLost = lost;
  getChannel();
  if (claiming) return claiming;
  claiming = (async () => {
    const hasLocks = typeof navigator !== 'undefined' && !!navigator.locks?.request;
    if (!hasLocks) {
      // Older browsers: just ask any other tab to step aside, briefly.
      await waitForReleased(Math.min(waitMs, 250));
      return;
    }
    if (await holdLock(true)) return; // no other tab: no waiting
    const asked = waitForReleased(waitMs);
    // Wait for the lock, but never forever (e.g. a frozen background tab).
    await Promise.race([asked.then(() => holdLock(false)), sleep(waitMs + 500)]);
  })();
  return claiming;
}
