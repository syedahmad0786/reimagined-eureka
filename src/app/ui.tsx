import { useEffect, useState } from 'preact/hooks';

const PATHS = {
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 17a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z',
  corner: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  photos: 'M3 7h14v14H3zM7 3h14v14M3 17l4-4 4 4 2-2 4 4',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  book: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  play: 'M7 4.5l12 7.5-12 7.5z',
  pause: 'M8 5v14M16 5v14',
  replay: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
  restart: 'M6 5v14M19 5l-10 7 10 7z',
  undo: 'M9 6L4 11l5 5M4 11h10a5 5 0 0 1 0 10h-3',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.6a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3 1-1.3 2M12 17v.1',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  view: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  speed: 'M4 18a8 8 0 1 1 16 0M12 18l4-7',
  step: 'M6 5l10 7-10 7zM19 5v14',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** True when the person has asked their device for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const change = (): void => setReduced(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Four stickers that light up in turn: the app is working. */
export function Pulse() {
  return (
    <span class="pulse" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0');
}
