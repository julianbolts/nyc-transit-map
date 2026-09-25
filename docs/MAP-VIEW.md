# Default map view

The initial interactive view is chosen by **fitting a geographic bounding box** to the browser window. It is not a center coordinate plus a radius, and it is not a fixed zoom level. The same box is used by the **Reset view** button.

## Current settings

In [`app/transit-map.tsx`](../app/transit-map.tsx), `BOUNDS` contains the southwest and northeast corners:

```ts
const BOUNDS: [Point, Point] = [
  [-74.027, 40.652], // southwest: [longitude, latitude]
  [-73.944, 40.804], // northeast: [longitude, latitude]
];
```

The longitude span is 0.083° and the latitude span is 0.152°. These numbers describe the area the app asks the map to include, **not a hard crop or a limit on panning**. The map may show more area beyond the box to fill a screen with a different shape.

`fitBounds(BOUNDS, ...)` calculates the center and zoom that will keep the whole box visible within the available screen space. The result depends on viewport width and height. Its padding is in **screen pixels**:

| Viewport | Padding used for initial view and Reset view |
| --- | --- |
| Width below 600 px | Top 66, bottom 50, left 28, right 28 |
| Width 600 px or wider | 55 on every side |

More padding leaves less space for the box, so the map zooms out. Asymmetric padding can also shift the apparent center. The initial fit has `duration: 0`; Reset view uses `duration: 700` milliseconds for an animated move. The 600 px test uses `window.innerWidth` when the fit runs, not a continuously recalculated view on resize.

The map constructors also contain `center: [-73.986, 40.733]` and `zoom: 11`. These are temporary startup values. The following `fitBounds` call immediately replaces them for the default view. Editing those values alone will **not** change the settled default view. They appear in the MapLibre constructor and both fallback construction paths; keep them consistent if you edit them for startup behavior.

## How to change the default area and zoom

1. Edit `BOUNDS` near the top of `app/transit-map.tsx`. Every point is `[longitude, latitude]`, with the southwest corner first and northeast second. Longitude grows eastward; latitude grows northward. Use finite degree values, southwest longitude less than northeast longitude, and southwest latitude less than northeast latitude. For this Web Mercator map, keep latitude roughly between −85° and 85°.
2. To move the focus without changing the scale much, add the same longitude offset to **both** corners, and/or the same latitude offset to both corners. For example, add `0.01` to both longitudes to shift east.
3. To zoom **in**, make the box narrower and/or shorter around the desired area. To zoom **out**, expand it. `fitBounds` uses whichever box dimension needs more space, so changing only one dimension may have little effect if the other dimension still controls the fit. The exact resulting zoom also changes with screen size and padding.
4. If you want more or less room around the target area, adjust the `padding` in the initial `fitBounds` and the `reset` function. Keep those two fits aligned so Reset view returns to the same framing. There is a third `fitBounds(BOUNDS, {padding: 55, ...})` in the delayed fallback path; update that too if the fallback should match.
5. Run the app and inspect the result at desktop and mobile widths. Use **Reset view** after manually navigating to verify the reset framing.

For example, reducing the current box to `[[-74.010, 40.690], [-73.960, 40.780]]` asks the map to show a smaller area and will generally produce a higher zoom. The numbers are an example, not a recommended replacement.

Map zoom is a continuous level rather than a distance in miles or a geographic radius. One whole zoom level roughly doubles the map's linear scale; fractional levels are possible. The app does not set an explicit camera `minZoom` or `maxZoom`. In the Leaflet fallback, the tile layer has `minZoom: 3` and `maxZoom: 19`; those are tile settings, not the values that choose the initial view. Layer `minzoom`/`maxzoom` values in `public/map/style.json` control when particular map features appear, not the default camera zoom.

The **Allow zooming** setting only enables mouse wheel, double click, and touch zoom interaction. **Allow panning** controls drag interaction. Both start disabled; neither changes the initial `fitBounds` result. Reset view remains available.

## Other visible-area details

- The main renderer is MapLibre. If it cannot start or load, `lib/map-fallback.ts` uses Leaflet and fits the same `BOUNDS`. Its `fitBounds` adapter currently uses the left and top padding values as horizontal and vertical padding on both sides, respectively. It does not preserve different left/right or top/bottom values, so mobile fallback framing can differ slightly from MapLibre.
- `getBounds()` later checks whether moving vehicle markers are inside the **actual current viewport**. It does not define the default camera area.
- `public/map/backdrop-desktop.webp` and `public/map/backdrop-mobile.webp` are static images displayed while the interactive map loads or if it fails. Changing `BOUNDS` does not regenerate or reframe them. Update those assets separately if their appearance should match a new default view.
