// Enkla linjeikoner i samma stil som systemikoner (1.6 px linje, rundade ändar).
const PATHS = {
  home: "M3.5 10.5 12 4l8.5 6.5M5.5 9v10.5h4.5V14h4v5.5h4.5V9",
  tray: "M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20M4 13.5 6.5 5h11l2.5 8.5V19H4z",
  book: "M5 4.5h9.5a3 3 0 0 1 3 3v12h-9.5a3 3 0 0 1-3-3zM5 16.5a3 3 0 0 1 3-3h9.5M9 8.5h5",
  plus: "M12 5v14M5 12h14",
  percent: "M18 6 6 18M7.5 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm9 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  doc: "M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 12h5M9.5 15.5h5",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.5-3 2.8-5 5.5-5s5 2 5.5 5M16 11a2.5 2.5 0 1 0 0-5M17.5 14c1.8.5 2.8 2.3 3 5",
  tag: "M3.5 12.3V4.5h7.8l9 9-7.8 7.8zM8 8.5h.01",
  card: "M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3",
  chart: "M4 20h16M7 16.5V11M12 16.5V6M17 16.5v-8",
  scale: "M12 4v16M8 20h8M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z",
  list: "M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  building: "M5 20.5V4.5h9v16M14 9.5h5v11M3.5 20.5h17M8 8h3M8 11.5h3M8 15h3",
  grid: "M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z",
  wand: "M4 20 15 9M13 5.5V3M18.5 11H21M16.5 7.5l1.8-1.8M9 4l1 2M20 14l-2-1",
  sidebar: "M3.5 5h17v14h-17zM9.5 5v14",
  upload: "M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v4.5h15V15",
  check: "m5 12.5 4.5 4.5L19 7.5",
  calendar: "M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4M15.5 4v4M8 14h2M14 14h2M8 17h2",
  camera: "M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  paperclip: "m19 11.5-7.4 7.4a4.5 4.5 0 0 1-6.4-6.4l7.8-7.8a3 3 0 0 1 4.2 4.2l-7.4 7.4a1.5 1.5 0 0 1-2.1-2.1L14.5 7.5",
  x: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  palette: "M12 20.5a8.5 8.5 0 1 1 8.5-8.5c0 2.2-1.8 3-3.5 3h-2a1.8 1.8 0 0 0-1.3 3c.6.8.1 2.5-1.7 2.5zM7.5 12h.01M9.5 8h.01M14.5 8h.01",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
