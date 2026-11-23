// Exercise touch input with Chrome's native touch injection. Fixtures position the player and advance
// to specific progression beats so the test can use the real buttons without playing all ten nights.
import assert from 'node:assert/strict';
import { openPage, waitFor, sleep } from './browser.mjs';
import { ARENA } from '../../src/shared/arena.js';

const portrait = { width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 1 };
const landscape = { ...portrait, width: portrait.height, height: portrait.width, isLandscape: true };
const hud = '.ew-touch-hud:not([hidden])';
const action = (name) => `${hud} [data-touch="${name}"]:not([hidden]):not(:disabled)`;
const isVisible = (selector) => {
  const element = document.querySelector(selector);
  return !!element && element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden';
};

export async function mobileStage({ browser, base, seed, check, shot }) {
  const { page, errors } = await openPage(browser, `${base}?seed=${seed}&save=fresh&god=1&mute=1`,
    (tab) => tab.setViewport(portrait));
  const until = async (label, predicate, arg, ms = 12000) => {
    assert.ok(await waitFor(page, predicate, arg, ms, 40), label);
    check(`mobile.${label}`, true);
  };
  async function at(selector) {
    const element = await page.waitForSelector(selector, { visible: true, timeout: 8000 });
    await element.scrollIntoView();
    const box = await element.boundingBox();
    assert.ok(box, selector);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }
  async function tap(selector) {
    const { x, y } = await at(selector);
    const hit = await page.evaluate(({ x, y, selector }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest(selector) ? null : element?.outerHTML.slice(0, 200) || 'no element';
    }, { x, y, selector });
    assert.equal(hit, null, `tap ${selector} at (${x}, ${y}) hit ${hit}`);
    await page.touchscreen.tap(x, y);
  }
  const cdp = await page.createCDPSession();
  const touches = (type, ...touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  try {
    await until('portraitPrompt', () => {
      const prompt = document.querySelector('#ew-rotate');
      return prompt?.textContent.includes('Rotate') && getComputedStyle(prompt).display !== 'none';
    });
    await until('ready', () => __ew.assetsReady() && document.querySelector('#loading')?.inert, null, 120000);
    await page.touchscreen.tap(180, 320);
    assert.equal(await page.evaluate(() => __ew.state().mode), 'title');

    await page.setViewport(landscape);
    await until('landscapeTitle', () => !document.querySelector('#loading').inert && document.querySelector('#loading').textContent.includes('TAP TO BEGIN'));
    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await tap('#loading [data-touch-fullscreen]');
      await until('enterFullscreen', () => document.fullscreenElement === document.documentElement && __ew.state().mode === 'title');
      await tap('#loading [data-touch-fullscreen]');
      await until('exitFullscreen', () => document.fullscreenElement === null);
    }
    await tap('#loading .ew-coverc');
    await until('intro', () => __ew.state().mode === 'intro');
    await until('touchHelp', () => __ew.ui().modal && document.querySelector('.ew-controls.on')?.textContent.includes('Hold Fire'));
    await tap('.ew-controls.on .ew-panel');
    await until('play', isVisible, action('weapon'));
    await tap(action('fire'));
    await until('pistolFire', () => __ew.state().player.ammo.pistol < 8);
    await tap(action('reload'));
    await until('reload', () => __ew.state().player.reloadT > 0);
    await tap(action('jump'));
    await until('jump', () => !__ew.state().player.onGround);
    await tap(action('bomb'));
    await until('firebomb', () => __ew.state().player.bombs < __ew.state().player.bombsMax);
    await page.evaluate(() => { __ew.state().player.sunburst = 1; });
    await tap(action('ult'));
    await until('sunburst', () => __ew.state().player.sunburst < 1);
    await tap(action('sprint'));
    assert.equal(await page.$eval(action('sprint'), (button) => button.getAttribute('aria-pressed')), 'true');
    await tap(action('weapon'));
    await until('lance', () => __ew.state().player.weapon === 'lance' && __ew.state().player.switchT >= 0.5);

    const stick = { ...await at('.ew-touch-stick'), id: 1 };
    stick.y -= 32;
    const fire = { ...await at(action('fire')), id: 2 };
    const before = await page.evaluate(() => {
      const { x, z, yaw } = __ew.state().player;
      return { x, z, yaw };
    });
    await touches('touchStart', stick);
    await touches('touchStart', stick, fire);
    await touches('touchMove', stick, { ...fire, x: fire.x - 150, y: fire.y - 35 });
    await until('moveAimAndFire', (start) => {
      const p = __ew.state().player;
      return p.firing && Math.abs(p.yaw - start.yaw) > 0.25 && Math.hypot(p.x - start.x, p.z - start.z) > 0.2
        && document.pointerLockElement === null;
    }, before);
    await touches('touchEnd');
    await until('releaseStopsFire', () => !__ew.state().player.firing && !document.querySelector('[data-touch="fire"]').classList.contains('held'));

    await touches('touchStart', fire);
    await until('holdBeforeRotation', () => __ew.state().player.firing);
    await page.setViewport(portrait);
    await until('rotationPauses', () => __ew.state().paused && document.querySelector('.ew-touch-hud').hidden);
    const clock = await page.evaluate(() => __ew.state().night.clock);
    await sleep(200);
    assert.equal(await page.evaluate(() => __ew.state().night.clock), clock);
    await touches('touchCancel');
    await page.setViewport(landscape);
    await until('rotationRestores', () => !__ew.state().paused && !__ew.state().player.firing && !document.querySelector('.ew-touch-hud').hidden);

    const refreshedFire = { ...await at(action('fire')), id: 2 };
    await touches('touchStart', refreshedFire);
    await until('freshFire', () => __ew.state().player.firing);
    await touches('touchCancel');
    await until('cancelStopsFire', () => !__ew.state().player.firing);

    await page.evaluate(() => { const p = __ew.state().player; p.xp = p.xpNext; });
    await until('upgradeOpens', () => __ew.state().mode === 'cards' && document.querySelector('.ew-touch-hud').hidden);
    await sleep(450);
    await tap('.ew-cards.on .ew-card:first-child');
    await until('upgradeResumes', () => __ew.state().mode === 'play' && __ew.state().stats.cards.length === 1 && !document.querySelector('.ew-touch-hud').hidden);
    await tap(action('pause'));
    await until('pause', () => __ew.state().paused && __ew.ui().menu.isOpen);
    await tap('.ew-menu.on [data-act="resume"]');
    await until('resume', () => !__ew.state().paused && !document.querySelector('.ew-touch-hud').hidden);

    await page.evaluate(({ x, z }) => __ew.teleport(x, z, 0, 0), ARENA.beacon.pan);
    await tap(action('kindle'));
    await until('kindle', () => __ew.state().night.kindle === 1);
    await shot(page, 'mobile_combat');

    // Bring the night to its result, then use the actual result and camp controls.
    await page.evaluate(() => {
      __ew.setClock(299);
      __ew.troll();
      __ew.sim.ctx.troll.hit(1e9, 'bullet');
    });
    await until('dawn', isVisible, '.ew-end.on button[data-act="retry"]', 22000);
    await sleep(950); // the result screen ignores input during its opening beat
    await tap('.ew-end.on button[data-act="retry"]');
    await until('camp', () => __ew.state().mode === 'camp' && __ew.state().camp.nextNight === 2);
    await page.evaluate(({ x, z }) => {
      __ew.state().meta.gold = 10000;
      __ew.teleport(x + 2, z, -Math.PI / 2, 0);
    }, ARENA.camp.npc);
    await tap(action('kindle'));
    await until('shop', isVisible, '.ew-shop.on .ew-srow');
    await sleep(400);
    await tap('.ew-shop.on .ew-srow:first-child');
    await until('purchase', () => __ew.state().meta.upgrades.hide === 1);
    await tap('.ew-shop.on .ew-srow.organ');
    await tap('.ew-shop.on .ew-srow.organ.armed');
    await until('organPurchase', () => __ew.state().meta.organ.owned);
    await tap('.ew-shop.on .ew-shop-close');
    await until('shopCloses', () => !__ew.state().camp.panel);

    await page.evaluate(({ x, z }) => __ew.teleport(x, z + 1.5, Math.PI, 0), ARENA.camp.pads[0]);
    await sleep(350);
    await tap(action('kindle'));
    await until('pad', isVisible, '.ew-shop.pad.on .ew-tcard');
    await sleep(400);
    await tap('.ew-shop.pad.on .ew-tcard.obelisk');
    await until('build', () => __ew.state().run.towers.some((tower) => tower.type === 'obelisk' && tower.level === 1));
    await tap('.ew-shop.pad.on .ew-tcard.obelisk');
    await until('towerUpgrade', () => __ew.state().run.towers.some((tower) => tower.type === 'obelisk' && tower.level === 2));
    await tap('.ew-shop.on .ew-shop-close');
    await tap('.ew-begin.on button');
    await until('nextNight', () => __ew.state().mode === 'play' && __ew.state().night.n === 2);
    await tap(action('weapon'));
    await until('organEquipped', () => __ew.state().player.weapon === 'organ');
    await page.evaluate(() => { __ew.state().player.organ.drum--; });
    await tap(action('reload'));
    await until('organReload', () => __ew.state().player.organ.reloadT > 0);

    await page.evaluate(() => {
      __ew.sim.goto('ending');
      const ending = __ew.state().ending;
      ending.skippable = true;
      ending.t = 3.2;
    });
    await tap('.ew-skip.on');
    await until('endingCard', isVisible, '.ew-end.on button[data-act="retry"]');
    await sleep(950);
    await tap('.ew-end.on button[data-act="retry"]');
    await until('playAgain', () => __ew.state().mode === 'camp' && __ew.state().camp.nextNight === 1);
    check('mobile.console', errors.length === 0, { errors });
  } catch (error) {
    await shot(page, 'mobile_failure').catch(() => {});
    throw error;
  } finally {
    await page.close();
  }

  // Reproduce an unavailable Fullscreen API without pretending Chrome is Safari.
  const fallback = await openPage(browser, `${base}?seed=${seed}&save=fresh&mute=1`, async (tab) => {
    await tab.setViewport(landscape);
    await tab.evaluateOnNewDocument(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
  });
  try {
    const ready = await waitFor(fallback.page, () => __ew.assetsReady() && !!document.querySelector('#loading .ew-coverc'), null, 120000);
    assert.ok(ready, 'fullscreen fallback title');
    check('mobile.fullscreenUnavailable', await fallback.page.evaluate(() => !document.querySelector('[data-touch-fullscreen]')));
    await fallback.page.tap('#loading .ew-coverc');
    check('mobile.playWithoutFullscreen', !!await waitFor(fallback.page, () => __ew.state().mode === 'intro', null, 8000));
  } finally {
    await fallback.page.close();
  }
}
