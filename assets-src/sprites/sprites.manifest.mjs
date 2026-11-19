// VALLEYWARD · ACTORS · the sprite and viewmodel-texture generation manifest (Codex GPT Image, $0).
// `node assets-src/sprites/sprites.manifest.mjs` writes jobs.json next to this file; any image generator can then
// run those job files ({ id, prompt, out, aspect, refs }) from the repo root.
// Raw sheets land in assets-src/sprites/raw/ (gitignored binaries); the pipeline (pipeline/build.mjs) turns them into
// public/assets/sprites/actors.png + actors.json. Each generation is recorded in its raw sidecar and in public/assets/sprites/provenance.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REL = 'assets-src/sprites/raw';
// 2026-11-18: the first-wave sheets (grunt, imp, spear, brute, trollA/B, items) and the Rainmother (rainA/B) are generated
// from TEXT-ONLY prompts with no reference images; STYLE_TEXT / STYLE_TEXT_BOSS describe the look in words. The later
// sheets (waves 2 to 4) and the viewmodel swatches were regenerated the same day: each attaches at most ONE of our own
// text-only sheets (grunt, items, trollA_fine, or the new cinder for cinderk) as its style reference, with the same look
// in words; vmtex attaches nothing. No job attaches a key-art mockup or any image made with outside references.
const LOOK = 'classic chunky retro pixel art for the ' +
  'enemy sprites of a modern retro first-person horde shooter set on a cold moonlit night: bold, instantly readable ' +
  'silhouettes with big heads and expressive faces; every material shaded with 2 to 3 flat tones (a lighter tone on the ' +
  'upper front, a mid tone, a dark shadow tone), lit softly from the upper front; small clusters of darker pixels as ' +
  'texture on skin, cloth and wood; thin dark interior lines for folds, muscles and planks; a muted, slightly ' +
  'desaturated palette (olive, ochre-grey, dull brown, slate, dull iron) in which only fire and glowing eyes are bright. ' +
  'Everything below is an original design.';
const LOOK_BOSS = 'detailed retro pixel art for a ' +
  'large BOSS sprite of a modern retro first-person horde shooter set on a cold moonlit night, like a big 16-bit-era ' +
  'boss: a bold, readable silhouette; every material shaded with 3 to 4 flat tones (a lighter tone on the upper front, ' +
  'mid tones, a dark shadow tone), lit softly from the upper front; many small pixel clusters for surface detail ' +
  '(cracks, rocky plates, foam, moss, bark); thin dark interior lines; a muted, slightly desaturated night palette in ' +
  'which only the glowing details are bright. Everything below is an original design.';
const LOOK_ITEMS = 'classic chunky retro pixel art for ' +
  'the pickups and props of a modern retro first-person horde shooter set on a cold moonlit night: bold, instantly ' +
  'readable shapes; every material shaded with 2 to 3 flat tones (a lighter tone on the upper front, a mid tone, a dark ' +
  'shadow tone) plus one small bright highlight; thin dark interior lines; muted colours except where an item must ' +
  'glow. Everything below is an original design.';
const TEXT_ONLY = 'TEXT-ONLY BRIEF (no reference images are attached): the look is ';
const STYLE_TEXT = TEXT_ONLY + LOOK;
const STYLE_TEXT_BOSS = TEXT_ONLY + LOOK_BOSS;
const STYLE_TEXT_ITEMS = TEXT_ONLY + LOOK_ITEMS;

// the demon (jobs_v4): our own fine Ash Troll sheet (text-only, 2026-11-18) is its one style reference
const REF_BOSS = ['assets-src/sprites/raw/trollA_fine.png'];
const REFS_LINE = 'ATTACHED REFERENCE: the ONE attached image is our own boss sprite sheet from this same game (the Ash ' +
  'Troll, drawn for it from a text-only brief): use it ONLY for the pixel-art sprite STYLE (the same art-pixel size, the ' +
  'same near-black outline, the same flat shading and the same muted night palette). Never copy the troll or any part ' +
  'of it: the character below is a new, original one. The look in words: ' + LOOK_BOSS;

const style = (artPx) => `STYLE: a 2D PIXEL-ART SPRITE SHEET for a video game. True low-resolution pixel art: each figure is about ${artPx} ` +
  'art pixels tall and every art pixel is a crisp square block of the same size, hard edges, NO anti-aliasing, NO ' +
  'gradients, NO soft airbrush shading, NO blur, NO noise texture; a limited muted palette (about 12 to 16 flat colours ' +
  'for the character); a clean 1 to 2 art-pixel near-black outline (#1a1418) around every figure. All figures face the ' +
  'viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, ' +
  'feet on a common baseline within each row.\n' +
  'BACKGROUND: one flat, perfectly uniform, solid pure magenta #FF00FF everywhere behind and between the figures. No ' +
  'ground, no floor line, no cast shadow, no text, no labels, no numbers, no frame borders, no grid lines.';

