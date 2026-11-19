// @ts-check
// The DESIGN §9 stylesheet (docs/DESIGN.md §13): the gold counter, elite name plates, the camp HUD, Brother Cinder's
// panel and the pad panel, the coming-soon plate and the v2 end cards, the "day passes" caption. Appended after
// style.js's sheet; same units (--k, --p) and palette (ART-DIRECTION §3: gold is the coins' and the XP bar's colour).
export function buildCssV2() {
  return `
/* the Pixelify subset has no "fi"/"fl" ligature glyphs: the browser drew "refill" as "reAll" */
.ewui,.ewui *,#loading{font-variant-ligatures:none;font-feature-settings:"liga" 0,"clig" 0}
/* gold counter (top-left, under LV) */
.ew-goldrow{display:flex;align-items:center;gap:.4em;margin-top:.5em;font-size:.82em;letter-spacing:.06em;white-space:nowrap}
.ew-goldrow b{font-weight:400;color:#f6e7a0}
.ew-goldrow em{font-style:normal;font-size:.72em;color:var(--cyan);margin-left:.2em}
.ew-goldrow.bump b{animation:ew-bump .3s ease}
.ew-coin{display:inline-block;width:.9em;height:.9em;flex:none;background:radial-gradient(circle at 38% 35%,#fff6c8 0 18%,#f2cf52 19% 52%,#b8861f 53% 70%,#5a3d0c 71%);
  clip-path:polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%);box-shadow:0 0 0 var(--p) var(--line)}
.ewui.ew-camp .ew-lvrow{display:none}
.ewui.ew-camp .ew-goldrow{margin-top:0;font-size:1.05em}

/* the camp HUD: the night bars give way to a small dusk title; the weapon block and HP hide */
.ew-camptop{position:absolute;left:50%;top:1em;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:.45em;white-space:nowrap}
.ewui.ew-camp.ew-hudon .ew-camptop{display:flex}
.ew-camptop b{font-weight:400;font-size:1.1em;letter-spacing:.14em;color:#f7d9a8}
.ew-camptop span{font-size:.58em;letter-spacing:.2em;color:var(--ink2)}
.ewui.ew-camp .ew-top,.ewui.ew-camp .ew-br,.ewui.ew-camp .ew-bl{display:none}
.ew-prompt.camp .ew-key{background:#f6e7a0}
.ew-prompt.camp .ew-ptext{color:#fff3d6}

/* elite name plates (world-projected) */
.ew-plates{position:absolute;inset:0;pointer-events:none}
.ew-plate{position:absolute;left:0;top:0;display:none;flex-direction:column;align-items:center;gap:.22em;transform-origin:50% 100%;will-change:transform}
.ew-plate.on{display:flex}
.ew-plate b{font-weight:400;font-size:.55em;letter-spacing:.14em;color:#f6e7a0;white-space:nowrap}
.ew-plate.hexer b{color:#c9f5a8}
.ew-plate .ew-bar{width:5.2em;height:.42em;box-shadow:0 0 0 var(--p) #b8861f}
.ew-plate .ew-fill{background:linear-gradient(180deg,#f0574b,var(--hp) 55%,#a8221b)}
.ew-plate.hexer .ew-fill{background:linear-gradient(180deg,#a8f07a,#5fbf3a 55%,#2f7a1f)}

/* the shop panels */
.ew-shop .ew-dim{background:radial-gradient(ellipse at 50% 50%,rgba(10,8,6,.5),rgba(4,6,8,.84))}
.ew-spanel{width:34em;max-width:94vw;max-height:94%;display:flex;flex-direction:column;padding:1em 1.2em 1em;background:rgba(17,20,24,.94);border-color:#6b5a44;
  box-shadow:0 0 0 var(--p) var(--line),inset 0 0 0 var(--p) #3a3128,0 1em 2em rgba(0,0,0,.5)}
.ew-shop.on .ew-spanel{animation:ew-cardin .32s cubic-bezier(.2,.9,.25,1.15) both}
.ew-shead{display:flex;align-items:center;gap:.8em;min-height:3.6em}
.ew-portrait{width:3.6em;height:3.6em;flex:none;background-size:100% 100%;image-rendering:pixelated;background-color:#0b0d10;box-shadow:0 0 0 var(--p) #6b5a44,0 0 0 calc(var(--p) * 2) var(--line)}
.ew-shtxt{flex:1;min-width:0;display:flex;flex-direction:column;gap:.45em}
.ew-skick{text-align:left;margin:0;color:#e0b878;letter-spacing:.24em;font-size:.58em}
.ew-say{font-family:'EW Pixelify',monospace;font-size:.68em;line-height:1.3;color:#f3e9d8;word-spacing:.2em}
.ew-say.in{animation:ew-fadein .5s ease both}
.ew-sgold{display:flex;align-items:center;gap:.35em;font-size:.95em;align-self:flex-start;padding:.3em .5em;background:rgba(0,0,0,.35)}
.ew-sgold b{font-weight:400;color:#f6e7a0}
.ew-sgold.bump b{animation:ew-bump .3s ease}
.ew-tabs{display:flex;gap:.35em;margin:.8em 0 .5em;border-bottom:var(--p) solid #3a3128}
.ew-tab{font:inherit;font-size:.62em;letter-spacing:.16em;color:var(--dim);background:#14171b;border:var(--p) solid #3a3128;border-bottom:0;padding:.5em .9em .45em;cursor:var(--ew-cursor-action,pointer)}
.ew-tab.on{color:var(--line);background:#e0b878;border-color:#e0b878;text-shadow:none}
.ew-sbody{display:flex;flex-direction:column;gap:.22em;overflow:auto;min-height:0}
.ew-srow,.ew-crow2{font:inherit;color:inherit;display:grid;grid-template-columns:1.5em 2.1em 6.6em 1fr 4em;align-items:center;column-gap:.5em;text-align:left;
  padding:.32em .45em;background:rgba(255,255,255,.02);border:var(--p) solid transparent;cursor:var(--ew-cursor-action,pointer);transition:background .12s,border-color .12s,transform .12s}
.ew-srow .ew-key,.ew-crow2 .ew-key,.ew-tcard .ew-key{font-size:.55em;min-width:1.7em;height:1.7em}
.ew-srow.sel,.ew-crow2.sel{background:rgba(224,184,120,.12);border-color:#e0b878}
.ew-srow.dis,.ew-crow2.dis{cursor:var(--ew-cursor,default)}
.ew-srow.dis .ew-sicon,.ew-srow.dis .ew-sname,.ew-crow2.dis .ew-sicon{opacity:.5}
.ew-srow.bump,.ew-crow2.bump,.ew-tcard.bump{animation:ew-shopbump .35s ease}
.ew-srow.deny,.ew-crow2.deny,.ew-tcard.deny{animation:ew-deny .3s steps(4)}
.ew-sicon{width:2.1em;height:2.1em;background-size:400% 400%;background-repeat:no-repeat;image-rendering:pixelated;display:flex;align-items:center;justify-content:center;
  font-size:1em;color:var(--dim)}
.ew-sname{font-size:.6em;letter-spacing:.06em;line-height:1.25;display:flex;flex-direction:column;gap:.35em;white-space:nowrap}
.ew-pips{display:flex;gap:.25em}
.ew-pips i{display:block;width:.55em;height:.55em;background:#2a2f34;box-shadow:0 0 0 var(--p) var(--line)}
.ew-pips i.on{background:#f2cf52}
.ew-stext{font-family:'EW Pixelify',monospace;font-size:.6em;line-height:1.25;color:var(--ink2);display:flex;flex-direction:column;gap:.25em;word-spacing:.15em}
.ew-sreason{font-family:'EW Silkscreen',monospace;font-size:.78em;letter-spacing:.1em;color:#e88b7a;word-spacing:0}
.ew-sreason.ok{color:var(--dim)}
.ew-scost{display:flex;align-items:center;justify-content:flex-end;gap:.3em;font-size:.68em;color:#f6e7a0;white-space:nowrap}
.ew-scost.short{color:#e88b7a}
.ew-scost.max{color:var(--cyan);letter-spacing:.12em;font-size:.55em}
.ew-shint{margin-top:.8em}
/* charms */
.ew-cslots{display:flex;align-items:center;gap:.4em;font-size:.55em;letter-spacing:.14em;color:var(--ink2);margin:.1em 0 .5em;flex-wrap:wrap}
.ew-cslots span:first-child{margin-right:.4em}
.ew-cslots em{font-style:normal;font-family:'EW Pixelify',monospace;letter-spacing:.02em;color:var(--dim);margin-left:.5em}
.ew-cslot{width:3.2em;height:3.2em;background:#0e1114;box-shadow:inset 0 0 0 var(--p) #3a3128,0 0 0 var(--p) var(--line);display:flex;align-items:center;justify-content:center}
.ew-cslot.full{box-shadow:inset 0 0 0 var(--p) #e0b878,0 0 0 var(--p) var(--line)}
.ew-cslot.lock{opacity:.45}
.ew-cslot i{display:block;width:2.6em;height:2.6em;background-size:400% 400%;image-rendering:pixelated}
.ew-cslot i.lk{width:1.8em;height:1.8em}
.ew-cgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.3em}
.ew-crow2{grid-template-columns:1.5em 2.1em 1fr;align-items:start;padding:.4em .4em}
.ew-crow2 .ew-cbody{display:flex;flex-direction:column;gap:.35em;min-width:0}
.ew-crow2 .ew-sname{font-size:.52em;white-space:normal;letter-spacing:.03em}
.ew-crow2 .ew-stext{font-size:.55em}
.ew-crow2 .ew-sreason{font-size:.42em}
.ew-crow2.on{background:rgba(224,184,120,.1);box-shadow:inset 0 0 0 var(--p) #b8861f}
.ew-crow2.unk .ew-sname,.ew-crow2.unk .ew-stext{color:var(--dim)}
.ew-crow2.unk .ew-sicon{background:#0e1114;font-size:.9em}
/* the pad panel */
.ew-shop.pad .ew-spanel{width:28em}
.ew-shop.pad .ew-shead{min-height:0}
.ew-shop.pad .ew-skick{font-size:.7em;color:#e0b878}
.ew-tcards{display:flex;gap:.8em;margin-top:.9em}
.ew-tcards.one{justify-content:center}
.ew-tcard{font:inherit;color:inherit;flex:1;max-width:13em;display:flex;flex-direction:column;align-items:center;gap:.5em;padding:.8em .7em .8em;text-align:center;cursor:var(--ew-cursor-action,pointer);
  background:linear-gradient(180deg,#1c1f24,#121418);border:var(--p) solid #3a3128;box-shadow:0 0 0 var(--p) var(--line);transition:border-color .12s,transform .12s}
.ew-tcard.sel{border-color:#e0b878;transform:translateY(-.2em)}
.ew-tcard.obelisk.sel{border-color:#c79bff}
.ew-tcard.dis .ew-ticon{opacity:.55}
.ew-ticon{width:4em;height:4em;background-size:400% 400%;image-rendering:pixelated}
.ew-tname{font-size:.66em;letter-spacing:.06em;display:flex;flex-direction:column;align-items:center;gap:.4em;white-space:nowrap}
.ew-tcard .ew-stext{font-size:.56em;text-align:center}
.ew-tstat{font-family:'EW Pixelify',monospace;font-size:.54em;color:#d9c7a6;word-spacing:.12em}
.ew-tstat.now{color:var(--dim)}
.ew-tcard .ew-scost{font-size:.8em}
.ew-tcard .ew-sreason{font-size:.45em}

/* end cards (DESIGN §9): the story line, gold banked, the coming-soon plate */
.ew-eline{font-family:'EW Pixelify',monospace;font-size:.78em;color:#e7e0d2;margin-top:.7em;opacity:0;word-spacing:.2em}
.ew-end.on .ew-eline{animation:ew-fadein .8s .55s ease both}
.ew-egold{display:flex;align-items:center;gap:.4em;font-size:.62em;letter-spacing:.12em;color:var(--ink2);margin-top:1em;opacity:0;white-space:nowrap}
.ew-egold b{font-weight:400;color:#f6e7a0}
.ew-end.on .ew-egold{animation:ew-rise .6s .85s ease both}
.ew-soon{margin-top:1.2em;padding:.7em 1.2em .75em;background:rgba(8,6,6,.6);box-shadow:0 0 0 var(--p) #6b2a1e,inset 0 0 0 var(--p) #2a1612;display:flex;flex-direction:column;align-items:center;gap:.6em;opacity:0}
.ew-end.on .ew-soon{animation:ew-bin .7s 1.15s cubic-bezier(.2,.9,.25,1.15) both}
.ew-soon b{font-weight:400;font-size:.9em;letter-spacing:.14em;color:#ffb07a;white-space:nowrap}
.ew-soonpips{display:flex;gap:.3em}
.ew-soonpips i{font-style:normal;font-size:.46em;letter-spacing:.06em;min-width:2.4em;padding:.35em .2em;text-align:center;background:#1a1414;color:#5d4a44;box-shadow:0 0 0 var(--p) var(--line)}
.ew-soonpips i.done{background:#a3241a;color:#fff2b8}
.ew-end.coming .ew-etitle{font-size:1.9em;color:#ffd9b0}
.ew-end.coming .ew-dim{background:radial-gradient(ellipse at 50% 50%,rgba(30,8,6,.45),rgba(4,4,6,.86))}
.ew-end.night .ew-moonred b{color:#ff8a7a}

/* the caption of the camp cinemas ("THE DAY PASSES") */
.ew-caption{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);font-size:1.15em;letter-spacing:.3em;color:#f3e9d8;opacity:0;white-space:nowrap;transition:opacity .6s ease;z-index:3}
.ew-caption.on{opacity:1}
.ew-caption i{display:block;font-style:normal;font-family:'EW Pixelify',monospace;font-size:.55em;letter-spacing:.06em;color:var(--ink2);text-align:center;margin-top:.9em}

/* ---- the Organ, BEGIN NIGHT, Pyre Burst ---- */
/* the camp: BEGIN NIGHT (bottom centre), its tip, and the bottom-centre stack above it (toasts, then the E prompt) */
.ew-begin{position:absolute;left:50%;bottom:1.1em;transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:.45em;white-space:nowrap}
.ew-begin.on{display:flex}
.ew-beginbtn{font:inherit;pointer-events:auto;cursor:var(--ew-cursor-action,pointer);display:flex;align-items:center;gap:.5em;padding:.45em .9em .45em .5em;font-size:.9em;letter-spacing:.12em;color:#fff3d6;
  background:linear-gradient(180deg,#5a2a14,#3a180c);border:var(--p) solid #e0b878;box-shadow:0 0 0 var(--p) var(--line),0 calc(var(--p) * 3) 0 #1c0c06,0 0 1.2em rgba(255,154,46,.25);
  animation:ew-beginglow 2.2s ease-in-out infinite}
.ew-beginbtn b{font-weight:400}
.ew-beginbtn .ew-key{font-size:.75em}
.ew-beginbtn:hover{background:linear-gradient(180deg,#74361a,#4a1f10)}
.ew-beginbtn.press{animation:ew-bump .3s ease}
.ew-begintip{font-family:'EW Pixelify',monospace;font-size:.58em;color:var(--ink2);letter-spacing:.02em;word-spacing:.18em;text-shadow:none!important;background:rgba(8,12,15,.6);padding:.2em .6em}
.ewui.ew-camp .ew-toasts{bottom:5.6em}
.ewui.ew-camp .ew-prompt{bottom:27%}
.ewui.ew-camp .ew-hints{display:none}
/* world markers: the lamp's pan and Brother Cinder (screen-projected, bobbing, occluded by the keep) */
.ew-wmark{position:absolute;left:0;top:0;display:none;flex-direction:column;align-items:center;gap:.3em;transform-origin:50% 100%;will-change:transform;pointer-events:none}
.ew-wmark.on{display:flex}
.ew-wbob{animation:ew-bob 1.6s ease-in-out infinite}
.ew-wicon{display:block;width:2.4em;height:2.4em;background-size:400% 400%;image-rendering:pixelated;filter:drop-shadow(0 0 .35em rgba(255,210,120,.55))}
.ew-wmark b{font-weight:400;font-size:.52em;letter-spacing:.14em;color:#f3e9d8;white-space:nowrap}
.ew-wmark.npc{opacity:.78}
.ew-wmark.npc.afford{opacity:1}
.ew-wmark.npc.afford .ew-wicon{filter:drop-shadow(0 0 .5em rgba(255,214,110,.95)) brightness(1.25);animation:ew-afford 1.1s ease-in-out infinite}
.ew-wmark.npc.afford b{color:#ffe08a}
.ew-wmark.pan .ew-wicon{width:2em;height:2em;animation:ew-panpulse 1.2s ease-in-out infinite}
.ew-wmark.pan b{color:#ffd8a8}
/* level-up cards: NEW SKILL (a gold tag) vs UPGRADE · LV n → n+1 (pips) */
.ew-ctag{font-size:.42em;letter-spacing:.2em;margin-bottom:.45em;padding:.3em .55em;white-space:nowrap}
.ew-ctag.new{color:var(--line);background:#f2cf52;box-shadow:0 0 0 var(--p) var(--line);text-shadow:none!important}
.ew-ctag.up{color:var(--cyan);background:rgba(0,0,0,.35)}
.ew-card.skill-new{border-color:#b8861f}
.ew-card.skill-new.sel{border-color:#f2cf52;box-shadow:0 0 0 var(--p) var(--line),inset 0 0 0 var(--p) #8a6a20,0 0 1.2em rgba(242,207,82,.3),0 .6em 0 rgba(0,0,0,.35)}
.ew-cpips{display:flex;gap:.22em;margin:-.15em 0 .45em}
.ew-cpips i{display:block;width:.42em;height:.42em;background:#2a2f34;box-shadow:0 0 0 var(--p) var(--line)}
.ew-cpips i.on{background:var(--cyan)}
.ew-cpips i.next{background:#eafcff;animation:ew-tick .6s steps(2) infinite}
/* the shop: 10-level lines stay compact */
.ew-pips.many{gap:.14em}
.ew-pips.many i{width:.36em;height:.5em}
.ew-shop .ew-srow{padding:.22em .45em;grid-template-columns:1.5em 1.8em 7em 1fr 4.2em}
.ew-shop .ew-srow .ew-sicon{width:1.8em;height:1.8em}
.ew-shop .ew-sbody{gap:.16em}
.ew-srow.organ{background:linear-gradient(90deg,rgba(242,207,82,.08),rgba(255,255,255,.02));box-shadow:inset var(--p) 0 0 #b8861f}
.ew-srow.organ.armed{border-color:#ff9a2e;animation:ew-tick .5s steps(2) infinite}
.ew-srow.swap{background:rgba(164,230,238,.05)}
.ew-sreason.warn{color:#ffb257}
/* the THUNDER ORGAN: a drum count and a heat bar (white → red; it flashes when it overheats) */
.ew-heat{width:7.5em;height:.55em;display:none}
.ew-gauge.organ .ew-heat{display:block}
.ew-gauge.organ .ew-ammo{flex-direction:row-reverse}
.ew-heat .ew-fill{background:linear-gradient(90deg,#d8dde0,#f3e3c0 55%,#ff9a4a)}
.ew-heat.hot .ew-fill{background:linear-gradient(90deg,#f3e3c0,#ff7a2e 60%,#d9342b)}
.ew-heat.over .ew-fill{background:#d9342b;animation:ew-pulse .25s steps(2) infinite}
.ew-gauge.organ{gap:.6em}
@keyframes ew-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.35em)}}
@keyframes ew-afford{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes ew-panpulse{0%,100%{transform:scale(.9);opacity:.75}50%{transform:scale(1.15);opacity:1}}
@keyframes ew-beginglow{0%,100%{box-shadow:0 0 0 var(--p) var(--line),0 calc(var(--p) * 3) 0 #1c0c06,0 0 .6em rgba(255,154,46,.2)}50%{box-shadow:0 0 0 var(--p) var(--line),0 calc(var(--p) * 3) 0 #1c0c06,0 0 1.6em rgba(255,154,46,.5)}}
/* ---- DESIGN §3.4: Hearthblood heals in fire: a warm pulse round the HP bar and a flame beside the number ---- */
.ewui.ew-hearth .ew-hp{box-shadow:0 0 0 var(--p) #ff9a2e,0 0 .9em rgba(255,140,40,.75);animation:ew-hearthglow .9s ease-in-out infinite}
.ewui.ew-hearth .ew-hp .ew-fill{filter:brightness(1.25) saturate(1.1)}
.ewui.ew-hearth .ew-hpnum{color:#ffd68a}
.ewui.ew-hearth .ew-hprow::after{content:'';display:block;align-self:center;margin-left:.35em;width:calc(var(--p) * 6);height:calc(var(--p) * 8);
  background:linear-gradient(180deg,#fff2b8,#ffd24a 35%,#ff9a2e 65%,#e85a1c);clip-path:polygon(50% 0,62% 25%,83% 38%,100% 62%,83% 100%,17% 100%,0 62%,25% 38%,38% 25%);animation:ew-tick .45s steps(2) infinite}
@keyframes ew-hearthglow{0%,100%{box-shadow:0 0 0 var(--p) #ff9a2e,0 0 .5em rgba(255,140,40,.5)}50%{box-shadow:0 0 0 var(--p) #ffd24a,0 0 1.1em rgba(255,170,60,.9)}}
/* ---- DESIGN §8 ---- */
/* the night's title under NIGHT n */
.ew-ntitle{margin-top:.55em;font-size:.95em;letter-spacing:.24em;color:#ffcf9a;white-space:nowrap;opacity:0}
.ew-ntitle.last{color:#9fd8ff;text-shadow:var(--p) 0 0 #0a1a2a,calc(var(--p) * -1) 0 0 #0a1a2a,0 var(--p) 0 #0a1a2a,0 calc(var(--p) * -1) 0 #0a1a2a,0 0 .6em rgba(120,190,255,.5)}
.ew-end.night.on .ew-ntitle{animation:ew-rise .55s .6s ease both}
/* the Rainmother's bar (top centre, under the gate line): phase ticks, the phase name, the crown's lanterns, the climb */
.ew-boss{margin-top:.7em;display:none;flex-direction:column;align-items:center;gap:.3em}
.ew-boss.on{display:flex}
.ew-boss .ew-tname{color:#bfe6ff;letter-spacing:.26em}
.ew-bbar{width:17em;height:.7em}
.ew-bbar .ew-fill{background:linear-gradient(180deg,#9fd8ff,#3f86c8 55%,#1d4f86)}
.ew-boss.cracked .ew-bbar .ew-fill{background:linear-gradient(90deg,#a3241a,#e85a1c 45%,#ffd24a 85%,#fff2b8);animation:ew-pulse .4s steps(2) infinite}
.ew-btick{position:absolute;top:0;bottom:0;width:var(--p);background:var(--line);z-index:3}
.ew-binfo{display:flex;align-items:center;gap:1em;font-size:.55em;letter-spacing:.16em;color:var(--ink2);white-space:nowrap}
.ew-boss.cracked .ew-bphase{color:#ffd68a}
.ew-boss.p3 .ew-bphase{color:#ff9a7a}
.ew-bcrown{display:flex;align-items:center;gap:.3em}
.ew-bcrown span{margin-right:.2em}
.ew-bcrown i{display:block;width:.6em;height:.6em;background:#1c2a36;box-shadow:0 0 0 var(--p) var(--line)}
.ew-bcrown i.on{background:#9fd8ff;box-shadow:0 0 0 var(--p) var(--line),0 0 .4em rgba(159,216,255,.8)}
.ew-bclimb,.ew-coven{display:none;flex-direction:column;align-items:center;gap:.25em;font-size:.55em;letter-spacing:.16em;color:#ffb07a;white-space:nowrap}
.ew-bclimb.on,.ew-coven.on{display:flex}
.ew-bclimb.near span{animation:ew-tick .4s steps(2) infinite;color:#ff6a4a}
.ew-cltrack{width:14em;height:.5em;background:var(--line);padding:var(--p)}
.ew-clfill{width:100%;height:100%;background:linear-gradient(90deg,#ffb07a,#ff5a3a);transform-origin:0 50%;transform:scaleX(0)}
.ew-coven{margin-top:.6em;color:#d9a8ff}
.ew-coven .ew-clfill{background:linear-gradient(90deg,#b46cff,#ff5ad0)}
.ew-rain{display:none;margin-top:.35em;font-size:.55em;letter-spacing:.16em;color:#9fd8ff;white-space:nowrap}
.ew-rain.on{display:block}
/* the Siege Ram plate */
.ew-plate.ram b{color:#ffcf9a}
.ew-plate.ram .ew-fill{background:linear-gradient(180deg,#d9b48a,#8a6640 55%,#5a3e28)}
.ew-crew{display:flex;gap:.15em;margin-top:.1em}
.ew-crew i{display:block;width:.35em;height:.35em;background:#2a2f34;box-shadow:0 0 0 var(--p) var(--line)}
.ew-crew i.on{background:#9db04a}
/* the credits on black, the skip hint, the end card */
.ew-credits{position:absolute;inset:0;z-index:4;background:#030304;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6em;opacity:0;visibility:hidden;transition:opacity .5s,visibility 0s .5s}
.ew-credits.on{opacity:1;visibility:visible;transition:opacity .5s}
.ew-credits .ew-logo{font-size:3.2em;opacity:0}
.ew-credits.on .ew-logo{animation:ew-fadein 1.2s .2s ease both}
.ew-credline{display:flex;flex-direction:column;align-items:center;gap:.5em;opacity:0}
.ew-credits.on .ew-credline{animation:ew-fadein 1s 1.1s ease both}
.ewui.ew-banneron .ew-plate{opacity:0}
.ew-credline span{font-size:.62em;letter-spacing:.42em;color:#a89a8a}
.ew-credline b{font-weight:400;font-size:1.6em;letter-spacing:.3em;color:#f3e9d8}
.ew-skip{position:absolute;right:1.4em;bottom:13%;display:none;align-items:center;gap:.45em;font-size:.6em;letter-spacing:.14em;color:var(--ink2);z-index:5}
.ew-skip.on{display:flex}
.ew-skip .ew-key{font-size:.85em}
.ew-end.ending .ew-dim{background:radial-gradient(ellipse at 50% 50%,rgba(40,6,4,.6),rgba(3,2,2,.92))}
.ew-end.ending .ew-etitle{color:#ff9a6a;font-size:2.6em;text-shadow:var(--p) 0 0 #12090a,calc(var(--p) * -1) 0 0 #12090a,0 var(--p) 0 #12090a,0 calc(var(--p) * -1) 0 #12090a,0 0 .5em rgba(232,90,28,.45)}
.ew-end.ending .ew-eline{color:#e8d8c8}
@keyframes ew-shopbump{0%{transform:none;filter:brightness(1)}30%{transform:translateX(.25em);filter:brightness(1.7)}100%{transform:none;filter:brightness(1)}}
@keyframes ew-deny{0%,100%{transform:none}25%{transform:translateX(-.25em)}75%{transform:translateX(.25em)}}
`;
}
