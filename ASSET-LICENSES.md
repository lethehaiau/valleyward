# Valleyward licences

Valleyward uses three licences. Which one applies depends on the file:

| What | Where | Licence |
|---|---|---|
| Source code, shaders, tools, tests and technical documentation | everything not listed below | [MIT](LICENSE) |
| Original game art | `public/assets/sprites/*.png`, `*.webp`; `public/assets/tex/*.webp`; `public/assets/models/viewmodel/*.png`; `public/assets/ui/*.png`; `src/ui/cursor-*.png`; `docs/mockups/*.jpg`; the screenshots in `docs/assets/` | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| Original narrative content | `docs/STORY.md`, and the story text, dialogue and on-screen lines in the game (for example Brother Cinder's lines, the night and dawn cards and the ending) wherever they appear, including inside source files | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| Fonts | `public/assets/fonts/*.woff2` | [SIL Open Font License 1.1](#third-party-material) |

The MIT License in [LICENSE](LICENSE) does not cover the art, the narrative content or the fonts listed above. Metadata
files next to the art (`provenance.json`, the atlas table `actors.json`, the `*.jpg.json` records) are technical
documentation under MIT.

## Original game content (CC BY-NC 4.0)

The Valleyward authors license their original art and narrative content under
[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).
This covers the sprites, textures, viewmodel textures, UI art, key-art mockups, story and dialogue listed above. The same
licence applies to those creative elements when they appear inside source files or in a compiled build.

When sharing the assets or adaptations, credit **The Valleyward authors**, link to the source and the licence, and say
what you changed. The licence permits sharing and adapting the assets for noncommercial purposes only.

The art was generated from the authors' own prompts with OpenAI's image model through the Codex CLI; each file's prompt
and inputs are recorded in the `provenance.json` beside it. The licence applies to the extent the authors hold rights in
this material.

## Project branding

Rights in the official Valleyward name and logo as project branding are reserved. Neither licence grants permission to
use them to name or promote another project.

## Third-party material

- **Silkscreen** and **Pixelify Sans** are distributed under the SIL Open Font License 1.1. Their copyright and licence
  notices accompany the fonts: `public/assets/fonts/OFL-*.txt` in the repository and `assets/fonts/` in a build.
- **The GitHub mark** on the title screen and in the pause menu is the `mark-github` icon from GitHub's Octicons
  (MIT License, Copyright (c) GitHub Inc.); it only links to this project's repository, as GitHub's logo guidelines
  allow.
- **Three.js** and **Firewraith** are MIT-licensed. Builds include their licence notices and Firewraith's third-party
  shader notices in `licenses/`, alongside the notices for the bundled build-tool runtime code (Vite, Rolldown).
- **ElevenLabs audio** is governed by the terms that applied to its generation and distribution. This repository does
  not include those recordings (see "Asset sources" in `docs/DEVELOPING.md`). Any audio supplied locally keeps its own terms.
