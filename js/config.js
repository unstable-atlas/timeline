// Site settings that are neither poster layout nor sizes (timeline/build/layout.yaml, its `site` section) nor
// colours (theme.json, from theme.yaml).

export const CONFIG = {
  poster: 'data/poster.json',
  theme: 'data/theme.json',
  fonts: 'fonts/',
  faces: 'faces/',

  // Thumbnail source: the only place the site decides where thumbnails come from. AVIF copies made by
  // site/build_site.py. A YouTube-hosted source would need that host to allow CORS for the PNG export.
  thumbUrl(ep) { return `thumbs/${ep.id}.avif`; },
  thumbConcurrency: 8,   // parallel downloads behind the loading screen

  // PNG export. Scales are relative to the poster's own pixel size. A choice is offered only if it fits the static
  // limits below and a probe canvas of that size actually works in this browser.
  exportScales: [0.25, 0.5, 1, 1.5, 2],
  // Measured (round 1, headless Chrome 155 on macOS): 65,535 px per side, 268,435,456 px area (16,384^2).
  // Safari is documented at 32,767 per side and 16,777,216 px area on iOS; the run-time probe finds the real one.
  exportMaxArea: 268435456,
  exportMaxSide: 32767,

  storageKey: 'uu-timeline:v1',
  bgMaxSide: 2560,        // an uploaded background is scaled down to this before it's stored
};
