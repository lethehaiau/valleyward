// @ts-check
// The HUD's stylesheet (one <style> per document). Every class is prefixed `ew-`. Units: the root `.ewui` sets
// `--k` (a pixel-font step: 2 at 720p, 3 at 1080p, 4 at 1440p; half steps between) and its font-size is k × 8 px, so
// 1em = 24 px at 1080p and the pixel fonts stay crisp. Colours follow docs/ART-DIRECTION.md §3 + §8: cool UI, white
// pixel text with a dark outline, the HP bar red, the fuel gauge the only orange, the XP bar thin gold.

/** @param {string} fontsUrl folder URL that holds the woff2 files (ends with '/') */
export function buildCss(fontsUrl) {
  return `
@font-face{font-family:'EW Silkscreen';src:url('${fontsUrl}silkscreen-400-latin.woff2') format('woff2');font-weight:400;font-display:block}
@font-face{font-family:'EW Silkscreen';src:url('${fontsUrl}silkscreen-700-latin.woff2') format('woff2');font-weight:700;font-display:block}
@font-face{font-family:'EW Pixelify';src:url('${fontsUrl}pixelify-sans-latin.woff2') format('woff2');font-weight:400 700;font-display:block}
/* the loading cover's own alias of the same file: font-display swap, so its text shows in a fallback font while the file loads (the HUD keeps block) */
@font-face{font-family:'EW Silkscreen Cover';src:url('${fontsUrl}silkscreen-400-latin.woff2') format('woff2');font-weight:400;font-display:swap}

.ewui{--k:3;--p:calc(var(--k) * 1px);--ink:#f3f5f1;--ink2:#bccbd2;--dim:#7d909b;--line:#0a1115;--slate:rgba(15,23,29,.88);
  --slate2:#22313b;--edge:#4e6573;--edge2:#7d97a5;--hp:#d9342b;--hp2:#8e1a14;--xp:#e9c64b;--xp2:#8f7420;--fuel:#f18b25;--fuel2:#93430c;
  --cyan:#a4e6ee;--cyan2:#3d8f9c;--stone:#c4cdd3;--stone2:#5b6870;--ash:#d8d1c4;
  position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:'EW Silkscreen',ui-monospace,monospace;
  font-size:calc(var(--k) * 8px);line-height:1;color:var(--ink);user-select:none;-webkit-user-select:none;
  -webkit-font-smoothing:none;font-smooth:never;text-rendering:optimizeSpeed;z-index:5}
.ewui *{box-sizing:border-box}
.ewui.ew-noui{display:none!important}
.ew-ts{text-shadow:var(--p) 0 0 var(--line),calc(var(--p) * -1) 0 0 var(--line),0 var(--p) 0 var(--line),0 calc(var(--p) * -1) 0 var(--line),var(--p) var(--p) 0 var(--line),calc(var(--p) * 2) calc(var(--p) * 2) 0 rgba(4,8,10,.55)}
.ew-body{font-family:'EW Pixelify',ui-monospace,monospace}
.ewui .ew-psub,.ewui .ew-bsub,.ewui .ew-sub,.ewui .ew-hint,.ewui .ew-ctl .a,.ewui .ew-csub,.ewui .ew-ctext{word-spacing:.32em}
.ewui .ew-key,.ewui .ew-slot.cur,.ewui .ew-qkey,.ewui .ew-btn.sel,.ewui .ew-style span{text-shadow:none}

/* HUD groups fade in together; each slides from its own edge */
.ew-hud{opacity:0;transition:opacity .45s ease,transform .45s cubic-bezier(.2,.8,.2,1)}
.ewui.ew-hudon .ew-hud{opacity:1;transform:none}
.ew-tl{position:absolute;left:1.1em;top:1em;transform:translateY(-.6em)}

.ew-top{position:absolute;left:50%;top:.9em;width:16em;margin-left:-8em;transform:translateY(-.6em);display:flex;flex-direction:column;align-items:center}
.ew-bl{position:absolute;left:1.1em;bottom:1.1em;transform:translateY(.6em)}
.ew-br{position:absolute;right:1.1em;bottom:1.1em;transform:translateY(.6em);display:flex;flex-direction:column;align-items:flex-end}

/* pixel bars: a dark outline, a slate track, a fill that scales, a 1-step highlight, a chip that trails damage */
.ew-bar{position:relative;height:.62em;background:var(--line);padding:var(--p);
  clip-path:polygon(var(--p) 0,calc(100% - var(--p)) 0,calc(100% - var(--p)) var(--p),100% var(--p),100% calc(100% - var(--p)),calc(100% - var(--p)) calc(100% - var(--p)),calc(100% - var(--p)) 100%,var(--p) 100%,var(--p) calc(100% - var(--p)),0 calc(100% - var(--p)),0 var(--p),var(--p) var(--p))}
.ew-track{position:relative;width:100%;height:100%;background:#1a242b;overflow:hidden}
.ew-fill,.ew-chip{position:absolute;inset:0;transform-origin:0 50%;will-change:transform}
.ew-chip{background:#f3f5f1;opacity:.75}
.ew-fill::after{content:'';position:absolute;left:0;right:0;top:0;height:calc(var(--p) * 2);background:rgba(255,255,255,.32)}
.ew-fill::before{content:'';position:absolute;left:0;right:0;bottom:0;height:calc(var(--p) * 2);background:rgba(0,0,0,.25)}
.ew-flash{position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .12s}
.ew-flash.on{opacity:.85;transition:none}

/* top-left: LV + XP */
.ew-lvrow{display:flex;align-items:center;gap:.45em}
.ew-lv{font-size:1.1em;letter-spacing:.04em;min-width:3.4em;white-space:nowrap}
.ew-lv.bump{animation:ew-bump .45s ease}
.ew-xp{width:11.5em;height:.72em}
.ew-xp .ew-fill{background:linear-gradient(180deg,#f6dc78,var(--xp) 55%,#c39d2c)}
.ew-xp .ew-chip{background:#fff6c8;opacity:.9}
.ew-xp.tick{animation:ew-xptick .28s steps(3) both}
.ew-xp.tick .ew-track{box-shadow:inset 0 0 0 var(--p) rgba(164,230,238,.85)}

/* top-centre: clock, dawn bar, gate, beacon status, troll */
.ew-clock{font-size:1.25em;letter-spacing:.06em;white-space:nowrap;display:flex;gap:.7em}
.ew-clock b{font-weight:400;color:var(--cyan)}
.ew-clock.warn b{animation:ew-tick 1s steps(2) infinite}
.ew-dawn{width:15em;height:.55em;margin-top:.32em}
.ew-dawn .ew-fill{background:linear-gradient(90deg,#3c8794,var(--cyan) 85%,#eafcff)}
.ew-dawn .ew-mark{position:absolute;top:calc(var(--p) * -1);bottom:calc(var(--p) * -1);width:calc(var(--p) * 2);background:var(--line);z-index:2}
.ew-dawn .ew-mark i{position:absolute;left:50%;top:100%;margin:calc(var(--p) * 2) 0 0 calc(var(--p) * -3);width:calc(var(--p) * 6);height:calc(var(--p) * 6);background:var(--ash);
  clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);box-shadow:none}
.ew-row2{display:flex;align-items:center;gap:.4em;margin-top:.55em;font-size:.62em;letter-spacing:.12em;color:var(--ink2);white-space:nowrap}
.ew-gate{width:9.5em;height:.95em}
.ew-gate .ew-fill{background:linear-gradient(180deg,#e7edf0,var(--stone) 60%,#8f9ca4)}
.ew-gate.low .ew-fill{animation:ew-pulse .7s steps(2) infinite}
.ew-gatepct{min-width:3.2em;text-align:left}
.ew-beacon{margin-top:.45em;font-size:.6em;letter-spacing:.14em;color:var(--dim);white-space:nowrap;transition:color .3s}
.ew-beacon.ready{color:var(--cyan)}
.ew-beacon.kindled{color:#f7e7b0}
.ew-beacon.locked{color:#d9a8ff}
.ew-troll{margin-top:.7em;display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(-.4em);transition:opacity .5s,transform .5s}
.ew-troll.on{opacity:1;transform:none}
.ew-tname{font-size:.66em;letter-spacing:.2em;color:var(--ash);white-space:nowrap}
.ew-tname em{font-style:normal;color:#ffd68a;margin-left:.8em;display:none}
.ew-troll.glow .ew-tname em{display:inline;animation:ew-tick .5s steps(2) infinite}
.ew-tbar{width:15em;height:.6em;margin-top:.3em}
.ew-tbar .ew-fill{background:linear-gradient(180deg,#efe9df,var(--ash) 55%,#8d857a);transition:background .25s}
.ew-troll.glow .ew-tbar .ew-fill{background:linear-gradient(90deg,#a3241a,#e85a1c 45%,#ffd24a 85%,#fff2b8)}

/* bottom-left: HP */
.ew-hprow{display:flex;align-items:stretch}
.ew-hpnum{min-width:2.4em;padding:0 .3em;display:flex;align-items:center;justify-content:center;background:var(--line);font-size:1.05em;
  clip-path:polygon(var(--p) 0,100% 0,100% 100%,var(--p) 100%,var(--p) calc(100% - var(--p)),0 calc(100% - var(--p)),0 var(--p),var(--p) var(--p))}
.ew-hp{width:12.5em;height:1.25em}
.ew-hp .ew-fill{background:linear-gradient(180deg,#f0574b,var(--hp) 50%,#a8221b)}
.ew-hpnum.bump{animation:ew-bump .3s ease}
.ewui.ew-low .ew-hp .ew-fill{animation:ew-pulse .6s steps(2) infinite}

/* bottom-right: weapon block */
.ew-extras{display:flex;align-items:center;gap:.9em;margin-bottom:.5em}
.ew-bombs{display:flex;gap:.22em;align-items:center}
.ew-bomb{width:1em;height:1em;background:#2a3036;border:var(--p) solid var(--line);border-radius:50%;position:relative;transition:transform .15s}
.ew-bomb::after{content:'';position:absolute;right:.02em;top:-.28em;width:.2em;height:.3em;background:#9aa5ad;transform:rotate(30deg)}
.ew-bomb.full{background:radial-gradient(circle at 35% 35%,#6a7680,#2c3338 60%)}
.ew-bomb.full::after{background:#f3f5f1}
.ew-bomb.empty{opacity:.35}
.ew-bomb.bump{transform:scale(1.35)}
.ew-bkey{font-size:.6em;color:var(--dim);letter-spacing:.1em;margin-right:.2em}
.ew-sun{display:flex;align-items:center;gap:.35em}
.ew-qkey{font-size:.6em;padding:.25em .4em;background:var(--line);color:var(--dim);transition:color .2s,background .2s}
.ew-sunbar{width:4.6em;height:.55em}
.ew-sunbar .ew-fill{background:linear-gradient(90deg,#5aa9b4,var(--cyan))}
.ew-sun.ready .ew-qkey{color:var(--line);background:var(--cyan);animation:ew-tick .8s steps(2) infinite}
.ew-sun.ready .ew-sunbar .ew-fill{background:#eafcff}
.ew-slots{display:flex;gap:.2em;margin-bottom:.35em;font-size:.6em}
.ew-slot{padding:.25em .45em;background:rgba(10,17,21,.75);color:var(--dim);letter-spacing:.08em}
.ew-slot.cur{background:var(--ink);color:var(--line)}
.ew-slot.lock{opacity:.4}
.ew-wname{font-size:1.15em;letter-spacing:.05em;white-space:nowrap}
.ew-wname.bump{animation:ew-bump .35s ease}
.ew-gauge{margin-top:.3em;display:flex;justify-content:flex-end;align-items:center;min-height:1em}
.ew-fuel{width:10.5em;height:1em;display:none}
.ew-fuel .ew-fill{background:linear-gradient(180deg,#ffb257,var(--fuel) 55%,#c9620f)}
.ew-gauge.lance .ew-fuel{display:block}
.ew-gauge.lance .ew-ammo{display:none}
.ew-fuel.low .ew-fill{animation:ew-pulse .5s steps(2) infinite}
.ew-ammo{display:flex;align-items:center;gap:.5em}
.ew-rounds{display:flex;gap:.16em}
.ew-round{width:.38em;height:.95em;background:#e9e2cf;border:var(--p) solid var(--line);transition:opacity .1s}
.ew-round.shell{width:.6em;background:#b9c4cb}
.ew-round.spent{opacity:.22}
.ew-acount{font-size:.75em;min-width:2.6em;text-align:right;white-space:nowrap}
.ew-reload{position:relative;width:5.4em;height:.5em;display:none}
.ew-gauge.reloading .ew-reload{display:block}
.ew-gauge.reloading .ew-rounds{display:none}
.ew-reload .ew-fill{background:var(--ink)}
.ew-rhint{font-size:.55em;color:var(--dim);letter-spacing:.12em;margin-top:.35em;height:1em;white-space:nowrap}

/* crosshair + hit marker */
.ew-cross{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;transition:opacity .25s}
.ewui.ew-hudon .ew-cross{opacity:1}
.ew-cross i{position:absolute;background:var(--ink);box-shadow:0 0 0 var(--p) rgba(6,10,12,.85);transition:transform .08s}
.ew-cross i:nth-child(1){left:calc(var(--p) * -1);top:calc(var(--p) * -8);width:calc(var(--p) * 2);height:calc(var(--p) * 5)}
.ew-cross i:nth-child(2){left:calc(var(--p) * -1);top:calc(var(--p) * 3);width:calc(var(--p) * 2);height:calc(var(--p) * 5)}
.ew-cross i:nth-child(3){top:calc(var(--p) * -1);left:calc(var(--p) * -8);height:calc(var(--p) * 2);width:calc(var(--p) * 5)}
.ew-cross i:nth-child(4){top:calc(var(--p) * -1);left:calc(var(--p) * 3);height:calc(var(--p) * 2);width:calc(var(--p) * 5)}
.ew-cross.kick i:nth-child(1){transform:translateY(calc(var(--p) * -3))}.ew-cross.kick i:nth-child(2){transform:translateY(calc(var(--p) * 3))}
.ew-cross.kick i:nth-child(3){transform:translateX(calc(var(--p) * -3))}.ew-cross.kick i:nth-child(4){transform:translateX(calc(var(--p) * 3))}
.ew-cross.lance i{opacity:.55}
.ew-hit{position:absolute;left:0;top:0;width:0;height:0;opacity:0;transform:rotate(45deg)}
.ew-hit b{position:absolute;background:var(--cyan);width:calc(var(--p) * 2);height:calc(var(--p) * 4)}
.ew-hit b:nth-child(1){left:calc(var(--p) * -1);top:calc(var(--p) * -9)}.ew-hit b:nth-child(2){left:calc(var(--p) * -1);top:calc(var(--p) * 5)}
.ew-hit b:nth-child(3){top:calc(var(--p) * -1);left:calc(var(--p) * -9);width:calc(var(--p) * 4);height:calc(var(--p) * 2)}.ew-hit b:nth-child(4){top:calc(var(--p) * -1);left:calc(var(--p) * 5);width:calc(var(--p) * 4);height:calc(var(--p) * 2)}
.ew-hit.on{opacity:1;transition:none}
.ew-hit.crit b{background:#fff}
.ew-hit:not(.on){transition:opacity .18s}

/* the beacon prompt (bottom centre, above the hint strip) */
.ew-prompt{position:absolute;left:50%;bottom:22%;transform:translate(-50%,.4em);opacity:0;transition:opacity .25s,transform .25s;
  display:flex;flex-direction:column;align-items:center;gap:.35em;white-space:nowrap}
.ew-prompt.on{opacity:1;transform:translate(-50%,0)}
.ew-pmain{display:flex;align-items:center;gap:.45em;font-size:.85em;letter-spacing:.08em;padding:.42em .7em;background:rgba(10,17,21,.8)}
.ew-key{display:inline-flex;align-items:center;justify-content:center;min-width:1.5em;height:1.5em;padding:0 .3em;background:var(--ink);color:var(--line);
  box-shadow:0 calc(var(--p) * 2) 0 #8ea1ab;font-size:.85em}
.ew-prompt.locked .ew-key{background:#55656e;box-shadow:0 calc(var(--p) * 2) 0 #2c373d}
.ew-prompt.locked .ew-ptext{color:var(--ink2)}
.ew-psub{font-family:'EW Pixelify',monospace;font-size:.62em;color:var(--ink2);letter-spacing:.02em}

/* banners, toasts, subtitles, hint strip */
.ew-banner{position:absolute;left:50%;top:27%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.5em;white-space:nowrap;pointer-events:none}
.ew-btitle{font-weight:400;font-size:1.65em;letter-spacing:.08em;opacity:0}
.ew-bsub{font-family:'EW Pixelify',monospace;font-size:.7em;color:var(--ink2);letter-spacing:.04em;opacity:0}
.ewui.ew-lbon .ew-banner{top:auto;bottom:16%}
.ew-banner.on .ew-btitle{animation:ew-bin .5s cubic-bezier(.2,.9,.25,1.2) both}
.ew-banner.on .ew-bsub{animation:ew-fadein .5s .2s ease both}
.ew-banner.out .ew-btitle,.ew-banner.out .ew-bsub{animation:ew-fadeout .45s ease both}
.ew-banner.lvl .ew-btitle{font-weight:700;font-size:2.3em;color:#eafcff;text-shadow:var(--p) 0 0 #0b2a33,calc(var(--p) * -1) 0 0 #0b2a33,0 var(--p) 0 #0b2a33,0 calc(var(--p) * -1) 0 #0b2a33,0 calc(var(--p) * 4) 0 #2b7f8c,0 calc(var(--p) * 5) 0 #0b2a33}
.ew-banner.kindle .ew-btitle{color:#fff6dc}
.ew-banner.troll .ew-btitle{color:var(--ash)}
/* transient messages: one at a time, in a band above the HUD's bottom edge (between the HP bar and the weapon block),
   never on the crosshair or over the upper-centre action; hidden while a modal is up */
.ew-toasts{position:absolute;left:50%;bottom:3.6em;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;max-width:56%;transition:opacity .2s}
.ew-toast{display:none;flex-direction:column;align-items:center;gap:.4em;padding:.42em .8em .45em;background:rgba(10,17,21,.84);
  box-shadow:0 0 0 var(--p) var(--line),inset 0 calc(var(--p) * -2) 0 rgba(0,0,0,.35);white-space:nowrap}
.ew-toast b{font-weight:400;font-size:.72em;letter-spacing:.1em}
.ew-toast span{font-family:'EW Pixelify',monospace;font-size:.6em;color:var(--ink2);letter-spacing:.03em;word-spacing:.25em;display:none;text-shadow:none}
.ew-toast.two span{display:block}
.ew-toast.on,.ew-toast.out{display:flex}
.ew-toast.on{animation:ew-toastin .26s cubic-bezier(.2,.9,.25,1.2) both}
.ew-toast.out{animation:ew-fadeout .3s ease both}
.ew-toast.cool b{color:var(--cyan)}
.ew-toast.warn b{color:#ffd68a}
.ewui.ew-lbon .ew-toasts,.ewui.ew-modalon .ew-toasts,.ewui.ew-modalon .ew-prompt,.ewui.ew-modalon .ew-banner,.ewui.ew-modalon .ew-sub,.ewui.ew-modalon .ew-hints{visibility:hidden}
.ew-sub{position:absolute;left:50%;bottom:31%;transform:translateX(-50%);max-width:70%;text-align:center;font-family:'EW Pixelify',monospace;font-size:.82em;
  line-height:1.3;padding:.3em .6em;background:rgba(8,13,16,.6);opacity:0;transition:opacity .3s}
.ew-sub.on{opacity:1}
.ew-hints{position:absolute;left:50%;bottom:1.25em;transform:translateX(-50%);display:flex;gap:1em;font-size:.52em;letter-spacing:.1em;color:var(--ink2);
  opacity:0;transition:opacity .6s;white-space:nowrap}
.ewui.ew-hudon .ew-hints.on{opacity:1}
.ew-hints span{display:flex;align-items:center;gap:.4em}
.ew-hints .ew-key{font-size:.95em;min-width:1.6em;height:1.6em}

/* letterbox + fade */
.ew-lb{position:absolute;left:0;right:0;height:11%;background:#05090b;transform:scaleY(0);transition:transform .6s cubic-bezier(.3,.7,.2,1)}
.ew-lb.top{top:0;transform-origin:50% 0}.ew-lb.bot{bottom:0;transform-origin:50% 100%}
.ewui.ew-lbon .ew-lb{transform:scaleY(1)}
.ew-fade{position:absolute;inset:0;background:#05090b;opacity:0;transition-property:opacity;transition-timing-function:ease}

/* modal layer: cards, menu, controls, end cards */
.ew-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s;pointer-events:none}
.ew-modal.on{opacity:1;visibility:visible;transition:opacity .3s;pointer-events:auto}
.ew-dim{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,rgba(6,12,16,.55),rgba(4,8,10,.82))}
.ew-panel{position:relative;background:var(--slate);border:var(--p) solid var(--edge);box-shadow:0 0 0 var(--p) var(--line),inset 0 0 0 var(--p) #33454f,0 1em 2em rgba(0,0,0,.45);padding:1.2em 1.5em}
.ew-ptitle{font-size:1.2em;letter-spacing:.12em;text-align:center}
.ew-pkick{font-size:.55em;letter-spacing:.3em;color:var(--dim);text-align:center;margin-bottom:.6em}
.ew-items{display:flex;flex-direction:column;gap:.3em;margin-top:.9em;min-width:15em}
.ew-item{font:inherit;font-size:.8em;letter-spacing:.1em;color:var(--ink2);background:transparent;border:0;text-align:left;padding:.55em .8em .55em 1.6em;position:relative;cursor:pointer;white-space:nowrap;
  transition:color .15s,background .15s,transform .15s}
.ew-item::before{content:'';position:absolute;left:.6em;top:50%;width:.45em;height:.45em;margin-top:-.225em;background:var(--cyan);transform:scale(0);transition:transform .15s}
.ew-item.sel{color:var(--ink);background:rgba(164,230,238,.1);transform:translateX(.2em)}
.ew-item.sel::before{transform:scale(1)}
.ew-item.confirm{color:#fff}
.ew-item:active{transform:translateX(.2em) scale(.97)}
.ew-style{display:inline-flex;gap:.3em;margin-left:.8em;vertical-align:middle}
.ew-style span{padding:.2em .45em;background:#111a20;color:var(--dim);font-size:.85em}
.ew-style span.on{background:var(--cyan);color:var(--line)}
.ew-hint{margin-top:1em;font-family:'EW Pixelify',monospace;font-size:.6em;color:var(--dim);text-align:center}
.ew-ctl{display:grid;grid-template-columns:auto auto;column-gap:1.4em;row-gap:.42em;margin-top:.9em;font-size:.62em}
.ew-ctl .k{display:flex;gap:.3em;justify-content:flex-end;flex-wrap:nowrap;white-space:nowrap}
.ew-ctl .k .ew-key{font-size:.9em;min-width:1.7em;height:1.7em}
.ew-ctl .a{font-family:'EW Pixelify',monospace;font-size:1.15em;color:var(--ink);display:flex;align-items:center;white-space:nowrap}
.ew-ctl .a i{font-style:normal;color:var(--dim);margin-left:.5em;font-size:.85em}

/* level-up cards */
.ew-cards .ew-dim{background:radial-gradient(ellipse at 50% 55%,rgba(10,30,38,.5),rgba(4,8,10,.8))}
.ew-cwrap{position:relative;display:flex;flex-direction:column;align-items:center}
.ew-chead{font-weight:700;font-size:2em;letter-spacing:.08em;color:#eafcff;margin-bottom:.25em;
  text-shadow:var(--p) 0 0 #0b2a33,calc(var(--p) * -1) 0 0 #0b2a33,0 var(--p) 0 #0b2a33,0 calc(var(--p) * -1) 0 #0b2a33,0 calc(var(--p) * 4) 0 #2b7f8c,0 calc(var(--p) * 5) 0 #0b2a33}
.ew-csub{font-family:'EW Pixelify',monospace;font-size:.68em;color:var(--ink2);margin-bottom:1.1em}
.ew-crow{display:flex;gap:1.1em}
.ew-card{font:inherit;color:inherit;position:relative;width:9.6em;min-height:13em;padding:1em .8em .9em;background:linear-gradient(180deg,#1d2a33,#141e25);border:var(--p) solid var(--edge);
  box-shadow:0 0 0 var(--p) var(--line),inset 0 0 0 var(--p) #2f414c,0 .6em 0 rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:center;cursor:pointer;text-align:center;
  transition:transform .16s,border-color .16s,background .16s,box-shadow .16s}
.ew-cards.on .ew-card{animation:ew-cardin .42s cubic-bezier(.2,.9,.25,1.15) backwards}
.ew-cards.on .ew-card:nth-child(2){animation-delay:.08s}.ew-cards.on .ew-card:nth-child(3){animation-delay:.16s}
.ew-card.sel{border-color:var(--cyan);background:linear-gradient(180deg,#24384a,#16232c);box-shadow:0 0 0 var(--p) var(--line),inset 0 0 0 var(--p) #4a7d88,0 0 1.2em rgba(164,230,238,.25),0 .6em 0 rgba(0,0,0,.35)}
.ew-cards.on .ew-card.sel{transform:translateY(-.35em)}
.ew-card.picked{animation:ew-pick .35s ease both!important}
.ew-card.gone{animation:ew-gone .3s ease both!important}
.ew-cicon{width:4em;height:4em;image-rendering:pixelated;background-repeat:no-repeat;background-size:400% 400%;margin:.2em 0 .7em}
.ew-ckind{font-size:.42em;letter-spacing:.3em;color:var(--dim);margin-bottom:.45em}
.ew-card.unlock .ew-ckind{color:var(--cyan)}
.ew-cname{font-size:.7em;letter-spacing:.06em;line-height:1.2;color:var(--ink);min-height:1.3em}
.ew-ctext{font-family:'EW Pixelify',monospace;font-size:.6em;line-height:1.3;color:var(--ink2);margin-top:.6em;flex:1}
.ew-ckey{margin-top:.8em}
.ew-ckey .ew-key{font-size:.7em}

/* end cards: night (title), dawn, fallen */
.ew-end .ew-dim{background:rgba(4,8,10,.55)}
.ew-endc{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center}
.ew-ekick{font-size:.6em;letter-spacing:.4em;color:var(--ink2);opacity:0}
.ew-etitle{font-weight:400;font-size:2.4em;letter-spacing:.08em;margin-top:.35em;opacity:0;white-space:nowrap}
.ew-erule{width:18em;height:var(--p);margin:.9em 0 .2em;background:linear-gradient(90deg,transparent,var(--edge2),transparent);opacity:0}
.ew-estats{display:grid;grid-template-columns:repeat(5,auto);column-gap:1.6em;margin-top:.9em;opacity:0}
.ew-estats div{display:flex;flex-direction:column;align-items:center;gap:.35em}
.ew-estats b{font-weight:400;font-size:.95em}
.ew-estats span{font-size:.45em;letter-spacing:.24em;color:var(--dim)}
.ew-ebtns{display:flex;gap:.8em;margin-top:1.5em;opacity:0}
.ew-btn{font:inherit;font-size:.72em;letter-spacing:.1em;color:var(--ink2);background:#121b21;border:var(--p) solid var(--edge);box-shadow:0 0 0 var(--p) var(--line),0 calc(var(--p) * 3) 0 #0a1014;
  padding:.65em 1.1em;cursor:pointer;transition:color .15s,background .15s,transform .15s,border-color .15s;white-space:nowrap}
.ew-btn.sel{color:var(--line);background:var(--ink);border-color:var(--ink);transform:translateY(calc(var(--p) * -2))}
.ew-btn:active{transform:translateY(var(--p))}
.ew-end.on .ew-ekick{animation:ew-fadein .6s .1s ease both}
.ew-end.on .ew-etitle{animation:ew-bin .7s .2s cubic-bezier(.2,.9,.25,1.15) both}
.ew-end.on .ew-erule{animation:ew-fadein .6s .5s ease both}
.ew-end.on .ew-estats{animation:ew-rise .6s .7s ease both}
.ew-end.on .ew-ebtns{animation:ew-rise .6s .95s ease both}
.ew-end.night .ew-dim{background:transparent}
.ew-end.night .ew-etitle{font-size:2.6em}
.ew-end.dawn .ew-etitle{color:#f6fbff}
.ew-end.fallen .ew-dim{background:radial-gradient(ellipse at 50% 50%,rgba(20,6,6,.45),rgba(4,4,6,.85))}
.ew-end.fallen .ew-etitle{color:#e8e2dc}

/* the VALLEYWARD wordmark: Silkscreen 700 filled with the fire ramp, a dark pixel outline and a crimson extrusion (two
   layers: the extrusion copy sits behind; drop-shadow draws the outline so the clipped gradient stays clean) */
.ew-logo{position:relative;display:inline-block;font-family:'EW Silkscreen',monospace;font-weight:400;font-size:2.7em;letter-spacing:.06em;line-height:1;white-space:nowrap}
.ew-logo span{display:block}
.ew-logo-t{position:relative;color:transparent;background:linear-gradient(180deg,#fff6cf 0%,#fff2b8 22%,#ffd24a 42%,#ff9a2e 62%,#e85a1c 82%,#a3241a 100%);
  -webkit-background-clip:text;background-clip:text;
  filter:drop-shadow(var(--p) 0 0 #12090a) drop-shadow(calc(var(--p) * -1) 0 0 #12090a) drop-shadow(0 var(--p) 0 #12090a) drop-shadow(0 calc(var(--p) * -1) 0 #12090a)}
.ew-logo-x{position:absolute;left:0;top:0;color:#5c1610;transform:translateY(calc(var(--p) * 4));
  text-shadow:var(--p) 0 0 #12090a,calc(var(--p) * -1) 0 0 #12090a,0 var(--p) 0 #12090a,0 calc(var(--p) * 2) 0 #12090a,0 calc(var(--p) * 5) 0 rgba(0,0,0,.45)}
.ew-nightrow{display:flex;align-items:center;gap:.45em;margin-top:.75em;font-size:1.05em;letter-spacing:.12em;white-space:nowrap;opacity:0}
.ew-nightrow b{font-weight:400;color:var(--cyan)}
.ew-prule{display:block;width:3.4em;height:calc(var(--p) * 2);background:linear-gradient(90deg,transparent,var(--edge2));box-shadow:0 var(--p) 0 var(--line)}
.ew-prule.r{background:linear-gradient(90deg,var(--edge2),transparent)}
.ew-flame{display:block;width:calc(var(--p) * 6);height:calc(var(--p) * 8);background:linear-gradient(180deg,#fff2b8,#ffd24a 35%,#ff9a2e 65%,#e85a1c);
  clip-path:polygon(50% 0,62% 25%,83% 38%,100% 62%,83% 100%,17% 100%,0 62%,25% 38%,38% 25%);filter:drop-shadow(0 var(--p) 0 var(--line))}
.ew-order{margin-top:.9em}
.ew-end.night .ew-logo{opacity:0}
.ew-end.night.on .ew-logo{animation:ew-bin .7s .1s cubic-bezier(.2,.9,.25,1.15) both}
.ew-end.night.on .ew-nightrow{animation:ew-rise .55s .45s ease both}
.ew-end.night.on .ew-order{animation:ew-fadein .6s .8s ease both}
.ew-end.night .ew-endc{padding:1.1em 2em 1.2em;background:radial-gradient(ellipse at 50% 50%,rgba(5,9,11,.62),rgba(5,9,11,0) 70%)}

/* the standalone cover (#loading, the page's markup or ui.titleCover's): the wordmark over a moonlit keep silhouette */
#loading{--k:2.5;--p:calc(var(--k) * 1px);--line:#0a1115;--edge2:#7d97a5;font-family:'EW Silkscreen Cover',ui-monospace,monospace!important;font-size:calc(var(--k) * 8px)!important;
  color:#f3f5f1!important;-webkit-font-smoothing:none;letter-spacing:0!important;
  background:radial-gradient(circle at 62% 70.2%,#fff2b8 0,#ffd24a .45vmin,#ff9a2e .9vmin,rgba(232,90,28,.45) 1.6vmin,rgba(232,90,28,.12) 4vmin,rgba(232,90,28,0) 7vmin),radial-gradient(circle at 74% 26%,rgba(190,240,246,.20) 0,rgba(120,200,212,.10) 9%,rgba(11,28,36,0) 30%),linear-gradient(180deg,#0c2530 0%,#123642 46%,#0e2a33 64%,#071419 100%)!important;overflow:hidden}
@media (min-width:1600px){#loading{--k:3.5}}
#loading::before{content:'';position:absolute;left:74%;top:26%;width:9vmin;height:9vmin;margin:-4.5vmin 0 0 -4.5vmin;border-radius:50%;
  background:radial-gradient(circle at 40% 38%,#eafcff,#bfeff4 55%,#8fd2dc);box-shadow:0 0 6vmin rgba(164,230,238,.35);image-rendering:pixelated}
#loading::after{content:'';position:absolute;left:0;right:0;bottom:0;height:34%;background:#061015;
  clip-path:polygon(0 62%,8% 54%,16% 58%,22% 49%,26% 49%,26% 30%,28% 30%,28% 27%,30% 27%,30% 30%,32% 30%,32% 27%,34% 27%,34% 30%,36% 30%,36% 46%,40% 46%,40% 42%,42% 42%,42% 46%,45% 46%,45% 42%,47% 42%,47% 46%,50% 46%,50% 42%,52% 42%,52% 46%,55% 46%,55% 42%,57% 42%,57% 46%,60% 46%,60% 26%,61.2% 26%,61.2% 14%,62.8% 14%,62.8% 26%,64% 26%,64% 46%,68% 49%,76% 47%,84% 55%,92% 51%,100% 58%,100% 100%,0 100%)}
#loading>div{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;transform:translateY(-6%)}
#loading>div>div:first-child:not(.ew-logo){font-weight:400;font-size:2.7em;letter-spacing:.06em;color:#ffd24a;
  text-shadow:var(--p) 0 0 #12090a,calc(var(--p) * -1) 0 0 #12090a,0 var(--p) 0 #12090a,0 calc(var(--p) * -1) 0 #12090a,0 calc(var(--p) * 4) 0 #5c1610,0 calc(var(--p) * 5) 0 #12090a}
#loading>div>div:last-child{font-size:.62em!important;letter-spacing:.3em!important;margin-top:2.2em!important;opacity:1!important;color:#a4e6ee;animation:ew-blink 1.1s steps(1) infinite}
#loading .ew-coversub{font-family:'EW Pixelify',monospace;font-size:.62em;color:#bccbd2;letter-spacing:.06em;word-spacing:.3em;margin-top:1.6em}
#loading .ew-coverline{margin-top:1.6em!important}
/* the loading bar's step line (index.html): steady, not the title's blinking call to action */
#loading .ld .ld-step{animation:none;font-size:.5em!important;margin-top:1.3em!important;opacity:.9!important}
#loading::marker{content:none}

@keyframes ew-xptick{0%{filter:brightness(1.9)}100%{filter:brightness(1)}}
@keyframes ew-blink{0%,55%{opacity:1}56%,100%{opacity:.25}}
@keyframes ew-bump{0%{transform:scale(1)}35%{transform:scale(1.22)}100%{transform:scale(1)}}
@keyframes ew-pulse{0%{filter:brightness(1)}100%{filter:brightness(1.6)}}
@keyframes ew-tick{0%{opacity:1}100%{opacity:.45}}
@keyframes ew-fadein{from{opacity:0}to{opacity:1}}
@keyframes ew-fadeout{from{opacity:1}to{opacity:0}}
@keyframes ew-rise{from{opacity:0;transform:translateY(.6em)}to{opacity:1;transform:none}}
@keyframes ew-bin{0%{opacity:0;transform:scale(1.5)}60%{opacity:1;transform:scale(.96)}100%{opacity:1;transform:none}}
@keyframes ew-toastin{from{opacity:0;transform:translateY(-.4em)}to{opacity:1;transform:none}}
@keyframes ew-cardin{from{opacity:0;transform:translateY(1.2em) scale(.94)}to{opacity:1;transform:none}}
@keyframes ew-pick{0%{opacity:1;transform:translateY(-.35em)}40%{opacity:1;transform:translateY(-.6em) scale(1.06)}100%{opacity:0;transform:translateY(-1.4em) scale(1.02)}}
@keyframes ew-gone{from{opacity:1}to{opacity:0;transform:translateY(.8em) scale(.96)}}
@media (prefers-reduced-motion: reduce){.ewui *{animation-duration:.01s!important;transition-duration:.01s!important}}
`;
}
