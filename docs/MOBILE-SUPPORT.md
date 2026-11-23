# Valleyward mobile browser support

**Draft for discussion.** Start with a discussion round with Aule before writing implementation code. Bring a rough phone HUD sketch and walk through a Night I run together. Record the agreed controls, first playable scope, and remaining questions in this spec before opening an implementation PR.

## Goal and scope

Let someone open Valleyward in a phone browser and play using the touchscreen and on-screen buttons. Use the existing first-person game and combat as the starting point. Bluetooth controller support and performance testing are deferred.

## First layout to discuss

Start with a landscape sketch. Put movement buttons under the left thumb, a drag area for aim under the right, and a dedicated Fire button. Try allowing a drag that starts on Fire to adjust aim while holding the Lance on. The first thing to settle is whether someone can move, track a target, and fire at the same time with two thumbs.

Give the player a visible way to pause and resume, pick upgrades, and interact where the game already offers an action, such as kindling the beacon. Place frequently used actions where they are reachable without covering the reticle, threats, loot, or weapon state.

## Questions for the discussion round

1. Is landscape the only play layout for the first pass? What should the player see when they open or rotate the game in portrait?
2. How should movement, aim, and hold-to-fire share two thumbs? Sketch the button positions and how the player stops firing or changes direction mid-drag.
3. Which actions need their own button during Night I? Walk through weapon selection, reload, sprint, jump, firebombs, Sunburst, and the beacon. Decide how far the first pass needs to go into dawn and camp.
4. How should play resume after an upgrade, the pause menu, or an app switch? Agree on the visible behavior and the phones and browsers for the first hands-on check.

## Starting points in the code

- The [desktop controls](DEVELOPING.md#controls-design-32) list the actions available today. The [input layer](../src/core/input.js) collects held actions and one-shot presses, and [the main loop](../src/main.js) turns them into simulation commands. Route phone input through those same commands.
- Plan for independent touches, gesture cancellation, and viewport changes. Clear held gameplay actions when a touch is cancelled, a menu takes focus, or the page goes into the background. Keep controls inside the phone's safe area and keep the HUD's touch gestures separate from menus that can scroll.

## Candidate functional playthrough

On an agreed phone browser, start from the title screen, move and aim while holding the Lance, release to stop firing, pick an upgrade, interact at the beacon, and pause and resume. Switch apps while holding an action and confirm that it is released on return. Rotate the phone and check that the available controls are still reachable. Confirm that the existing desktop controls still work. Use the discussion to settle whether completing Night I and entering camp belong in this first playthrough.
