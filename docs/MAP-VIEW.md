# Default map view

`BOUNDS` in [`src/TransitMap.tsx`](../src/TransitMap.tsx) defines the southwest and northeast corners:

```ts
const BOUNDS: [Point, Point] = [
  [-74.02412, 40.687087],
  [-73.923274, 40.768314],
];
```

Initial rendering and Reset view fit this same bounding box into the component's container. The box sets framing, not a limit on panning. Shrink both spans to zoom in; shift both corners equally to move the focus. Longitude comes first.

Padding is 55 pixels on containers at least 600 pixels wide. Smaller containers use top 66, bottom 50, left 28 and right 28. Initial fitting is immediate; Reset view animates for 700 milliseconds. A ResizeObserver updates renderer dimensions when the host container changes size without resetting a user's camera.

The optional Leaflet renderer fits the same box. Its adapter approximates asymmetric padding using left/top padding on both sides. Settings `allowPanning` and `allowZooming` enable interactions independently; both default to false.

The startup center `[-73.986, 40.733]` and zoom 11 are immediately replaced by the bounding-box fit. Static backdrops under `public/map/` are separate images; changing camera bounds does not regenerate them.