const goblinLayout = (attack5, attack6, walkWord = 'WALK CYCLE') => 'LAYOUT: exactly 11 figures of the SAME character, in 3 ' +
  'horizontal rows, read left to right:\n' +
  `Row 1 (top, 4 figures) ${walkWord}: (1) left foot forward; (2) feet passing, body slightly higher; (3) right foot ` +
  'forward; (4) feet passing, body slightly higher.\n' +
  `Row 2 (middle, 4 figures): (5) ATTACK windup: ${attack5}; (6) ATTACK strike: ${attack6}; (7) BURNING: the character ` +
  'is ON FIRE, orange-yellow pixel flames licking up from its head, shoulders and back, arms flailing up, mouth wide ' +
  'open screaming, its body lit orange; (8) BURNING: running in panic in a different flailing pose, flames on its back ' +
  'and head.\n' +
  'Row 3 (bottom, 3 figures) DEATH: (9) hit, recoiling backward, eyes squeezed shut; (10) knees buckling, falling, ' +
  'weapon dropping; (11) collapsed, lying flat on the ground as a low heap seen from the front.\n' +
  'Every figure stands alone with wide magenta gaps to every other figure; nothing touches or overlaps; each weapon ' +
  'stays inside its own figure\'s space.';

const jobs = [
  {
    id: 'grunt', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT, style(44),
      'THE CHARACTER, GRUNT GOBLIN: a small hunched goblin foot soldier with an oversized round head, two long pointy ' +
      'ears sticking out sideways, olive-green skin (#6f7a3a), small pale yellow eyes, a wide mouth with two little ' +
      'lower tusks, a ragged brown-grey sackcloth tunic with a rope belt and a torn hem, skinny bare legs and big bare ' +
      'feet, holding a crude knobbly wooden club studded with one iron nail in its right hand (on the left side of the ' +
      'picture, since it faces the viewer). Muted colours: olive, ' +
      'ochre-grey, dull brown.',
      goblinLayout('the club raised high over its head with both hands, mouth open', 'the club swung down in front, body leaning forward')].join('\n\n'),
  },
  {
    id: 'imp', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT, style(34),
      'THE CHARACTER, IMP: a small skinny fast imp, shorter than a goblin, brick-red skin (#a3352a), two short curved ' +
      'dark horns, small bat-like ears, a huge grin full of sharp teeth, glinting pale eyes, long thin arms with ' +
      'clawed hands, a scrap of dark loincloth, a thin tail with a pointed tip. No weapon: it attacks with its claws. ' +
      'Muted brick-red and dark brown colours.',
      goblinLayout('both clawed hands raised high, leaning back', 'lunging forward, claws slashing down', 'RUNNING CYCLE (leaning forward, scampering)')].join('\n\n'),
  },
  {
    id: 'spear', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT, style(46),
      'THE CHARACTER, SPEAR-CHUCKER GOBLIN: a lean olive-green goblin (#6f7a3a skin) with big pointy ears, a dark ' +
      'leather headband, a grey-brown hide vest and kilt, wrapped shins, and a BUNDLE OF FOUR crude wooden spears with ' +
      'iron leaf-shaped tips strapped across its back (the spear tips stick up above its head on one side), holding one ' +
      'spear upright in its right hand (on the left side of the picture, since it faces the viewer). Muted olive, ' +
      'grey-brown and dull iron colours.',
      goblinLayout('the spear drawn back over its shoulder, ready to throw, other arm pointing forward', 'throwing arm swung fully forward, hand open, the spear gone')].join('\n\n'),
  },
  {
    id: 'brute', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT, style(60),
      'THE CHARACTER, BRUTE GOBLIN: a big, heavy, fat goblin, twice as wide as a normal goblin, dull grey-green skin, a ' +
      'small head with stubby ears and an underbite with tusks, a dented iron pot helmet, carrying a whole battered ' +
      'WOODEN DOOR (vertical dark oak planks, two iron bands, an iron ring handle, splintered corners) in front of its ' +
      'body as a big shield, gripping the door\'s edges; its head shows above the door and its thick legs and feet ' +
      'below it. Muted grey-green, dark brown wood and dull iron colours.',
      goblinLayout('the door lifted up and pulled back to bash', 'the door rammed forward, body leaning in behind it')].join('\n\n'),
  },
  {
    id: 'trollA', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT_BOSS, style(150),
      'THE CHARACTER, THE ASH TROLL (a boss, very large): a huge hulking troll, heavy and stooped, long thick arms that ' +
      'reach its knees, a small head sunk between massive shoulders, a heavy brow and a jutting jaw with two blunt ' +
      'tusks. Its hide is grey-black ASH: cracked like burnt charcoal, with a network of thin darker seams and pale ' +
      'ash-grey highlights on the shoulders and knuckles, rough and stony. Its two small eyes glow ember orange (the ' +
      'ONLY warm colour on it). A ragged dark-brown loincloth. In its right hand it drags a FALLEN PINE TREE TRUNK as a ' +
      'club (rough grey-brown bark, broken branch stubs, torn roots at the end it grips). Colours: charcoal, ash grey, ' +
      'slate, dark brown; the eyes ember orange.',
      'LAYOUT: exactly 7 figures of the SAME troll in 2 horizontal rows, read left to right:\n' +
      'Row 1 (top, 4 figures) WALK CYCLE, heavy lumbering steps toward the viewer: (1) left foot forward; (2) feet ' +
      'passing, body higher; (3) right foot forward; (4) feet passing, body higher. The trunk in its right hand.\n' +
      'Row 2 (bottom, 3 figures) DEATH: (5) staggering backward, head thrown back, the trunk falling from its hand; (6) ' +
      'fallen to its knees, slumped forward, arms hanging; (7) collapsed face-down on the ground as a low heap of cracked ' +
      'ash, crumbling.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'trollB', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT_BOSS, style(150),
      'THE CHARACTER, THE ASH TROLL (a boss, very large): a huge hulking troll, heavy and stooped, long thick arms that ' +
      'reach its knees, a small head sunk between massive shoulders, a heavy brow and a jutting jaw with two blunt ' +
      'tusks. Its hide is grey-black ASH: cracked like burnt charcoal, with a network of thin darker seams and pale ' +
      'ash-grey highlights on the shoulders and knuckles, rough and stony. Its two small eyes glow ember orange (the ' +
      'ONLY warm colour on it). A ragged dark-brown loincloth. Its weapon is a FALLEN PINE TREE TRUNK used as a club ' +
      '(rough grey-brown bark, broken branch stubs, torn roots at the end it grips). Colours: charcoal, ash grey, slate, ' +
      'dark brown; the eyes ember orange.',
      'LAYOUT: exactly 6 figures of the SAME troll in 2 horizontal rows of 3, read left to right, all facing the viewer:\n' +
      'Row 1 (top): (1) SMASH windup: the tree trunk raised high overhead in both hands, back arched; (2) SMASH strike: ' +
      'the trunk slammed down to the ground in front of it, body bent forward; (3) THROW windup: the trunk held low in ' +
      'its right hand, its left arm raised behind its head holding a big round grey BOULDER.\n' +
      'Row 2 (bottom): (4) THROW release: the left arm flung forward toward the viewer, hand open, the boulder gone; ' +
      '(5) STOMP windup: one huge foot raised high, knee up, arms spread wide for balance; (6) STOMP strike: that foot ' +
      'slammed down, knees bent deep, a small puff of grey dust around the foot.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'items', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT_ITEMS, style(28).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', 'Each item is seen from the front or the side, centred in its own area.'),
      'LAYOUT: exactly 6 separate small pixel-art game items in 2 rows of 3, each alone with wide magenta gaps:\n' +
      'Row 1: (1) XP GEM: a small faceted crystal shard, pale cyan-white with a bright white glint (cool colours only); ' +
      '(2) GOLD COIN: a small round pale-yellow coin with a square hole in the middle, front view; (3) HEART: a small ' +
      'plump red pixel heart with a white highlight.\n' +
      'Row 2: (4) SPEAR: a crude wooden throwing spear with a leaf-shaped iron tip and a rag tied below the tip, drawn ' +
      'perfectly HORIZONTAL, pointing RIGHT, long and thin (about 6 times longer than the gem is wide); (5) BOULDER: a ' +
      'big rough round grey rock, chunky facets, cracks, a little dark moss; (6) FIREBOMB: a round brown clay pot with ' +
      'a narrow neck, a rag stuffed in its neck burning with a small orange flame.'].join('\n\n'),
  },
  {
    id: 'vmtex', refs: [], aspect: '3:2',
    prompt: ['TEXT-ONLY BRIEF (no reference images are attached): the look is the chunky pixel-texture look of the ' +
      'first-person weapon and the gloved hands of a modern retro first-person horde shooter set on a cold moonlit night ' +
      '(a dented brass fuel tank, blackened iron pipes, worn leather gloves): every material shaded with a few flat ' +
      'tones in crisp square pixel blocks, small clusters of darker pixels as wear, muted colours.',
      'A TEXTURE SWATCH SHEET for a retro first-person game: exactly 6 square pixel-art material swatches arranged in 2 ' +
      'rows of 3 on a flat, perfectly uniform, solid pure magenta #FF00FF background, with wide magenta gaps between the ' +
      'swatches. Each swatch is a completely filled square of 64 x 64 art pixels (every art pixel a crisp square block, ' +
      'hard edges, no anti-aliasing, no blur), flat and evenly lit (no perspective, no outline, no border, no text), ' +
      'seamless so it can tile:\n' +
      'Row 1: (1) worn dark-brown glove LEATHER with creases, scuffs and a stitched seam; (2) dented polished BRASS, warm ' +
      'yellow-brown with darker patina blotches, small dents and a riveted seam; (3) blackened IRON, cool dark grey with ' +
      'rivets, scratches and rust specks.\n' +
      'Row 2: (4) OAK WOOD grain, mid-brown planks with grain lines and a knot; (5) rough dark grey-green wool CLOTH for ' +
      'a sleeve, a coarse weave; (6) a scuffed red-brown leather STRAP texture with a stitched edge and a small iron ' +
      'buckle hole.'].join('\n\n'),
  },
];

