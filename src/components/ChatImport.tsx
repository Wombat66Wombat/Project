import type { Atlas } from '../lib/useAtlas';

interface Props {
  atlas: Atlas;
  uniqueTitle: (base: string) => string;
  onDone: (items: { id: string; title: string; detail: string }[]) => void;
  onError: (e: string) => void;
}

export function ChatImport(_props: Props) {
  return <p className="muted">Coming in stage 8.</p>;
}
