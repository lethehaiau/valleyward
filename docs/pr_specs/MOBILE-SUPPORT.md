# Valleyward mobile browser support

## Meta

| Field | Value |
| --- | --- |
| Status | `need triage` |
| PR | [Spec PR #2](https://github.com/lethehaiau/valleyward/pull/2) |

## Goal

Let players open Valleyward in a phone browser and play the existing first-person game using the touchscreen and on-screen buttons.

## Non-goals

- Bluetooth controller support.
- Performance testing in this pass.

## Outline

- **Discuss before implementing.** Bring a rough phone HUD sketch to Aule and walk through Night I together. Record the agreed layout, actions, and first playable scope here before writing code.
- **Proposed layout.** Start with landscape, movement buttons on the left, and drag-to-aim and Fire on the right. Try dragging from Fire to aim while holding the Lance. Agree on portrait behavior, which secondary actions need buttons, and whether the first pass reaches dawn and camp.
- **Input and HUD.** Route touch through the [existing game commands](../../src/main.js). Keep buttons in the phone's safe area and clear of the reticle. Clear held actions when a touch is cancelled, a menu takes focus, or the app is backgrounded. Use the [desktop controls](../DEVELOPING.md#controls-design-32) to check which actions need a touch equivalent.
- **First playthrough.** Agree on the phone browsers to check. Start from the title, move and aim while firing, release to stop, pick an upgrade, interact at the beacon, and pause and resume. Check input after switching apps or rotating, and check that desktop input still works.
