#!/usr/bin/env node
/* The planning sheet, as a page you can look at.
 *
 *     node tools/sheet-preview.js > /path/to/preview.html
 *
 * Same rule as card-preview.js: the stylesheet and the markup are lifted out of
 * web/index.html rather than retyped, and the step list is produced by calling
 * the shipped renderSteps. A preview drawn by hand is a drawing of what someone
 * remembers the design being.
 *
 * The animation runs here as it runs in the app, because it is the same CSS on
 * the same markup — which is the only way to find out whether a car actually
 * follows the road it was given or drifts off into the margin.
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const css = SRC.slice(SRC.indexOf('<style>') + 7, SRC.indexOf('</style>'));

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

/* Everything from the sheet's own rules to the toasts that follow them. */
const sheetCSS = css.slice(css.indexOf('.sheet{'), css.indexOf('/* ---- toasts'));

/* The sheet's markup, straight out of the page, with the fixed positioning
   undone so several can sit side by side on one screen. */
const markup = SRC.slice(SRC.indexOf('<div class="sheet" id="sheet"'),
                         SRC.indexOf('<div class="pickwrap"'));

/* The facts list and the step renderer both live in the shell block rather
   than the engine, and running that whole block needs a browser. So the two
   are lifted out by text and run on their own — still the shipped source, not
   a copy of it, which is the property that matters. */
const lift = (from, to) => {
  const i = SRC.indexOf(from);
  if (i < 0) throw new Error('missing: ' + from);
  const j = SRC.indexOf(to, i);
  return SRC.slice(i, j + to.length);
};

const shell = vm.createContext({ el: () => stepsBox, console });
let stepsBox = { innerHTML: '', scrollTop: 0, scrollHeight: 0 };
vm.runInContext(lift('const FACTS = [', '];'), shell);
vm.runInContext(lift('function renderSteps(steps){', 'box.scrollTop=box.scrollHeight;\n}'), shell);

const steps = state => {
  stepsBox = { innerHTML: '', scrollTop: 0, scrollHeight: 0 };
  vm.runInContext(`renderSteps(${JSON.stringify(state)})`, shell);
  return stepsBox.innerHTML;
};

const EARLY = [
  { msg: 'Finding the road', state: 'done' },
  { msg: 'Reading the ground under it', state: 'run' },
];
const LATE = [
  { msg: 'Finding the road', state: 'done' },
  { msg: 'Reading the ground under it', state: 'done' },
  { msg: 'Weather along the way', state: 'done' },
  { msg: 'Chargers within reach', state: 'run' },
];

const FACTS = vm.runInContext('FACTS', shell);

const panel = (id, title, note, list, fact) => `
  <figure>
    <figcaption><b>${title}</b><span>${note}</span></figcaption>
    <div class="stage">
      ${markup
        .replace('id="sheet"', `id="sheet-${id}"`)
        .replace('class="sheet"', 'class="sheet on"')
        .replace('<ul class="steps" id="steps"></ul>', `<ul class="steps">${list}</ul>`)
        .replace('<div class="fact" id="fact" hidden>', '<div class="fact">')
        .replace('<p id="fact-text"></p>', `<p>${fact}</p>`)}
    </div>
  </figure>`;

process.stdout.write(`<!doctype html><meta charset="utf-8">
<title>Safar — the planning sheet</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${tokens}
${sheetCSS}
/* preview chrome only, none of this ships */
body{margin:0;padding:28px;background:var(--paper);color:var(--ink);
  font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:19px;margin:0 0 4px}
.sub{color:var(--ink2);font-size:13.5px;margin:0 0 26px}
.grid{display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start}
figure{margin:0;width:min(100%,360px)}
figcaption{font-size:12.5px;color:var(--ink2);margin-bottom:9px}
figcaption b{display:block;color:var(--ink);font-size:13.5px}
.stage{position:relative;min-height:60px}
/* the sheet is fixed to the foot of a phone; here it sits in the flow */
.stage .sheet{position:static;transform:none;max-width:none;
  border:1px solid var(--rule);border-radius:var(--r-l);box-shadow:var(--shadow-2)}
.facts{margin-top:34px;border-top:1px solid var(--rule);padding-top:18px}
.facts ol{color:var(--ink2);font-size:13px;line-height:1.6;padding-left:20px}
.facts li{margin-bottom:7px}
</style>
<h1>The planning sheet</h1>
<p class="sub">Lifted out of web/index.html — same stylesheet, same markup, same renderSteps.
The animation is live; watch the car take the curve and the cell fill.</p>
<div class="grid">
${panel('a', 'Early in the run', 'Two steps in. Road found, terrain still coming.', steps(EARLY), FACTS[0])}
${panel('b', 'Later', 'Chargers are the slow one, so this is the state most drivers see.', steps(LATE), FACTS[4])}
</div>
<div class="facts">
  <p class="sub" style="margin:0 0 10px">All ${FACTS.length} facts, in the order they are written:</p>
  <ol>${FACTS.map(f => `<li>${f}</li>`).join('')}</ol>
</div>
`);
