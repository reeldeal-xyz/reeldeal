import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = process.env.HMI_URL ?? 'http://127.0.0.1:4333/hmi';
const cdpOrigin = `http://127.0.0.1:${process.env.HMI_CDP_PORT ?? '9241'}`;
const target = await fetch(`${cdpOrigin}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timer);
  if (message.error) task.reject(new Error(message.error.message));
  else task.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Browser condition not met: ${expression}`);
}
async function screenshot(name) {
  if (!process.env.HMI_SCREENSHOT_DIR) return;
  await mkdir(process.env.HMI_SCREENSHOT_DIR, { recursive: true });
  await evaluate('window.scrollTo(0, 0)');
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(process.env.HMI_SCREENSHOT_DIR, `${name}.png`), Buffer.from(image.data, 'base64'));
}
try {
  await send('Page.enable');
  await send('Runtime.enable');
  // Eric's map-first HMI (#131 hardening): floating controls must not overlap each other or the attribution,
  // every visible control keeps a 44px target, and the page never scrolls sideways, in English and Japanese.
  for (const lang of ['en', 'ja']) {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [440, 900], [390, 844], [320, 568]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
      const url = new URL(origin);
      url.searchParams.set('lang', lang);
      await send('Page.navigate', { url: url.href });
      await waitFor('document.readyState === "complete" && !!document.querySelector(".leaflet-pane") && document.querySelector(".hmi-page")?.dataset.mapReady === "true"');
      await evaluate('document.documentElement.removeAttribute("data-brand-intro"); document.querySelector(".brand-intro")?.remove(); true');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await screenshot(`${lang}-${width}`);
      const result = await evaluate(`(() => {
        const visible = (node) => node && node.getClientRects().length && node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
        const box = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        const selectors = ['.site-header', '.coast-stack', '.map-tools', '.map-zoom', '.observations-toggle', '.coast-dock', '.leaflet-control-attribution'];
        const present = selectors.filter((selector) => visible(document.querySelector(selector)));
        const overlaps = [];
        for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
          const a = box(document.querySelector(present[i])), b = box(document.querySelector(present[j]));
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([present[i], present[j]]);
        }
        const controls = [...document.querySelectorAll('.hmi-page button, .hmi-page select, .language-switch a')].filter(visible);
        const small = controls.filter((control) => control.getBoundingClientRect().height < 43.5).map((control) => (control.getAttribute('aria-label') || control.textContent).trim().slice(0, 40));
        const clipped = [...document.querySelectorAll('.coast-label, .map-message, .map-tools, .season-picker')].filter(visible).filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.className);
        const offscreen = present.filter((selector) => { const r = box(document.querySelector(selector)); return r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; });
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, overlaps, small, clipped, offscreen };
      })()`);
      assert.equal(result.overflow, false, `${lang}/${width}: horizontal page overflow`);
      assert.deepEqual(result.overlaps, [], `${lang}/${width}: overlapping controls`);
      assert.deepEqual(result.small, [], `${lang}/${width}: controls below 44px`);
      assert.deepEqual(result.clipped, [], `${lang}/${width}: clipped content`);
      assert.deepEqual(result.offscreen, [], `${lang}/${width}: controls outside the viewport`);
      assert.equal(await evaluate('!!document.querySelector("select[name=plot]")'), true, `${lang}/${width}: missing keyboard-accessible plot selector`);
      const targets = await evaluate(`(async () => {
        const blocked = [];
        for (const control of document.querySelectorAll('.map-tools button, .map-zoom button, .observations-toggle, .language-switch a, .plot-picker select, .season-picker button')) {
          if (control.disabled || !control.getClientRects().length) continue;
          const r = control.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !control.contains(hit)) blocked.push((control.getAttribute('aria-label') || control.textContent).trim());
        }
        return blocked;
      })()`);
      assert.deepEqual(targets, [], `${lang}/${width}: controls obscured at their click target`);
      // Each open panel must stay clear of the tool column and the dock.
      for (const shelf of ['layers', 'thresholds', 'area', 'forecast', 'observations']) {
        await evaluate(`document.querySelector('[data-shelf="${shelf}"]').click()`);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const clash = await evaluate(`(() => {
          const panel = document.querySelector('#${shelf}-shelf').getBoundingClientRect();
          const hits = [];
          for (const selector of ['.map-tools', '.coast-dock']) {
            const r = document.querySelector(selector).getBoundingClientRect();
            if (Math.min(panel.right, r.right) - Math.max(panel.left, r.left) > 1 && Math.min(panel.bottom, r.bottom) - Math.max(panel.top, r.top) > 1) hits.push(selector);
          }
          const small = [...document.querySelectorAll('#${shelf}-shelf button, #${shelf}-shelf select, #${shelf}-shelf summary, #${shelf}-shelf .layer-choices label')]
            .filter((node) => node.getClientRects().length && node.getBoundingClientRect().height < 43.5).map((node) => (node.getAttribute('aria-label') || node.textContent).trim().slice(0, 40));
          return { hits, small, overflow: document.querySelector('#${shelf}-shelf').scrollWidth > document.querySelector('#${shelf}-shelf').clientWidth + 1 };
        })()`);
        if (shelf === 'observations') await screenshot(`${lang}-${width}-observations`);
        if (shelf === 'area') await screenshot(`${lang}-${width}-area`);
        assert.deepEqual(clash.hits, [], `${lang}/${width}: ${shelf} panel covers ${clash.hits}`);
        assert.deepEqual(clash.small, [], `${lang}/${width}: ${shelf} panel controls below 44px`);
        assert.equal(clash.overflow, false, `${lang}/${width}: ${shelf} panel scrolls sideways`);
        if (shelf === 'area') {
          await evaluate('document.querySelector("[data-area-draw]").click()');
          assert.equal(await evaluate('document.querySelector("[data-area-draw]").getAttribute("aria-pressed")'), 'true');
          assert.equal(await evaluate('document.querySelector("#hmi-map").classList.contains("drawing")'), true);
          await evaluate('document.querySelector("[data-area-clear]").click()');
          assert.equal(await evaluate('document.querySelector("[data-area-draw]").getAttribute("aria-pressed")'), 'false');
          assert.equal(await evaluate('document.querySelector("[data-area-run]").disabled'), true);
        }
        await evaluate(`document.querySelector('#${shelf}-shelf [data-close-shelf]').click()`);
      }
      console.log(`PASS ${lang} ${width}x${height}: no overlaps, clipping, blocked controls or undersized targets; panels clear; draw/clear works`);
    }
  }
  assert.deepEqual(errors, [], 'Uncaught browser exceptions');
} finally {
  socket.close();
  await fetch(`${cdpOrigin}/json/close/${target.id}`).catch(() => {});
}
