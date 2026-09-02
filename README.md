# Ionian

Ionian is a Three.js particle morphing engine.

It samples one or more `THREE.Mesh` surfaces into GPU data textures, simulates
particle motion with `GPUComputationRenderer`, and renders the particles through
an instanced mesh. Applications own the surrounding scene, renderer, camera,
asset upload flow, scroll/loop behavior, and UI.

## Install

```sh
pnpm add @echovisionlab/ionian three three-stdlib mitt
```

`three`, `three-stdlib`, and `mitt` are peer dependencies.

Ionian is currently validated against `three@0.184.0` and
`three-stdlib@2.36.1` in package smoke tests. The peer range starts at the
`three@0.175.0` compatibility baseline and intentionally stops before the next
untested Three.js minor.

## Basic Usage

```ts
import { ParticlesEngine } from '@echovisionlab/ionian';

const engine = new ParticlesEngine({
  textureSize: 256,
  scene,
  renderer,
  camera,
  useIntersection: false,
  dracoDecoderPath: '/draco/',
});

engine.registerMesh('step-1', meshA);
engine.registerMesh('step-2', meshB);
engine.registerMatcap('warm', warmTexture);
engine.registerMatcap('cool', coolTexture);

await engine.setMeshSequence(['step-1', 'step-2']);
engine.setTextureSequence([
  { type: 'matcap', id: 'warm' },
  { type: 'matcap', id: 'cool' },
]);

engine.setOverallProgress(0.5);
engine.renderFrame(deltaSeconds, elapsedSeconds);
```

`setOverallProgress()` is the primary integration point for product code. Feed
it scroll progress, an automatic timeline, or a static value from the host app.

Use `renderFrame(deltaSeconds, elapsedSeconds)` when the host runtime already
provides frame timing, such as React Three Fiber. Use `render(elapsedTimeMs)`
for `requestAnimationFrame` timestamps.

## Texture Sequence

Texture sequences support registered matcaps and solid colors:

```ts
engine.setTextureSequence([
  { type: 'color', value: '#ffffff' },
  { type: 'color', value: '#ff7a00' },
  { type: 'matcap', id: 'metal' },
]);
```

Ionian linearly interpolates between adjacent texture sequence entries using the
same overall progress value that drives mesh morphing.

## Runtime Guidance

- Choose `textureSize` before constructing the engine when possible. Runtime
  resizing is supported, but it recreates GPU resources and regenerates mesh
  atlases.
- Use `128` or lower for mobile scenes and `256` for rich desktop scenes unless
  the host app has measured the target hardware.
- Prefer host-app asset loaders for uploads and validation. `fetchAndRegister*`
  is a convenience API, not an upload pipeline.
- Pass `dracoDecoderPath` when the host app self-hosts Draco decoders.
- Call `dispose()` when unmounting the scene.

## Development

```sh
pnpm install
pnpm test
pnpm run test:coverage
pnpm run build
pnpm run build:types
pnpm run pack:smoke
pnpm run validate
```

## Release

Merging a conventional `feat:` or `fix:` commit to `main` creates or updates a
Release Please pull request. Merging that release pull request creates the
matching GitHub release and publishes `@echovisionlab/ionian` to npm.

The npm package uses GitHub Actions Trusted Publishing on a GitHub-hosted
runner. The package must exist on npm before its trusted publisher can be
configured; bootstrap the initial public `0.1.0` package once, then configure
`echovisionlab/ionian` and `.github/workflows/release.yml` as the package's
publisher.
