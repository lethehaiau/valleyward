# The WebGPU edition: how a lane gets its WebGPU twin

Decision 0001 (`docs/decisions/0001-fire-modules-and-two-editions.md`), stage 4.

The game has two shading layers:

- `src/gfx/webgl2/`: three.js `WebGLRenderer`, GLSL.
- `src/gfx/webgpu/`: three.js `WebGPURenderer`, TSL / WGSL.

Everything else is shared and written once.

A **lane** here is one of the game's loadable parts: `LANES` in `src/core/modules.js` (env, look, fire, actors, fx,
cinema, ui, audio). Each is loaded with a fallback, and the WebGPU edition can switch one off.

**Status (2026-11-18): every lane is ported**: env, look, actors, fx and the fire all run in the WebGPU edition. The
rule below stays for lanes added later.

**Where the WebGPU edition starts.** The WebGPU edition (`?gpu=webgpu`) boots with the greybox world, the UI, the audio,
the cinema and the CPU fire grid. A lane whose custom shaders have no WebGPU twin is off there:

- `LANES` in `src/gfx/webgpu/index.js`;
- the greybox stands in for it, as when a lane fails.

## The pattern

1. **Shared world code builds, the layer shades.**
   - **What stays in the lane** (`src/env`, `src/actors`, `src/fx`, …): geometry, placement, animation, and standard
     three.js materials. Standard materials render in both editions; WebGPURenderer converts them itself.
   - **What moves into the layers:** every custom shader becomes a factory, written once per layer under the same name.
     - `src/gfx/webgl2/materials/<lane>.js`: the GLSL `ShaderMaterial`, moved verbatim from the lane.
     - `src/gfx/webgpu/materials/<lane>.js`: a node material, `three/webgpu` + `three/tsl`.
   - **How the lane reaches them:** through `gfx()` (`src/gfx/current.js`, set by main.js before any lane loads), for
     example `gfx().materials.skyMaterial(opts)`.
2. **Same control surface.** A factory returns a material whose `.uniforms` maps every uniform name the lane touches to
   an object with `.value`.
   - In GLSL that is the `ShaderMaterial` uniform.
   - In TSL it is a `uniform(…)` or `texture(…)` node, which also has `.value`.
   - So lane code like `mat.uniforms.uTime.value = t` is shared unchanged.
   - Render state must match: `transparent`, `blending`, `depthWrite` / `depthTest`, `side`, `alphaTest`, fog,
     `toneMapped`.
3. **Patches** (`onBeforeCompile` on a standard material) become `patchX(material)` per layer.
   - webgl2: the `onBeforeCompile` as before.
   - webgpu: node properties on the same material (`colorNode`, `emissiveNode`, `positionNode`, …).
   - WebGPURenderer converts a built-in material by copying every enumerable property (`NodeLibrary.fromMaterial`, r186),
     so node properties set on the original material carry over.
4. **The fire light** (`patchFireLight`, `FIRELIGHT_GLSL`):
   - webgl2: `src/shared/firelight.js`.
   - webgpu: `src/gfx/webgpu/firelight.js`, which has a TSL `emberFireLight(worldPos, worldNormal)` and `ewGround(xz)`.
   - Both read the same `FIRELIGHT` values, synced once a frame.
5. **The look** (the render pipeline) is entirely per layer:
   - `src/gfx/webgl2/look.js`;
   - `src/gfx/webgpu/look.js` (RenderTargets + `QuadMesh` passes, or `RenderPipeline` nodes);
   - `src/look/index.js` only dispatches.

   Same API: `render`, `setFluidPass` (the fire host's pass), `setViewmodel`, `flash`, `setHurt`, `setDawn`,
   `setResolutionScale`, `setSize`, `warm`, `dispose`, `depthTexture`, `grade`.
6. **Done means:**
   - the lane's flag in `src/gfx/webgpu/index.js` `LANES` is true;
   - `npm test` passes;
   - `npm run e2e` passes, including stage 9 "editions";
   - side-by-side captures of both editions exist (the same view and seed), and someone opened them before the lane
     was called ported;
   - the WebGL2 edition's captures match its pre-port captures.

## Lane checklist

| Lane | Custom shaders (sites) | Status |
|---|---|---|
| fire light | `patchFireLight`, `FIRELIGHT_GLSL` (src/shared/firelight.js) | done: `src/gfx/webgpu/firelight.js` (TSL `emberFireLight`, `ewGround`, `patchFireLight` via `emissiveNode`) |
| look | bloom chain, god-ray mask and blur, output grade (`src/gfx/webgl2/look.js`) | done 2026-11-18: `src/gfx/webgpu/look.js`; a like-for-like bench matched within dither (mean diff ≤ 0.24/255) |
| actors | `spriteMaterial.js` (the horde: instanced billboards, frame table, fire tint, dissolve), `telegraph.js`, `bosslight.js` | done 2026-11-18: `actorSpriteMaterial`, `actorTelegraphMaterial`, `actorBossLightMaterial`, `actorSparkPoints`; same-seed bench A/B of every sprite class matches |
| env | `sky`, `terrain` (patch), `materials` (patch), `weather` ×2, `nature`, `props`, `village`, `camp`, `ending` ×4, `hints`, `beaconfx` ×3, `farhorde`, `index` | done 2026-11-18: 18 `env*` factories, the patches `envPatchLambert` / `envPatchTerrain` / `envPatchFx`, `envMapFromScene`, `envPoints` (sized points as pixel-sized instanced quads); the WebGL2 side builds 29/29 identical programs |
| fx | `pool.js`, `index.js` | done 2026-11-18: `fxPoolMaterial`, `fxWashMaterial` |
| fire | a `webgpu` reference fire module in Firewraith | done 2026-11-18: `classic-webgpu` (Firewraith), the webgpu edition's default and fallback; fireCompare corr 0.744 vs 0.75 in WebGL2 |
