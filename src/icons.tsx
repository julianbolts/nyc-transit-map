// Tiny inline icons keep icon libraries and React server rendering out of the bundle.
const paths = {
  ship: '<path d="M12 10v4M12 2v3M5 10V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4M3 17l-1-5 10-4 10 4-1 5M2 21c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
  anchor:
    '<circle cx="12" cy="5" r="3"/><path d="M12 8v14M5 12H2a10 10 0 0 0 20 0h-3"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.6 6.4M3 3v8h8"/>',
  settings:
    '<path d="m9 3-.6 2.4-2.1 1.2L4 6l-2 3.5 1.7 1.8v2.4L2 15.5 4 19l2.3-.6 2.1 1.2L9 22h4l.6-2.4 2.1-1.2 2.3.6 2-3.5-1.7-1.8v-2.4L20 9.5 18 6l-2.3.6-2.1-1.2L13 3Z"/><circle cx="11" cy="12.5" r="3.5"/>',
};
export type IconName = keyof typeof paths;
export function iconMarkup(name: IconName) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export function Icon({ name, size = 23 }: { name: IconName; size?: number }) {
  return (
    <span
      className="inline-icon"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: iconMarkup(name) }}
    />
  );
}
