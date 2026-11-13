import { describe, expect, it, vi } from 'vitest';

describe('one active tab', () => {
  it('makes the older tab save and step aside before the newer tab loads', async () => {
    const events: string[] = [];
    vi.resetModules();
    const older = await import('./tabs');
    await older.claimTab(async () => {
      events.push('older saved');
    }, 50);
    // A second call in the same tab (React StrictMode) must not wait for itself.
    const t0 = Date.now();
    await older.claimTab(async () => {
      events.push('older saved');
    });
    expect(Date.now() - t0).toBeLessThan(50);
    vi.resetModules();
    const newer = await import('./tabs'); // a separate module instance = a separate tab
    await newer.claimTab(async () => {}, 2000);
    events.push('newer loads');
    expect(events).toEqual(['older saved', 'newer loads']);
  });
});
