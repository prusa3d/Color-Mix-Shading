# Color Mix Shading

Client-side STL/OBJ color-material preview and 3MF export tool.

## Static Deployment

This app is a Vite React single-page app. Build it with:

```bash
npm run build
```

The production output is written to `dist/`. The Vite config uses `base: './'` so generated asset URLs are relative and work on static hosts, including deployments served from a subpath.

### Vercel

- Framework preset: `Vite`
- Build command: `npm run build`
- Output directory: `dist`

### Netlify

- Build command: `npm run build`
- Publish directory: `dist`

### Cloudflare Pages

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`

## Production Runtime

The deployed app does not need a Node.js runtime. Node is only required during install/build. Mesh parsing, preview rendering, material assignment, and 3MF packaging all run in the browser.
