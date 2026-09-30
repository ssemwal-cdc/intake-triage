#!/usr/bin/env node
// Playwright e2e check for the intake/triage static site.
// Kept outside the site's own dependency tree (see README "Check that proves it works").
// Run from a folder with Playwright installed:
//   node /path/to/intake_triage/scripts/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'ssemwal-cdc', REPO = 'intake-submissions', BRANCH = 'main';
const CONFIG_WITH_TOKEN =
  `window.INTAKE_CONFIG = { owner: '${OWNER}', repo: '${REPO}', branch: '${BRANCH}', token: 'test-token' };`;
const CONFIG_NO_TOKEN =
  `window.INTAKE_CONFIG = { owner: '${OWNER}', repo: '${REPO}', branch: '${BRANCH}', token: '' };`;

let failures = 0;
function ok(desc, cond){
  if (cond) { console.log('  PASS  ' + desc); }
  else { console.log('  FAIL  ' + desc); failures++; }
}
function section(name){ console.log('\n== ' + name + ' =='); }

function freePort(exclude){
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => (p === exclude ? freePort(exclude).then(resolve, reject) : resolve(p)));
    });
    srv.on('error', reject);
  });
}

function startServer(port){
  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-m', 'http.server', String(port)], { cwd: ROOT });
    let started = false;
    const onErr = (d) => {
      const s = d.toString();
      if (!started && /Serving HTTP/.test(s)) { started = true; resolve(proc); }
    };
    proc.stderr.on('data', onErr);
    proc.stdout.on('data', onErr);
    proc.on('error', reject);
    setTimeout(() => { if (!started) { started = true; resolve(proc); } }, 1500);
  });
}

// ---- fake GitHub contents API, in-memory per browser context ----
function makeFakeRepo(){
  const files = new Map(); // path -> { sha, b64 }
  let shaCounter = 0;
  function nextSha(){ return 'sha' + (++shaCounter); }
  return { files, nextSha };
}

function utf8FromB64(b64){ return Buffer.from(b64, 'base64').toString('utf8'); }

async function routeGithub(page, repo, { failNextPut = false } = {}){
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const prefix = `/repos/${OWNER}/${REPO}/contents/`;
    const p = decodeURIComponent(url.pathname.slice(prefix.length));
    if (req.method() === 'GET') {
      if (p === 'submissions' || p === 'submissions/') {
        const items = [...repo.files.keys()]
          .filter((k) => k.startsWith('submissions/'))
          .map((k) => ({ name: k.split('/').pop(), path: k, type: 'file' }));
        if (!items.length) return route.fulfill({ status: 404, body: JSON.stringify({ message: 'Not Found' }) });
        return route.fulfill({ status: 200, body: JSON.stringify(items) });
      }
      const f = repo.files.get(p);
      if (!f) return route.fulfill({ status: 404, body: JSON.stringify({ message: 'Not Found' }) });
      return route.fulfill({ status: 200, body: JSON.stringify({ sha: f.sha, content: f.b64, path: p }) });
    }
    if (req.method() === 'PUT') {
      if (failNextPut) {
        return route.fulfill({ status: 500, body: JSON.stringify({ message: 'simulated failure' }) });
      }
      const body = JSON.parse(req.postData() || '{}');
      const existing = repo.files.get(p);
      if (existing && body.sha !== existing.sha) {
        return route.fulfill({ status: 409, body: JSON.stringify({ message: 'sha mismatch' }) });
      }
      const sha = repo.nextSha();
      repo.files.set(p, { sha, b64: body.content });
      return route.fulfill({ status: 200, body: JSON.stringify({ content: { sha, path: p } }) });
    }
    return route.fulfill({ status: 405, body: '{}' });
  });
}

async function withConfig(page, baseUrl, js){
  await page.route('**/assets/config.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: js })
  );
}

// .tile / .radios label / .scale label hide their input (pointer-events:none or an
// overlapping sibling), by design, so the visible label is the clickable target.
function radioLabel(page, name, value){
  return page.locator(`label:has(input[name="${name}"][value="${value}"])`);
}

