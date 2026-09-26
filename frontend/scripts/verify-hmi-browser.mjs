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
  for (const lang of ['en', 'ja']) {
    for (const width of [1440, 1024, 768, 440, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      const url = new URL(origin);
      url.searchParams.set('lang', lang);
      await send('Page.navigate', { url: url.href });
      await waitFor('document.readyState === "complete" && !!document.querySelector(".leaflet-pane")');
      await screenshot(`${lang}-${width}`);
      const result = await evaluate(`(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const selectors = ['.map-layers', '.map-controls', '.area-controls', '#hmi-map', '.map-attribution'];
        const rectangles = Object.fromEntries(selectors.map((selector) => [selector, rect(selector)]));
        const overlaps = [];
        for (let i = 0; i < selectors.length; i++) for (let j = i + 1; j < selectors.length; j++) {
          const a = rectangles[selectors[i]], b = rectangles[selectors[j]];
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push([selectors[i], selectors[j]]);
        }
        const controls = [...document.querySelectorAll('.hmi-page button, .hmi-page select, .language a, .site-nav a')];
        const small = controls.filter((control) => control.getClientRects().length && control.getBoundingClientRect().height < 43).map((control) => control.textContent.trim().slice(0, 40));
        const clipped = [...document.querySelectorAll('.controls, .map-layers, .map-controls, .area-controls, .detail-card, .coverage')].filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.className);
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, overlaps, small, clipped, rectangles };
      })()`);
      assert.equal(result.overflow, false, `${lang}/${width}: horizontal page overflow`);
      assert.deepEqual(result.overlaps, [], `${lang}/${width}: overlapping controls`);
      assert.deepEqual(result.small, [], `${lang}/${width}: controls below 44px`);
      assert.deepEqual(result.clipped, [], `${lang}/${width}: clipped content`);
      assert.equal(await evaluate('document.querySelector(\".map-wrap .map-layers, .map-wrap .map-controls, .map-wrap .area-controls\") === null'), true, `${lang}/${width}: map controls must stay outside the map canvas`);
      assert.equal(await evaluate('!!document.querySelector(\"select[name=plot]\")'), true, `${lang}/${width}: missing keyboard-accessible plot selector`);
      const targets = await evaluate(`(async () => {
        const blocked = [];
        for (const control of document.querySelectorAll('.map-toolbar button, .area-controls button')) {
          if (control.disabled) continue;
          control.scrollIntoView({block:'center'});
          await new Promise(requestAnimationFrame);
          const r = control.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !control.contains(hit)) blocked.push(control.textContent.trim());
        }
        return blocked;
      })()`);
      assert.deepEqual(targets, [], `${lang}/${width}: controls obscured at their click target`);
      await evaluate('document.querySelector("[data-area-draw]").click()');
      assert.equal(await evaluate('document.querySelector("[data-area-draw]").getAttribute("aria-pressed")'), 'true');
      await evaluate('document.querySelector("[data-area-clear]").click()');
      assert.equal(await evaluate('document.querySelector("[data-area-draw]").getAttribute("aria-pressed")'), 'false');
      assert.equal(await evaluate('document.querySelector("[data-area-run]").disabled'), true);
      console.log(`PASS ${lang} ${width}px: no overlaps, clipping, blocked controls or undersized targets; draw/clear works`);
    }
  }
  assert.deepEqual(errors, [], 'Uncaught browser exceptions');
} finally {
  socket.close();
  await fetch(`${cdpOrigin}/json/close/${target.id}`).catch(() => {});
}
