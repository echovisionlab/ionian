# Ionian lifecycle regression evidence

This note records the focused resource and sequence checks for the Ionian lifecycle fixes. It is not a GPU-memory or performance benchmark.

## Before and after

| Boundary                                                                | Before                                                                                                                                 | After                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Texture load completing after `AssetService.dispose()`                  | `late` appeared in `getTextureIDs()` and its dispose count was `0`.                                                                    | `loadTextureAsync()` resolves to `null`, no ID is registered, and the late texture dispose count is `1`.                     |
| Overlapping sequence builds, old sequence has 2 meshes and latest has 1 | Two atlases were installed in order `atlas-new`, then `atlas-old-a-old-b`; the final atlas was stale while its reported count was `1`. | Only the latest atlas is installed; the manager retains it after the stale build completes and disposes it once at teardown. |

The before values are from the pre-change source-method repro in `/Volumes/dev/dsub/code-quality-lifecycle-repro-20261001.json`. The after values are asserted against the actual `AssetService`, `DataTextureService`, and `ParticlesEngine` methods. Loader and sampling promises are deferred in tests to control completion order; resource disposal still uses real Three.js resource objects.

## Resource counts and edge checks

- A GLTF that resolves after teardown contains five unique resources across shared mesh references: two geometries, two materials, and one material texture. Each resource emits exactly one dispose event and no mesh is registered.
- A successful load preserves the full imported hierarchy, including a sibling bone tree referenced by a `SkinnedMesh` skeleton. Shared resources already owned by registered assets stay live through selected-mesh and no-mesh GLTF cleanup, then dispose once with their owner.
- When a selected mesh shares its geometry, material, and texture with discarded scene content, the shared resources stay live. The discarded geometry/material pairs are disposed once, and the selected mesh plus its child resources are each disposed once when the service is later torn down.
- A sampling result that arrives after `setTextureSize()` is cancelled and disposed once. A stale sampling failure does not change the latest service state.
- Overlapping engine resizes install the size-3 atlas with a two-mesh count; the older size-2 request cannot overwrite it, and the original progress value (`0.35`) is restored by the newest resize.
- Teardown is idempotent for both services and the engine. Pending sequence work does not install an atlas after engine disposal.

## Verification

- `pnpm exec vitest run src/lib/services/assets/assetService.test.ts src/lib/services/dataTexture/dataTextureService.test.ts src/lib/particlesEngine.lifecycle.test.ts`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm run pack:smoke`

After the hierarchy, shared-live-resource, and clone-cleanup fixes, the final focused run passed 32 tests across 3 files; the full suite passed 49 tests across 10 files.
