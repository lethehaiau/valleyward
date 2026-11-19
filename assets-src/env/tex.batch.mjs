// Environment textures: writes tex.jobs.json, the image-generation jobs ({ id, prompt, out, aspect }) for the tiles.
import fs from 'node:fs';
const base = (what, palette, grid = 32) => `A single square game texture tile for a retro first-person game: ${what}. ` +
  `Flat, seamless and tileable on all four edges, seen straight on (orthographic, no perspective, no horizon, no object outline, no border, no frame). ` +
  `Chunky PIXEL ART: about ${grid}×${grid} crisp square pixels across the whole image, every pixel a hard-edged block, no anti-aliasing, no blur, ` +
  `limited palette of 6–9 colours (${palette}), even flat lighting with no light gradient, no vignette, no shadow falling across the tile, no text. ` +
  `The texture fills the whole canvas edge to edge. The look in words (no reference image is attached): the low-res, nearest-filtered pixel textures ` +
  `on the stone walls, the road and the timber of a retro pixel-textured 3D first-person game set at a hilltop keep on a cold moonlit night; ` +
  `make ONLY the flat texture swatch, never a scene.`;
const D = 'assets-src/env/raw/';
// 2026-11-18: text-only, no reference image (the first version attached a key-art mockup of its time)
const REF = [];
const jobs = [
  { id: 'stone', prompt: base('the face of ONE large weathered cut stone block (no mortar joints, the block fills the tile): cool slate grey-blue granite with darker speckles, a few small chips and faint hairline cracks, a little grey-green lichen', 'slate #3a4652, #4a5560, #59646d, #2e3740, grey-green #4d5a4a, pale #6d7880'), out: D + 'stone.png' },
  { id: 'blocks', prompt: base('a castle wall of cube-cut stone blocks in staggered courses, 4 courses of blocks across the tile, each block a slightly different grey-blue tone, dark thin joints between blocks', 'slate #3a4652, #4a5560, #5b6670, #2a323a joints, #66717a highlights'), out: D + 'blocks.png' },
  { id: 'flag', prompt: base('worn stone paving flagstones of a castle wall walk seen from above, irregular rectangular slabs with dark joints, scuffed', 'grey-blue #3d4853, #4c5762, #5c6670, joints #262d34'), out: D + 'flag.png' },
  { id: 'timber', prompt: base('vertical rough oak planks of a fort gate, 4 planks across the tile with dark gaps, wood grain lines and a couple of knots', 'dark brown #3a2a21, #4b3626, #5e4430, #2a1d16 gaps, #6d513a highlights'), out: D + 'timber.png' },
  { id: 'earth', prompt: base('packed bare earth ground seen from above, small stones and darker clods', 'brown-grey #3b3a34, #47443c, #55503f, #2f2d28, #615a48'), out: D + 'earth.png' },
  { id: 'road', prompt: base('a trodden dirt road surface seen from above, compacted earth with many small pebbles and wheel-worn patches', 'earth #4a3f33, #574a3a, #3d342b, pebbles #6a6152, #2f2822'), out: D + 'road.png' },
  { id: 'grass', prompt: base('short dark night meadow grass seen from above, mixed tufts and a few dirt specks', 'teal-green #2b4a3a, #355743, #22392f, #41664c, dirt #3b3a34'), out: D + 'grass.png' },
  { id: 'roof', prompt: base('a roof of overlapping slate shingles in rows, seen straight on, 6 rows across the tile, each row overlapping the one below and offset by half a shingle from it (staggered like a real slate roof), the shingles with slightly rounded, uneven lower edges', 'blue-grey slate #2f3a44, #3b4752, #48545e, #232b33 shadows'), out: D + 'roof.png' },
  { id: 'iron', prompt: base('a dark riveted iron plate with a few rivets, scratches and rust spots', 'iron #2c2b2e, #3a393c, #4a4848, rust #5a3a2a, #1d1c1f'), out: D + 'iron.png' },
  { id: 'pine', prompt: base('dense dark pine needle foliage seen up close, layered needle clumps, the clumps in the lighter greens clearly readable against the darker gaps between them', 'dark pine green #1f3a33, #27473c, #30574a, #18302a, #3a6656'), out: D + 'pine.png' },
];
fs.writeFileSync(new URL('./tex.jobs.json', import.meta.url), JSON.stringify(jobs.map((j) => ({ ...j, aspect: '1:1', refs: REF })), null, 1));
console.log(jobs.length, 'jobs');
