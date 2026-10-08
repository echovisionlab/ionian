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

Ionian is currently validated against `three@0.186.1` and
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

Diagnostic console output is off by default. Pass `debug: true` when creating an
engine to enable Ionian diagnostics for that instance. Existing invalid request
events, fallbacks, and thrown errors are preserved. Mesh sequence setup failures
also emit `invalidRequest` so hosts can handle them while console output is off.
The host application controls its Three.js renderer diagnostics; Ionian does not
change the supplied renderer.

## Pointer Facing

Pointer-facing tilts the complete particle object toward normalized viewport
coordinates. It is opt-in and independent of particle repulsion and the host's
authored rotation. An outer transform supplies the tilt; `engine.getObject()`
continues to expose the inner mesh, so automatic rotation can run at the same time.

```ts
engine.setPointerFacing({
  enabled: true,
  strength: { x: 0.75, y: 1, z: 0.2 }, // 0..1, independently per rotation axis
  response: { x: 5, y: 8, z: 3 }, // response rate per second; higher follows faster
  maxAngle: { x: Math.PI / 6, y: Math.PI / 6, z: Math.PI / 18 }, // radians
});
engine.setPointerFacingPosition({ x: 0.6, y: 0.2 }); // normalized -1..1
engine.getObject().rotation.z += deltaSeconds * 0.2; // separate authored rotation
engine.renderFrame(deltaSeconds, elapsedSeconds);
engine.setPointerFacingPosition(null); // pointer leave: smoothly return to neutral
```

The same settings can be passed as `pointerFacing` to the constructor. Defaults
are disabled, strength 1, response 8, 20° pitch/yaw limits, and zero roll.
`strength` and `response` accept either one number for all axes or an `{ x, y, z }`
object. Strength and limits determine the target angle; response controls smoothing
independently on each rotation axis. Smoothing uses
frame time, so it behaves consistently across refresh rates. With a supplied
camera, tilt follows the camera's screen axes. `setPointerPosition()` retains its
existing particle-repulsion behavior and does not enable pointer-facing.

Input y controls pitch (rotation x), input x controls yaw (rotation y). Roll
(rotation z) uses input x by default, or an explicit normalized input z:
`engine.setPointerFacingPosition({ x: 0.6, y: 0.2, z: -0.4 })`. Set an axis's
strength or angle limit to zero to turn off its influence. Coordinates are
clamped to -1..1.

Run the Vite development server and open `/pointer-facing.html` for a local,
CMS-independent preview with separate rotation and pointer-facing controls,
including torus-knot, 404 and 500 sampling meshes.

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

The engine owns registered meshes and textures and releases their GPU resources
when they are replaced or when `dispose()` is called. Pending asset loads are
discarded and cleaned up if teardown happens before they finish. When mesh
sequence changes overlap at the same texture size, only the latest request can
install its atlas; the previous atlas stays active until the replacement is
ready.

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