// ------------------------------------------------------------------------------------------------ DESIGN §9
// The new goblins, Brother Cinder, the Chain Imp tower and the v2 items. The grunt's raw sheet (text-only, 2026-11-18) is
// attached as the one style reference so the new sheets match the existing atlas (outline, pixel size, palette); the v2
// items attach the first-wave items sheet instead. Written to jobs_v2.json.
const REF_V2 = ['assets-src/sprites/raw/grunt.png'];
const REFS_V2 = 'ATTACHED REFERENCE: the ONE attached image is our own GRUNT GOBLIN sprite sheet from this same game, drawn ' +
  'for it from a text-only brief: match its pixel-art style EXACTLY (the same art-pixel size, the same near-black ' +
  'outline, the same muted night palette and flat shading). Never copy the grunt itself: the character below is a new, ' +
  'original one. The look in words: ' + LOOK;
const REF_ITEMS = ['assets-src/sprites/raw/items.png'];
const REFS_ITEMS = 'ATTACHED REFERENCE: the ONE attached image is our own sheet of pickups from this same game, drawn for ' +
  'it from a text-only brief: match its pixel-art style EXACTLY (the same art-pixel size, the same near-black outline, ' +
  'the same muted palette and flat shading). Never copy its items: the items below are new, original ones. The look in ' +
  'words: ' + LOOK_ITEMS;
