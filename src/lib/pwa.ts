import { useCallback, useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** iPhone/iPad Safari can't show an install prompt; it needs Share → Add to Home Screen. */
export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let deferred: InstallPromptEvent | null = null;
let updateRequested = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own "Install" button instead of the browser's mini-bar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/**
 * Offline support and installation: registers the service worker (production builds only),
 * reports when a new version is waiting, and exposes the browser's install prompt.
 */
export function usePwa() {
  const [, force] = useState(0);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | null = null;
    const track = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener('updatefound', () => {
        const sw = r.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state !== 'installed') return;
          // A controller already exists → this is an update; otherwise it's the first install.
          if (navigator.serviceWorker.controller) setWaiting(sw);
          else setOfflineReady(true);
        });
      });
    };
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI), { scope: './' })
      .then((r) => {
        reg = r;
        track(r);
        if (r.active && !navigator.serviceWorker.controller) setOfflineReady(true);
      })
      .catch(() => {
        /* offline support is a bonus; the app works without it */
      });
    // Check for a new version when the app comes back into view, and hourly.
    const check = () => document.visibilityState === 'visible' && reg?.update().catch(() => {});
    document.addEventListener('visibilitychange', check);
    const t = setInterval(check, 3_600_000);
    // Reload only when the user asked for the update. (On the very first visit the worker also
    // takes control, and that must not reload the page under them.)
    let reloading = false;
    const onController = () => {
      if (reloading || !updateRequested) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      document.removeEventListener('visibilitychange', check);
      clearInterval(t);
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
    };
  }, []);

  /** Switch to the waiting version (the page reloads once it takes over). */
  const update = useCallback(() => {
    updateRequested = true;
    waiting?.postMessage('skip-waiting');
  }, [waiting]);

  const install = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === 'accepted';
  }, []);

  return {
    updateReady: !!waiting,
    update,
    offlineReady,
    dismissOfflineReady: () => setOfflineReady(false),
    canInstall: !!deferred,
    install,
    installed: isStandalone(),
    ios: isIOS(),
  };
}

export type Pwa = ReturnType<typeof usePwa>;