async function run(){
  const port = await freePort(8000);
  const server = await startServer(port);
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  try {
    for (const width of [1280, 375]) {
      section(`Viewport ${width}px — GitHub token path`);
      const repo = makeFakeRepo();
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await withConfig(page, base, CONFIG_WITH_TOKEN);
      await routeGithub(page, repo);

      // index.html contains no "triage" string
      const indexHtml = await (await fetch(base + '/index.html')).text();
      ok('index.html has no "triage"', !/triage/i.test(indexHtml));

      await page.goto(base + '/index.html');

      // owner copy edit (2026-09-30 ruling)
      ok('missHelp shows the owner-approved copy',
        (await page.locator('#missHelp').innerText()) === 'Tell us the problem as you see it. A rough cost helps, if you know it.');

      // required errors (7): name, fn, short, steward, freq, miss, gap — before anything is filled
      await page.click('button[type=submit]');
      let errItems = await page.locator('#errs li').count();
      ok('7 required errors shown when form is empty', errItems === 7);

      // clicking the "What goes wrong today" label text focuses #miss (real <label for="miss">)
      await page.locator('label[for=miss]').click();
      ok('clicking the miss label focuses #miss', await page.locator('#miss').evaluate((el) => el === document.activeElement));

      // focus ring: mouse click vs keyboard Tab on a radio wrapper (.tile)
      const firstTile = page.locator('.tile').first();
      await firstTile.click();
      const mouseOutline = await firstTile.evaluate((el) => getComputedStyle(el).outlineStyle);
      ok('no focus ring after mouse click on a radio', mouseOutline === 'none');
      await page.locator('#name').focus();
      let kbFocused = false;
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        kbFocused = await firstTile.evaluate((el) => el.matches(':has(input:focus-visible)'));
        if (kbFocused) break;
      }
      const kbOutline = await firstTile.evaluate((el) => getComputedStyle(el).outlineStyle);
      ok('focus ring present after Tab to a radio', kbFocused && kbOutline === 'solid');

      // Other checkbox show/hide/clear
      const otherCk = page.locator('#srcOtherCk');
      const otherInput = page.locator('#srcOther');
      await otherCk.check();
      ok('Other input appears when checked', await otherInput.isVisible());
      await otherInput.fill('Slack DMs');
      await otherCk.uncheck();
      ok('Other input hides when unchecked', !(await otherInput.isVisible()));
      ok('Other input clears when unchecked', (await otherInput.inputValue()) === '');

      // Other-empty error
      await otherCk.check();
      await page.click('button[type=submit]');
      const errText = await page.locator('#errs').innerText();
      ok('Other-empty error shown', /Where else the information lives/.test(errText));
      await otherCk.uncheck();

      // checkbox toggles: culture factor on/off
      const cultureBox = page.locator('#culture input[value="Poka yoke"]');
      await cultureBox.check();
      ok('culture checkbox checks', await cultureBox.isChecked());
      await cultureBox.uncheck();
      ok('culture checkbox unchecks', !(await cultureBox.isChecked()));
      await cultureBox.check();

      // radio switches among gap tiles (Remember is already checked, from the focus-ring step)
      ok('gap radio starts on Remember', await page.locator('input[name=gap][value=Remember]').isChecked());
      await radioLabel(page, 'gap', 'Verify').click();
      ok('gap radio switches selection', await page.locator('input[name=gap][value=Verify]').isChecked());
      ok('gap radio deselects previous', !(await page.locator('input[name=gap][value=Remember]').isChecked()));

      // fill the rest of the required fields, plus the emoji-bearing source
      await page.fill('#name', 'Jordan Lee');
      await page.fill('#fn', 'Tax');
      await page.fill('#short', 'Vendor on-time tracker');
      await page.fill('#steward', 'Jordan Lee');
      await page.fill('#miss', 'We re-check vendor terms by hand every month.');
      await page.fill('#freq', 'Monthly');
      await page.locator('#srcs input[value="On paper 🤨"]').check();
      await page.locator('#srcs input[value="NetSuite"]').check();
      await radioLabel(page, 'sens', 'No').click();
      await radioLabel(page, 'wb', 'Read only').click();

      // submit; button disables while in flight; capture the PUT body
      let putBody = null;
      const putPromise = page.waitForRequest((r) => r.method() === 'PUT' && /\/contents\/submissions\//.test(r.url()));
      await page.click('button[type=submit]');
      const putReq = await putPromise;
      const disabledInFlight = await page.locator('button[type=submit]').isDisabled();
      ok('submit button disables while in flight', disabledInFlight);
      putBody = JSON.parse(putReq.postData());
      const decoded = JSON.parse(utf8FromB64(putBody.content));
      await page.waitForSelector('#done.show', { timeout: 5000 });
      ok('confirmation panel shows after submit', await page.locator('#done.show').isVisible());
      ok('submitted file path matches the naming rule', /^submissions\/\d{4}-\d{2}-\d{2}-vendor-on-time-tracker-[a-z0-9]{6}\.json$/.test(
        decodeURIComponent(putReq.url().split('/contents/')[1])
      ));
      ok('decoded payload matches expected object (incl. emoji)',
        decoded.yourName === 'Jordan Lee' &&
        decoded.function === 'Tax' &&
        decoded.shortName === 'Vendor on-time tracker' &&
        decoded.owner === 'Jordan Lee' &&
        decoded.whatGoesWrong === 'We re-check vendor terms by hand every month.' &&
        decoded.envisionedSolution === '' &&
        Array.isArray(decoded.cultureFactors) && decoded.cultureFactors.includes('Poka yoke') &&
        decoded.frequency === 'Monthly' &&
        decoded.effort === '' && decoded.users === '' &&
        Array.isArray(decoded.informationLivesIn) &&
        decoded.informationLivesIn.includes('On paper \u{1F928}') &&
        decoded.informationLivesIn.includes('NetSuite') &&
        decoded.closestGap === 'We take it on trust' &&
        decoded.sensitiveData === 'No' &&
        decoded.systemAccess === 'Read only' &&
        decoded.formTitle === 'Request Intake' &&
        decoded.schemaVersion === 1 &&
        decoded.triage === null &&
        typeof decoded.submittedAt === 'string'
      );

      // start another request resets the form
      await page.click('#another');
      ok('start another request resets the form', (await page.locator('#name').inputValue()) === '' && await page.locator('#f').isVisible());

      // failed submit keeps answers, shows error, no confirmation
      await page.fill('#name', 'Ada Lovelace');
      await page.fill('#fn', 'Ops');
      await page.fill('#short', 'Second request');
      await page.fill('#steward', 'Ada Lovelace');
      await page.fill('#miss', 'Something else goes wrong.');
      await page.fill('#freq', 'Weekly');
      await radioLabel(page, 'gap', 'Guess').click();
      await routeGithub(page, repo, { failNextPut: true });
      await page.click('button[type=submit]');
      await page.waitForSelector('#errs.show');
      ok('failed submit shows the error box', await page.locator('#errs.show').isVisible());
      ok('failed submit keeps the form answers', (await page.locator('#name').inputValue()) === 'Ada Lovelace');
      ok('failed submit does not show confirmation', !(await page.locator('#done.show').isVisible()));
      await routeGithub(page, repo); // restore normal behaviour

      await context.close();

      // ---- triage: list, open, save, reload ----
      section(`Viewport ${width}px — triage (token path)`);
      const tContext = await browser.newContext({ viewport: { width, height: 900 } });
      const tPage = await tContext.newPage();
      await withConfig(tPage, base, CONFIG_WITH_TOKEN);
      await routeGithub(tPage, repo);
      await tPage.goto(base + '/triage.html');
      await tPage.waitForSelector('#fileList button');
      const listCount = await tPage.locator('#fileList button').count();
      ok('triage lists the submitted file', listCount === 1);
      await tPage.locator('#fileList button').first().click();
      await tPage.waitForFunction(() => document.getElementById('sampleDl').children.length > 0);
      const recordText = await tPage.locator('#sampleDl').innerText();
      ok('triage shows the submission\'s answers', /Vendor on-time tracker/.test(recordText) && /Tax/.test(recordText));

      await radioLabel(tPage, 'rd', 'Yes').click();
      await radioLabel(tPage, 'de', 'Partly').click();
      await radioLabel(tPage, 'sc', 'Yes').click();
      await radioLabel(tPage, 'lens-Cost', '1').click();
      await radioLabel(tPage, 'disp', 'Small rock').click();
      await tPage.fill('#ddate', '2026-10-03');
      await tPage.fill('#note', 'Approved for next sprint.');
      await tPage.click('#saveT');
      await tPage.waitForFunction(() => document.getElementById('savedMsg').textContent.includes('saved'));
      ok('save outcome shows saved', (await tPage.locator('#savedMsg').innerText()).includes('saved'));

      await tPage.reload();
      await tPage.waitForSelector('#fileList button');
      await tPage.locator('#fileList button').first().click();
      await tPage.waitForFunction(() => document.querySelector('input[name=disp]:checked'));
      ok('reload shows the saved disposition', await tPage.locator('input[name=disp][value="Small rock"]').isChecked());
      ok('reload shows the saved fit answers', await tPage.locator('input[name=rd][value=Yes]').isChecked());
      ok('reload shows the saved note', (await tPage.locator('#note').inputValue()) === 'Approved for next sprint.');
      await tContext.close();

      // ---- preview path: empty token ----
      section(`Viewport ${width}px — preview path (empty token)`);
      const pContext = await browser.newContext({ viewport: { width, height: 900 } });
      const pPage = await pContext.newPage();
      await withConfig(pPage, base, CONFIG_NO_TOKEN);
      const logs = [];
      pPage.on('console', (m) => logs.push(m.text()));
      await pPage.goto(base + '/index.html');
      await pPage.fill('#name', 'Preview User');
      await pPage.fill('#fn', 'Ops');
      await pPage.fill('#short', 'Preview request');
      await pPage.fill('#steward', 'Preview User');
      await pPage.fill('#miss', 'Preview problem statement.');
      await pPage.fill('#freq', 'Weekly');
      await radioLabel(pPage, 'gap', 'See').click();
      await pPage.click('button[type=submit]');
      await pPage.waitForSelector('#done.show');
      ok('preview submit logs the payload', logs.some((l) => l.includes('Preview request')));
      ok('preview submit shows the confirmation', await pPage.locator('#done.show').isVisible());
      await pContext.close();

      // ---- empty token off localhost: must reject, never fake a submit ----
      section(`Viewport ${width}px — empty token, non-local host`);
      const npContext = await browser.newContext({ viewport: { width, height: 900 } });
      const npPage = await npContext.newPage();
      // Serve the same static files under a non-local hostname so location.hostname
      // is neither localhost, 127.0.0.1 nor file:.
      await npPage.route('http://intake.example.test/**', async (route) => {
        const u = new URL(route.request().url());
        const res = await fetch(base + u.pathname);
        const body = await res.text();
        route.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'text/html', body });
      });
      await withConfig(npPage, base, CONFIG_NO_TOKEN);
      await npPage.goto('http://intake.example.test/index.html');
      await npPage.fill('#name', 'Off Host User');
      await npPage.fill('#fn', 'Ops');
      await npPage.fill('#short', 'Off host request');
      await npPage.fill('#steward', 'Off Host User');
      await npPage.fill('#miss', 'Off host problem statement.');
      await npPage.fill('#freq', 'Weekly');
      await radioLabel(npPage, 'gap', 'See').click();
      await npPage.click('button[type=submit]');
      await npPage.waitForSelector('#errs.show');
      const npErrText = await npPage.locator('#errs').innerText();
      ok('empty token off localhost shows "not connected" error', /Submissions are not connected\. Nothing was sent\./.test(npErrText));
      ok('empty token off localhost does not show the confirmation', !(await npPage.locator('#done.show').isVisible()));
      await npContext.close();

      const tpContext = await browser.newContext({ viewport: { width, height: 900 } });
      const tpPage = await tpContext.newPage();
      await withConfig(tpPage, base, CONFIG_NO_TOKEN);
      await tpPage.goto(base + '/triage.html');
      ok('triage preview shows the sample record', /Entity-level tax allocation check/.test(await tpPage.locator('#sampleDl').innerText()));
      ok('triage preview says preview only', /Preview only/.test(await tpPage.locator('#savedMsg').innerText()));
      await tpContext.close();
      await pContext.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