const NO_WORDS = 'Never draw any letters, words or numbers anywhere, not even on the banner.';
const jobsV2 = [
  {
    id: 'chief', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(64),
      'THE CHARACTER, GOBLIN CHIEFTAIN (an elite, bigger and broader than a normal goblin): a burly olive-green goblin ' +
      '(#6f7a3a skin) with long sideways ears, a fierce underbite with tusks, a CROWN OF BONES (a ring of small pale ' +
      'bone spikes and teeth) on its head, a shaggy dark fur mantle over its shoulders, a battered iron chest plate and ' +
      'a rope belt with trinkets. In its LEFT hand it holds a tall wooden WAR BANNER pole that rises well above its head; ' +
      'the banner is a ragged rectangular dark cloth (muted dull blue-grey) hanging from a crossbar, painted with a ' +
      'simple pale cream LANTERN / LAMP symbol (a lamp with a little flame) that is CROSSED OUT by a big thick dark-red ' +
      'X painted over it, clearly readable. In its RIGHT hand a heavy jagged iron cleaver. ' + NO_WORDS + ' Muted olive, ' +
      'fur brown, dull iron, bone white, the dark banner cloth.',
      goblinLayout('the cleaver raised high over its head, the banner held behind it, mouth open roaring',
        'the cleaver chopped down in front, body lunging forward, the banner still upright')].join('\n\n'),
  },
  {
    id: 'hexer', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(52),
      'THE CHARACTER, HEXER (an elite goblin shaman): a thin, stooped olive-green goblin (#6f7a3a skin) with long ears, ' +
      'wearing a ragged dark grey-brown hooded cloak covered in hanging bone charms and feathers, a pale bone mask over ' +
      'the upper half of its face with two eye holes, bare skinny feet. It carries a crooked wooden STAFF taller than ' +
      'itself topped with a small animal skull, and a small GREEN glowing HEX orb (a pale green ball of magic with a ' +
      'tiny dark rune inside) floats above its other open hand. The green glow is the ONLY bright colour on it.',
      goblinLayout('CAST windup: the staff raised high, the green hex orb growing bigger and brighter over its head',
        'CAST release: the staff thrust forward toward the viewer, a green hex orb flying out of the open hand')].join('\n\n'),
  },
  {
    id: 'douser', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(42),
      'THE CHARACTER, DOUSER (a small goblin water carrier): a small, scrawny olive-green goblin (#6f7a3a skin) with ' +
      'big sideways ears and worried big eyes, a soaked grey-brown sackcloth tunic, a wet cloth wrapped on its head, ' +
      'carrying a WOODEN WATER BUCKET (dark oak staves, two iron hoops, a rope handle) in both hands in front of its ' +
      'belly, the bucket full of pale blue-grey water with a few drips falling from it. No weapon. Muted olive, grey-brown, ' +
      'dark wood, dull iron and pale blue-grey water.',
      goblinLayout('THROW windup: the bucket swung back over its shoulder with both hands, water sloshing',
        'THROW release: the bucket swung forward toward the viewer, a big splash of pale blue water flying out of it')].join('\n\n'),
  },
  {
    id: 'cinder', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(46),
      'THE CHARACTER, BROTHER CINDER (a friendly, mysterious old merchant, NOT an enemy): a small, HUNCHED figure in a ' +
      'long, sooty, charcoal-black hooded ROBE with a frayed, singed hem and patched sleeves; the deep hood hides the ' +
      'face completely in shadow, and only TWO small glowing EMBER-ORANGE EYES show inside the dark hood (the ONLY warm ' +
      'colour on him). A rope belt with a small pouch and a little iron key. His hands are hidden in grey-wrapped ' +
      'bandages. A faint wisp of grey smoke rises from his shoulders. He stands facing the viewer. Colours: soot black, ' +
      'charcoal grey, ash grey, a dull brown rope; the eyes ember orange.',
      'LAYOUT: exactly 6 figures of the SAME character in 2 horizontal rows, read left to right:\n' +
      'Row 1 (top, 4 figures) IDLE: (1) standing hunched, hands folded in the sleeves; (2) the same, shoulders a little ' +
      'higher (breathing in), the smoke wisp moved; (3) the same as 1, the eyes half closed (a slow blink); (4) the same, ' +
      'head tilted slightly to one side.\n' +
      'Row 2 (bottom, 2 figures) TALKING: (5) one bandaged hand raised, palm open, explaining; (6) the hand pointing ' +
      'forward toward the viewer, the head leaning in.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'chainimp', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(40).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', 'All figures face the viewer (front view), drawn at the same scale.'),
      'THE CHARACTER, THE CHAIN IMP (a small crouching imp, an ally guard): a small wiry imp with SOOT-BLACK charcoal ' +
      'skin, two short curved horns, pointed ears, two small glowing ember-orange eyes, a wide toothy grin, a heavy iron ' +
      'collar, a dark loincloth and a thin tail. It holds a length of IRON CHAIN ending in a big iron HOOK.',
      'LAYOUT: exactly 8 separate figures in 2 horizontal rows, each alone with wide magenta gaps:\n' +
      'Row 1 (top, 5 figures), THE IMP ALONE (crouching, as if sitting on a post top), no perch: (1) IDLE: crouched, the ' +
      'chain and hook hanging from one hand; (2) IDLE: the same, head turned slightly, tail curled; (3) THROW windup: ' +
      'standing up, swinging the chain and hook in a circle over its head; (4) THROW release: arm flung forward toward ' +
      'the viewer, the chain flying out straight ahead, the hook gone; (5) PULL: leaning back, both hands hauling the ' +
      'chain in.\n' +
      'Row 2 (bottom, 3 figures), THE IRON PERCH it sits on, without the imp, three upgrade levels side by side, the ' +
      'same width, each standing on the ground: (6) LEVEL 1: a simple black iron post about twice the imp\'s height with ' +
      'a small round iron platform on top and a few chain links hanging; (7) LEVEL 2: the same post a little taller, ' +
      'with a ring of short iron SPIKES around the platform and a small, EMPTY, unlit iron brazier bowl (no fire, no ' +
      'flame); (8) LEVEL 3: taller still, ' +
      'a thicker post with three iron feet, two rings of long iron spikes, heavy chains hanging in loops and iron skulls ' +
      'on the spikes. Colours: black and dark grey iron with dull rust, the imp soot black, its eyes ember orange.'].join('\n\n'),
  },
  {
    id: 'items2', refs: REF_ITEMS, aspect: '3:2',
    prompt: [REFS_ITEMS, style(28).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', 'Each item is seen from the front or the side, centred in its own area.'),
      'LAYOUT: exactly 6 separate small pixel-art game items in 2 rows of 3, each alone with wide magenta gaps:\n' +
      'Row 1: (1) CHARM: a small trinket, a pale carved bone amulet with a small round GREY-WHITE stone set in its ' +
      'centre on a short leather cord, with a tiny white glint (the stone must be light grey-white so it can be tinted); ' +
      '(2) EMBER GEM: a small faceted crystal shard, deep ember orange-red with a bright yellow-white glowing core; ' +
      '(3) WATER BUCKET in flight: a wooden bucket (dark staves, iron hoops) tumbling sideways, a splash of pale ' +
      'blue-grey water spilling out of it.\n' +
      'Row 2: (4) HEX ORB: a round ball of pale GREEN magic light with a darker green swirling rune inside and a few ' +
      'green sparks around it; (5) IRON HOOK: a big black iron grappling hook with three barbed prongs and two chain ' +
      'links at its end, drawn HORIZONTAL, pointing RIGHT; (6) CHAIN: a short straight HORIZONTAL length of 5 black ' +
      'iron chain links, thin.'].join('\n\n'),
  },
];

