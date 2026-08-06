#!/usr/bin/env node
/* Renders the charger card in every state it can be in, as a page you can
 * look at.
 *
 *     node tools/card-preview.js > /path/to/preview.html
 *
 * Both the stylesheet and the markup are lifted out of web/index.html — the
 * tokens and .chgpop rules by extraction, the card contents by calling the
 * shipped chgPopHTML. A preview that redraws the design by hand is a drawing
 * of what someone remembers the design being, and it agrees with the app right
 * up until the moment it matters.
 *
 * The one thing it cannot carry across is the typeface: the app pulls Public
 * Sans, Bricolage Grotesque and IBM Plex Mono off a CDN, and a published page
 * is not allowed to. The stack falls back to the system faces, so weights and
 * spacing are right and the letterforms are not.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { loadEngine } = require('./physics-test.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const css = SRC.slice(SRC.indexOf('<style>') + 7, SRC.indexOf('</style>'));

/* Everything the card's own rules lean on: the palette in all three of its
   forms, then the rules themselves. Taken as text so nothing is retyped. */
const block = (startsWith) => {
  const i = css.indexOf(startsWith);
  if (i < 0) throw new Error('missing block: ' + startsWith);
  let depth = 0, j = i;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) { j++; break; }
  }
  return css.slice(i, j);
};
const tokens = [':root{', ':root[data-theme=dark]{', '@media (prefers-color-scheme:dark){']
  .map(block).join('\n');
const cardCSS = css.slice(css.indexOf('/* The card that comes up when a pin is tapped.'),
                          css.indexOf('.mapbox{width:100%'));
/* The panel chrome, so the running order below is shown in the real thing
   rather than in an impression of it. */
const chrome =
  css.slice(css.indexOf('.panel{background:'), css.indexOf('.panel .body > :first-child'))
  + css.slice(css.indexOf('.kpis{display:flex'), css.indexOf('/* jump chips built'));

const env = loadEngine();
const card = (c, stop) => vm.runInContext(
  `chgPopHTML(${JSON.stringify(c).replace(/</g,'\\u003c')}, ${JSON.stringify(stop||null)})`, env);
const keyHTML = vm.runInContext('mapKeyHTML()', env);

const at = (lat, lng) => ({ lat, lng });
const NOW = Date.now();

const STATES = [
  { id:'free', title:'Guns free',
    note:'The strongest thing the map can say. Green pin, green chip, a lit pip per free gun.',
    c:{ name:'Statiq — NH44 Toll Plaza', loc:at(29.1,77.0), kw:60, dc:true, rating:4.2, votes:86,
        detour:2.1, free:2, points:4, asOf:NOW-4*60000, url:'#',
        guns:[{plug:'CCS2',kw:60,count:2,free:1},{plug:'CHAdeMO',kw:50,count:2,free:1}] } },
  { id:'busy', title:'Every gun busy',
    note:'Grey, and every pip dark. Worth showing rather than hiding: it is 20 minutes, not a dead end.',
    c:{ name:'Tata Power — Karnal Bypass', loc:at(29.7,77.0), kw:50, dc:true, rating:3.9, votes:41,
        detour:0.4, free:0, points:3, asOf:NOW-11*60000, url:'#',
        guns:[{plug:'CCS2',kw:50,count:3,free:0}] } },
  { id:'unknown', title:'Nobody reports it',
    note:'Dashed pips, not empty ones — unknown must not be mistaken for none free.',
    c:{ name:'ChargeZone — Ambala Cantt', loc:at(30.3,76.8), kw:120, dc:true, rating:4.6, votes:132,
        detour:5.8, free:null, points:6, url:'#',
        guns:[{plug:'CCS2',kw:120,count:4,free:null},{plug:'CCS2',kw:60,count:2,free:null}] } },
  { id:'dead', title:'Reported out of order',
    note:'Amber chip. The pin is grey like a full site, so the card is where the difference lands.',
    c:{ name:'Jio-bp pulse — Rajpura', loc:at(30.5,76.6), kw:60, dc:true, rating:2.8, votes:19,
        detour:1.2, free:0, points:2, working:false, asOf:NOW-52*60000, url:'#',
        guns:[{plug:'CCS2',kw:60,count:2,free:0}] } },
  { id:'stop', title:'Your own stop',
    note:'The big amber pin. Carries what the plan intends to do here, and the button flips to keeping it.',
    c:{ name:'Zeon — Sundar Nagar', loc:at(31.5,76.9), kw:60, dc:true, rating:4.4, votes:57,
        detour:0.9, free:3, points:4, asOf:NOW-2*60000, url:'#',
        guns:[{plug:'CCS2',kw:60,count:4,free:3}] },
    stop:{ n:2, target:88 } },
  { id:'plain', title:'No gun-level detail',
    note:'Open Charge Map describes the hardware but never who is plugged into it. Said, not implied.',
    c:{ name:'Manali Bus Stand charger', loc:at(32.2,77.1), kw:50, dc:true,
        detour:3.4, free:null, points:2, url:'#', guns:[] } },
];

