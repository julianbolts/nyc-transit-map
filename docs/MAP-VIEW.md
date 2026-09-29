# Default map view

`BOUNDS` in [`src/TransitMap.tsx`](../src/TransitMap.tsx) defines the southwest and northeast corners:

```ts
const BOUNDS: [Point, Point] = [
  [-73.997873, 40.739919],
  [-73.954656, 40.772212],
];
```

Initial rendering and Reset view fit this same bounding box into the component's container. The box sets framing, not a limit on panning. Shrink both spans to zoom in; shift both corners equally to move the focus. Longitude comes first.

Padding is 55 pixels on containers at least 600 pixels wide. Smaller containers use top 66, bottom 50, left 28 and right 28. Initial fitting is immediate; Reset view animates for 700 milliseconds. A ResizeObserver updates renderer dimensions when the host container changes size without resetting a user's camera.

The optional Leaflet renderer fits the same box. Its adapter approximates asymmetric padding using left/top padding on both sides. Settings `allowPanning` and `allowZooming` enable interactions independently; both default to false.

The startup center `[-73.986, 40.733]` and zoom 11 are immediately replaced by the bounding-box fit. Static backdrops under `public/map/` are separate images; changing camera bounds does not regenerate them.


## Backdrop captures

The current desktop (1440 × 900) and mobile (390 × 844) WebP backdrops were captured from the styled basemap at these Midtown/Central Park bounds. Each uses the same container padding as the interactive map; neither includes vehicle markers or settings controls. Attribution is retained.

To refresh them after changing `BOUNDS`, run `npm run dev` and open `/backdrop.html`. The authoring page reads `BOUNDS` directly from `src/TransitMap.tsx` and uses the shared `src/basemap-style.ts` styling. Set the browser viewport to each size and reload so `fitBounds` recalculates for that viewport. Wait for `body[data-capture-ready="true"]` with no `data-capture-error`, capture the viewport, and encode the result as WebP at the same dimensions. Replace `public/map/backdrop-desktop.webp` and `public/map/backdrop-mobile.webp`, then update the backdrop URL revision in `TransitMap.tsx` to invalidate older browser caches.

The authoring page is available only in the development demo; the production demo build still includes only its main entry. `npm run build` copies both refreshed images into the library's exported assets.