// ------------------------------------------------------------------------------------------------ DESIGN §5.5
const jobsV3 = [
  {
    id: 'batgremlin', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(46).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', 'All figures face the viewer (front view, flying toward the camera), drawn at the same scale in every frame.'),
      'THE CHARACTER, BAT GREMLIN (a flying goblin): a small olive-green goblin (#6f7a3a skin) with big sideways ears and ' +
      'goggles pushed up on its forehead, STRAPPED with leather belts UNDER a home-made GLIDER of two big stitched ' +
      'BAT WINGS (dark brown-grey leather patches sewn together with pale stitches, stretched over thin wooden ribs, ' +
      'ragged scalloped edges), its legs dangling below. The wings are very wide (about three times the goblin\'s width). ' +
      'Muted olive, dark leather brown-grey, pale stitches, dull wood.',
      'LAYOUT: exactly 11 figures of the SAME character in 3 horizontal rows, read left to right:\n' +
      'Row 1 (top, 4 figures) FLYING, wing flap cycle: (1) wings fully raised up in a V; (2) wings level, spread wide; ' +
      '(3) wings swept down; (4) wings level again, legs swinging.\n' +
      'Row 2 (middle, 4 figures): (5) DIVE: wings folded back tight, body pointing down toward the viewer, mouth open ' +
      'screaming, claws out; (6) DIVE: the same, steeper, wings tucked; (7) BURNING: the wings ON FIRE, orange-yellow ' +
      'pixel flames on the wings and its back, the goblin screaming; (8) BURNING: another flailing pose, a wing torn and ' +
      'burning.\n' +
      'Row 3 (bottom, 3 figures) DEATH, a tumbling fall: (9) hit, the glider crumpling, spinning sideways; (10) falling ' +
      'upside down, wings broken; (11) crashed on the ground as a low heap of torn wings and goblin.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
];

// ------------------------------------------------------------------------------------------------ DESIGN §5.6, §6.3, §12
const FRONT_ANY = 'All figures face the viewer (front view), drawn at the same scale in every frame.';
const styleFree = (px) => style(px).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', FRONT_ANY);
const sideRun = (px) => style(px).replace('All figures face the viewer (front view, toward the camera, like enemies charging at the player), drawn at the same scale in every frame, feet on a common baseline within each row.', 'Every figure is seen from the SIDE, running or moving to the RIGHT, drawn at the same scale, feet on a common baseline within each row.');
const jobsV4 = [
  {
    id: 'ram', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, style(48),
      'THE CHARACTER, THE SIEGE RAM CREW (one sprite): a felled OAK TRUNK used as a battering ram, capped at its front end ' +
      'with a dark IRON RAM\'S HEAD (curled horns), carried on rope slings by EIGHT small olive-green goblins (#6f7a3a ' +
      'skin, big sideways ears), four on each side, seen from the FRONT-THREE-QUARTER view so the iron ram\'s head points ' +
      'toward the viewer and the trunk recedes behind it with the goblins under it. Muted olive, dark oak bark brown, ' +
      'dull iron.',
      'LAYOUT: exactly 11 figures of the SAME crew and ram in 3 horizontal rows, read left to right:\n' +
      'Row 1 (top, 4 figures) WALK: the crew marching forward carrying the ram, legs in four steps of a walk cycle.\n' +
      'Row 2 (middle, 4 figures): (5) SWING back: the crew leaning back, the ram pulled back to strike; (6) SWING strike: ' +
      'the ram thrust forward hard, the crew lunging; (7) BURNING: orange-yellow pixel flames on the trunk and on the ' +
      'goblins\' backs, the crew stalled, panicking; (8) BURNING: another panicked pose, flames higher.\n' +
      'Row 3 (bottom, 3 figures) BROKEN: (9) the trunk cracked, goblins dropping it; (10) the trunk on the ground, broken ' +
      'in two, the crew fleeing; (11) the broken trunk lying alone on the ground with the iron ram\'s head.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'rainA', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT_BOSS, styleFree(150),
      'THE CHARACTER, THE RAINMOTHER (a final boss, enormous): a towering RIVER-GIANTESS made of DARK WATER: her body is ' +
      'deep blue-black flowing water with pale foam edges, studded with grey RIVER STONES and draped in dark green MOSS and ' +
      'weed; long streaming hair of water; a calm, ancient, sorrowful face with two pale blue glowing eyes; a CROWN of five ' +
      'small LANTERNS burning with PALE BLUE fire woven into her hair; two tiny goblin SHAMANS in hooded cloaks with ' +
      'staffs ride on her shoulders. Water drips and pours from her arms. Colours: deep blue-black, slate, foam white, ' +
      'moss green, river-stone grey; the lanterns and eyes pale blue. Not human skin anywhere; she is water and stone.',
      'LAYOUT: exactly 11 figures of the SAME giantess in 3 horizontal rows, read left to right, all facing the viewer:\n' +
      'Row 1 (top, 4 figures) WALK: wading forward toward the viewer, a heavy walk cycle, water pouring off her.\n' +
      'Row 2 (middle, 4 figures): (5) RISE: only her head, shoulders and lantern crown above a flat band of dark river ' +
      'water; (6) RISE: risen to the waist out of the river water; (7) CLIMB: leaning forward, both huge hands reaching ' +
      'down and forward to grip the ground, climbing a slope; (8) CLIMB: the other hand forward.\n' +
      'Row 3 (bottom, 3 figures) COLLAPSE: (9) staggering back, her water body boiling with white steam; (10) falling to ' +
      'her knees, dissolving, the lanterns going out; (11) collapsed into a low spreading pool of dark water and stones ' +
      'with wisps of steam.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'rainB', refs: [], aspect: '3:2',
    prompt: [STYLE_TEXT_BOSS, styleFree(150),
      'THE CHARACTER, THE RAINMOTHER (the same final boss as before): a towering river-giantess made of DARK WATER, deep ' +
      'blue-black flowing water with pale foam edges, grey river stones and dark green moss, long hair of water, a calm ' +
      'sorrowful face with pale blue glowing eyes, a crown of five small lanterns of PALE BLUE fire in her hair, two tiny ' +
      'hooded goblin shamans riding her shoulders. Not human skin anywhere; she is water and stone.',
      'LAYOUT: exactly 4 figures of the SAME giantess in 2 rows of 2, all facing the viewer:\n' +
      'Row 1: (1) TIDE WAVE windup: both arms raised high, a great curl of dark water rising above her hands; (2) TIDE ' +
      'WAVE release: both arms swept forward and down toward the viewer, a wave of water crashing forward at her feet.\n' +
      'Row 2: (3) WHIRLPOOL windup: one arm raised, the other turning, water spiralling around her; (4) WHIRLPOOL cast: ' +
      'both hands pointed down at a swirling whirlpool of water at her feet.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'demon', refs: REF_BOSS, aspect: '3:2',
    prompt: [REFS_LINE, styleFree(200),
      'THE CHARACTER, THE DEMON (the player revealed at the very end, terrifying and grand): a towering HORNED DEMON, tall ' +
      'and gaunt-shouldered, with two great curved black horns, a face of cracked charcoal with BURNING orange-yellow eyes ' +
      'and a mouth glowing like a furnace, wearing the RUINED, scorched remains of a LAMPLIGHTER\'S long coat (tattered, ' +
      'singed hem, brass buttons, a lamplighter\'s pole-hook hanging at the belt), black clawed hands with ember-glowing ' +
      'cracks, and huge WINGS made of dark SMOKE and licking FIRE spreading behind its shoulders. Embers drift around it. ' +
      'Colours: charcoal black, ash grey, scorched brown coat, ember orange, fire yellow, dark smoke grey.',
      'LAYOUT: exactly 4 figures of the SAME demon in 2 rows of 2, all facing the viewer, the same size and position:\n' +
      'Row 1: (1) IDLE: standing, head slightly lowered, wings half spread, breathing out smoke; (2) IDLE: the same, ' +
      'chest raised (breathing in), wings a little wider.\n' +
      'Row 2: (3) HEAD LIFT: head raised toward the sky, wings spreading wide; (4) ROAR: head thrown back, mouth wide open ' +
      'blazing with fire, wings fully spread, arms out.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'host', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, sideRun(44),
      'THE CHARACTER, A SOLDIER OF THE HOST: a lean, horned, demonic warrior shown almost entirely as a dark SILHOUETTE ' +
      '(near-black charcoal with a faint dark-red rim), two curved horns, two small glowing EMBER-ORANGE eyes, a ragged ' +
      'cloak, a crude jagged blade. The ember eyes are the only bright pixels. The horns, the cloak and the body are all ' +
      'near-black charcoal and very dark maroon (never bright red or crimson); the dark red shows only as a thin rim ' +
      'along the edges.',
      'LAYOUT: exactly 8 figures of the SAME soldier in 2 rows of 4:\n' +
      'Row 1 MARCH: a steady marching walk cycle in four steps.\n' +
      'Row 2 RUN: a fast hunting run cycle in four steps, leaning forward, blade low.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'villagers', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, sideRun(40),
      'THE CHARACTERS, PEACEFUL GOBLIN VILLAGERS fleeing at night (olive-green goblins with big sideways ears, simple ' +
      'homespun clothes, no weapons): a MOTHER in a long dress and headscarf carrying a small goblin CHILD in her arms; an ' +
      'old ELDER with a white beard and a walking stick; a small goblin CHILD running alone. They are frightened and ' +
      'running away to the right. Muted olive, homespun brown and grey.',
      'LAYOUT: exactly 9 figures in 3 rows of 3 (a running cycle of three steps per row):\n' +
      'Row 1: the MOTHER carrying the child, running (3 steps).\n' +
      'Row 2: the ELDER hurrying with the stick (3 steps).\n' +
      'Row 3: the small CHILD running (3 steps).\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'animals', refs: REF_V2, aspect: '3:2',
    prompt: [REFS_V2, sideRun(40),
      'FOREST ANIMALS fleeing at night: a red DEER (stag with small antlers), a wild BOAR (dark bristly, tusks), and a ' +
      'small dark BIRD. Natural muted colours.',
      'LAYOUT: exactly 8 figures in 3 rows:\n' +
      'Row 1 (3 figures): the DEER bounding, a three-step gallop.\n' +
      'Row 2 (3 figures): the BOAR running, a three-step run.\n' +
      'Row 3 (2 figures): the BIRD flying to the right, wings up; wings down.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
  {
    id: 'cinderk', refs: ['assets-src/sprites/raw/cinder.png'], aspect: '3:2',
    prompt: ['ATTACHED REFERENCE: the ONE attached image is this character\'s own sprite sheet from this same game (Brother ' +
      'Cinder): draw the SAME character in exactly the same pixel-art style, palette, outline and pixel size. The look ' +
      'in words: ' + LOOK, style(46),
      'THE CHARACTER, BROTHER CINDER (the same small hunched figure in a sooty charcoal-black hooded robe with a frayed, ' +
      'singed hem, the face hidden in the hood\'s shadow with only two glowing EMBER-ORANGE eyes, a rope belt with a pouch and ' +
      'a little iron key, bandaged hands, a wisp of grey smoke), now KNEELING in reverence, facing the viewer.',
      'LAYOUT: exactly 2 figures of the SAME character side by side in one row, with a wide magenta gap:\n' +
      '(1) KNEELING on one knee, head bowed deeply, both bandaged hands pressed to his chest; (2) KNEELING, head bowed, one ' +
      'bandaged hand raised and open toward the viewer in welcome.\n' +
      'Every figure stands alone with wide magenta gaps; nothing touches or overlaps.'].join('\n\n'),
  },
];
fs.writeFileSync(path.join(HERE, 'jobs_v4.json'), `${JSON.stringify(jobsV4.map((j) => ({ ...j, out: `${REL}/${j.id}.png` })), null, 1)}\n`);

const out = jobs.map((j) => ({ ...j, out: `${REL}/${j.id}.png` }));
fs.writeFileSync(path.join(HERE, 'jobs_v3.json'), `${JSON.stringify(jobsV3.map((j) => ({ ...j, out: `${REL}/${j.id}.png` })), null, 1)}\n`);
fs.writeFileSync(path.join(HERE, 'jobs.json'), `${JSON.stringify(out, null, 1)}\n`);
const outV2 = jobsV2.map((j) => ({ ...j, out: `${REL}/${j.id}.png` }));
fs.writeFileSync(path.join(HERE, 'jobs_v2.json'), `${JSON.stringify(outV2, null, 1)}\n`);
console.log(`wrote ${out.length} jobs to jobs.json and ${outV2.length} to jobs_v2.json`);