const road = `
<svg class="mock" viewBox="0 0 420 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="420" height="260" fill="var(--paper)"/>
  <g stroke="var(--rule)" stroke-width="1" opacity=".8">
    ${Array.from({length:9},(_,i)=>`<path d="M0 ${i*32} H420"/>`).join('')}
    ${Array.from({length:14},(_,i)=>`<path d="M${i*32} 0 V260"/>`).join('')}
  </g>
  <path d="M-10 214 C 90 190, 120 120, 205 104 S 330 60, 436 26" fill="none"
        stroke="var(--charge)" stroke-width="5" stroke-linecap="round" opacity=".95"/>
</svg>`;

const page = `<title>EVRoute — the charger card</title>
<style>
${tokens}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:15px/1.55 "Public Sans",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:44px 20px 80px}
h1{font:600 30px/1.15 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.025em;margin:0}
.lede{color:var(--ink2);max-width:62ch;margin:10px 0 0;font-size:15px}
.eyebrow{font:500 10px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink3);margin-bottom:12px}
.grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));margin-top:34px}
figure{margin:0;display:flex;flex-direction:column;gap:0}
.mapbox{position:relative;width:100%;height:260px;overflow:hidden;
  border:1px solid var(--rule);border-radius:var(--r-l);background:var(--paper)}
.mock{position:absolute;inset:0;width:100%;height:100%}
figcaption{padding:12px 3px 0}
figcaption b{display:block;font:600 14px "Public Sans",system-ui,sans-serif}
figcaption span{display:block;color:var(--ink2);font-size:13px;margin-top:3px;max-width:44ch}
.rule{height:1px;background:var(--rule);margin:52px 0 0}
.keybox{margin-top:34px;background:var(--sheet);border:1px solid var(--rule);
  border-radius:var(--r-l);padding:6px 4px 10px;max-width:420px}
${chrome}
${cardCSS}
/* Frozen for the page: a countdown that empties while you read is the one
   behaviour a specimen sheet should not reproduce. */
.chgpop{animation:none}
.chgpop .bar{animation:none;transform:scaleX(.62)}
.mapkey{padding:2px 18px 16px;font-size:12px;color:var(--ink2)}
.mapkey .kr{display:flex;align-items:center;gap:9px;padding:3px 0;line-height:1.45}
.mapkey .kr b{color:var(--ink);font-weight:600}
.mapkey .ks{flex:none;width:26px;display:flex;justify-content:center;align-items:center}
.mapkey .kh{font:500 10px/1.3 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink3);margin:10px 0 3px}
.mapkey .kn{margin:8px 0 0;padding-left:2px;color:var(--ink3);line-height:1.5}
.mapkey .kn strong{color:var(--ink2)}
.h2{font:600 20px/1.2 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 8px}
.orders{display:grid;gap:26px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:26px}
.ohead{font:500 10px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.16em;
  text-transform:uppercase;margin:0 0 10px}
.ohead.was{color:var(--stop)} .ohead.is{color:var(--ok)}
.order{list-style:none;counter-reset:o;margin:0;padding:0;font-size:13.5px}
.order li{counter-increment:o;display:flex;gap:10px;align-items:baseline;
  padding:7px 11px;border-left:2px solid var(--rule);color:var(--ink2);background:var(--sheet)}
.order li::before{content:counter(o);font:500 10px "IBM Plex Mono",ui-monospace,monospace;
  color:var(--ink3);min-width:14px;font-variant-numeric:tabular-nums}
.order li.hit{border-left-color:var(--brand-green);color:var(--ink);font-weight:600}
.order li.fold{color:var(--ink3)}
.order li.fold::after{content:"folded";margin-left:auto;font:500 9px "IBM Plex Mono",ui-monospace,monospace;
  letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.order li.warnrow{border-left-color:var(--warn)}
.order li.grp{counter-increment:none;border-left:0;background:none;color:var(--ink3);
  font:500 10px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;
  padding:14px 0 5px}
.order li.grp::before{content:""}
.demo{margin-top:16px;max-width:520px}
.foot{margin-top:22px;color:var(--ink3);font-size:12.5px;max-width:62ch}
.foot code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--ink2)}
</style>
<div class="wrap">
  <p class="eyebrow">EVRoute · map · every state</p>
  <h1>The card behind a charger pin</h1>
  <p class="lede">Tap a pin on the planned route and this comes up over the map, then clears
  itself after eight seconds unless a finger is on it. Both the stylesheet and the card's
  markup are taken straight out of <code>web/index.html</code>, so what is below is the
  build and not a drawing of it.</p>

  <div class="grid">
    ${STATES.map(s=>`
    <figure>
      <div class="mapbox">${road}<div class="chgpop">${card(s.c, s.stop)}</div></div>
      <figcaption><b>${s.title}</b><span>${s.note}</span></figcaption>
    </figure>`).join('')}
  </div>

  <div class="rule"></div>
  <p class="eyebrow" style="margin-top:34px">and under the map</p>
  <div class="keybox"><div class="mapkey">${keyHTML}</div></div>

  <div class="rule"></div>
  <p class="eyebrow" style="margin-top:34px">the results page</p>
  <h2 class="h2">What comes in what order</h2>
  <p class="lede">Eleven panels used to open at once, every one of them ending in a table,
  with the plan itself six down. The four that answer <em>why</em> rather than <em>what</em>
  fold away now, and the plan comes before the map.</p>
  <div class="orders">
    <div>
      <p class="ohead was">before</p>
      <ol class="order was">
        <li>verdict — nine numbers</li><li>the map</li>
        <li class="warnrow">this is physics, not experience</li>
        <li>drive it — the scrubber</li><li>the road, in section</li>
        <li class="hit">the whole drive — the plan</li>
        <li>where to plug in</li><li>what moved the needle</li>
        <li>energy ledger</li><li>stretch by stretch</li><li>conditions used</li>
      </ol>
    </div>
    <div>
      <p class="ohead is">after</p>
      <ol class="order">
        <li>verdict — four numbers, five folded</li>
        <li class="hit">the whole drive — the plan</li>
        <li>where to plug in</li><li>the map</li>
        <li class="warnrow">this is physics, not experience</li>
        <li>drive it — the scrubber</li>
        <li class="grp">why it comes out that way</li>
        <li>the road, in section</li><li>what moved the needle</li>
        <li class="fold">energy ledger</li><li class="fold">stretch by stretch</li>
        <li class="fold">conditions used</li>
      </ol>
    </div>
  </div>

  <p class="eyebrow" style="margin-top:38px">and the panels themselves</p>
  <div class="demo">
    <div class="subhead"><b>Why it comes out that way</b><span>the working</span></div>
    <section class="panel"><details open>
      <summary class="head"><h2>The road, in section</h2><span class="tag">terrain vs charge</span></summary>
      <div class="body"><p style="color:var(--ink2);font-size:13.5px;margin:0">
        Open by default — the chart is the one piece of working worth seeing unasked.</p></div>
    </details></section>
    <section class="panel"><details>
      <summary class="head"><h2>Energy ledger</h2><span class="tag">14.2 kWh total</span></summary>
      <div class="body"></div>
    </details></section>
    <section class="panel"><details>
      <summary class="head"><h2>Stretch by stretch</h2><span class="tag">where it gets expensive</span></summary>
      <div class="body"></div>
    </details></section>
  </div>

  <p class="foot">Typefaces are the system stack here — the app loads Public Sans,
  Bricolage Grotesque and IBM Plex Mono from a font CDN, which a published page cannot
  reach. Weights, spacing and colour are the real ones; the letterforms are not.</p>
</div>`;

process.stdout.write(page);
