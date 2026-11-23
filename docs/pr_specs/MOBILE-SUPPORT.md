# Valleyward mobile browser support

## Meta

| Field | Value |
| --- | --- |
| Status | `implemented` |
| PR | [Spec PR #2](https://github.com/lethehaiau/valleyward/pull/2) |

## Goal

Let players play the full Valleyward campaign in a phone browser using touch, from the title through combat, upgrades, camp, and the ending. Add touch controls to the existing game and refactor shared input or UI code only where needed.

## Non-goals

- Portrait gameplay and Bluetooth controller support.
- Performance testing in this pass.

## Outline

- **Landscape first.** On a phone in portrait, show “Rotate your phone to play” before the player can start. In landscape, show the normal title. If the phone rotates to portrait during play, pause and clear held input. Returning to landscape restores the current screen and requires a fresh touch for gameplay actions.
- **Touch layout.** Follow the control pattern in [Zombie Attack](https://indie-forge-studio.itch.io/threejs-zombie-attack) with a movement stick at bottom left, swipe-to-look in the open play area, separate Fire and Jump buttons at bottom right, and Pause at top right. Keep controls inside the safe area and clear of the reticle. Show touch instructions in the existing first-run help.
- **Aim while firing.** A press on Fire starts shooting. Dragging that same touch also turns the camera, and lifting it stops held fire. A drag that starts in the open play area only aims, even if it crosses Fire. The movement stick works at the same time.
- **Fullscreen.** Offer a Fullscreen button on the landscape title and in the mobile pause menu when the browser allows element fullscreen. A tap requests fullscreen for the game and HUD together. Update the button when fullscreen is entered or exited, including exits triggered by the browser. If fullscreen is unavailable or the request fails, keep the game playable in the tab. [iPhone Safari lacks element fullscreen](https://bugs.webkit.org/show_bug.cgi?id=206854). Players who want an app-style window can optionally use [Add to Home Screen → Open as Web App](https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26).
- **Full action coverage.** Sprint toggles on tap, Weapon cycles unlocked weapons, and Reload, Bomb, and Sunburst use dedicated buttons. Kindle and Interact appear when the player can act at the beacon or camp. Reuse the existing screens for upgrade cards, Brother Cinder’s shop, tower building and upgrades, beginning the next night, and result and ending actions. Route movement and actions through the [existing input and command paths](../../src/main.js) and preserve keyboard and mouse behavior. Clear held input when a touch is cancelled, a modal takes over, or the app is backgrounded.
- **End-to-end verification.** Run desktop keyboard-and-mouse and mobile touch E2E tests after implementation. Cover a fresh start, combat controls, upgrade selection, pause and resume, beacon and camp interactions, entering the next night, and the ending. On Android Chrome, enter and exit fullscreen and check that the HUD and controls still work. On iPhone Safari, verify that the game is playable in the tab without a Fullscreen button. Check the portrait prompt, rotation during play, and app switching on phones, and verify that the next fresh touch works without a stuck movement or fire action.

Browser checks use `npm run e2e -- --only entry,probe,upgrades,mobile,v2,v3,v4`. The mobile stage injects touch contacts in Chrome. Use physical phones for the iPhone Safari and OS app-switch checks.
