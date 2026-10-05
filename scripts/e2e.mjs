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
function b64FromUtf8(s){ return Buffer.from(s, 'utf8').toString('base64'); }
function injectRecord(repo, path, rec){
  repo.files.set(path, { sha: repo.nextSha(), b64: b64FromUtf8(JSON.stringify(rec, null, 2)) });
}
async function rowValue(page, label){
  return page.evaluate((l) => {
    const dts = Array.from(document.querySelectorAll('#sampleDl dt'));
    const dt = dts.find((d) => d.textContent === l);
    return dt ? dt.nextElementSibling.textContent : null;
  }, label);
}
async function selectRecordByName(page, name){
  await page.locator('#reqBody tr').filter({ hasText: name }).first().click();
}
async function tableRowTexts(page){
  return page.locator('#reqBody tr').evaluateAll((rows) =>
    rows.map((r) => Array.from(r.children).map((td) => td.textContent))
  );
}
async function headerAriaSort(page, col){
  return page.locator(`#reqTable th[data-col="${col}"]`).getAttribute('aria-sort');
}

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
      ok('notes text matches exactly',
        (await page.locator('.notes p').innerText()) === 'Please describe sensitive data rather than pasting verbatim.');

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
      const cultureBox = page.locator('#culture input[value="Poka Yoke"]');
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

      // sys/wb follow-up show/hide/clear (same pattern as the Other fill-in)
      const wbFollowup = page.locator('#wbFollowup');
      ok('system follow-up hidden by default', !(await wbFollowup.isVisible()));
      await radioLabel(page, 'sys', 'No').click();
      ok('system follow-up stays hidden on No', !(await wbFollowup.isVisible()));
      await radioLabel(page, 'sys', 'Yes').click();
      ok('system follow-up shown on Yes', await wbFollowup.isVisible());
      await radioLabel(page, 'wb', 'Read and write').click();
      await radioLabel(page, 'sys', 'No').click();
      ok('system follow-up hidden after switching back to No', !(await wbFollowup.isVisible()));
      ok('system follow-up cleared on No', (await page.locator('input[name=wb]:checked').count()) === 0);
      await radioLabel(page, 'sys', 'Yes').click();
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
        Array.isArray(decoded.cultureFactors) && decoded.cultureFactors.includes('Poka Yoke') &&
        decoded.frequency === 'Monthly' &&
        decoded.effort === '' && decoded.users === '' &&
        Array.isArray(decoded.informationLivesIn) &&
        decoded.informationLivesIn.includes('On paper \u{1F928}') &&
        decoded.informationLivesIn.includes('NetSuite') &&
        decoded.closestGap === 'We take it on trust' &&
        decoded.sensitiveData === 'No' &&
        decoded.systemConnection === 'Yes' &&
        decoded.systemAccess === 'Read only' &&
        decoded.formTitle === "Shivam's PO Box" &&
        decoded.schemaVersion === 1 &&
        decoded.triage === null &&
        typeof decoded.submittedAt === 'string'
      );

      // start another request resets the form
      await page.click('#another');
      ok('start another request resets the form', (await page.locator('#name').inputValue()) === '' && await page.locator('#f').isVisible());
      ok('start another request resets the system follow-up', !(await wbFollowup.isVisible()));

      // failed submit keeps answers, shows error, no confirmation
      await page.fill('#name', 'Ada Lovelace');
      await page.fill('#fn', 'Ops');
      await page.fill('#short', 'Second request');
      await page.fill('#steward', 'Ada Lovelace');
      await page.fill('#miss', 'Something else goes wrong.');
      await page.fill('#freq', 'Weekly');
      await radioLabel(page, 'gap', 'Guess').click();
      await radioLabel(page, 'sys', 'No').click();
      await routeGithub(page, repo, { failNextPut: true });
      await page.click('button[type=submit]');
      await page.waitForSelector('#errs.show');
      ok('failed submit shows the error box', await page.locator('#errs.show').isVisible());
      ok('failed submit keeps the form answers', (await page.locator('#name').inputValue()) === 'Ada Lovelace');
      ok('failed submit does not show confirmation', !(await page.locator('#done.show').isVisible()));
      await routeGithub(page, repo); // restore normal behaviour

      // resubmit (sys=No case): payload carries systemConnection, empty systemAccess
      const putPromise2 = page.waitForRequest((r) => r.method() === 'PUT' && /\/contents\/submissions\//.test(r.url()));
      await page.click('button[type=submit]');
      const putReq2 = await putPromise2;
      const decoded2 = JSON.parse(utf8FromB64(JSON.parse(putReq2.postData()).content));
      ok('sys=No payload: systemConnection No, systemAccess empty',
        decoded2.systemConnection === 'No' && decoded2.systemAccess === '');
      await page.waitForSelector('#done.show', { timeout: 5000 });

      // third submission (sys=Unsure case)
      await page.click('#another');
      await page.fill('#name', 'Sam Rivera');
      await page.fill('#fn', 'Ops');
      await page.fill('#short', 'Third request');
      await page.fill('#steward', 'Sam Rivera');
      await page.fill('#miss', 'A third problem statement.');
      await page.fill('#freq', 'Weekly');
      await radioLabel(page, 'gap', 'See').click();
      await radioLabel(page, 'sys', 'Unsure').click();
      const putPromise3 = page.waitForRequest((r) => r.method() === 'PUT' && /\/contents\/submissions\//.test(r.url()));
      await page.click('button[type=submit]');
      const putReq3 = await putPromise3;
      const decoded3 = JSON.parse(utf8FromB64(JSON.parse(putReq3.postData()).content));
      ok('sys=Unsure payload: systemConnection Unsure, systemAccess empty',
        decoded3.systemConnection === 'Unsure' && decoded3.systemAccess === '');
      await page.waitForSelector('#done.show', { timeout: 5000 });

      // synthetic records to cover the remaining triage-row cases without driving the form
      injectRecord(repo, 'submissions/synthetic-rw.json', {
        yourName: 'Synthetic', shortName: 'RW case', 'function': 'Ops', owner: 'Synthetic',
        whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
        effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
        sensitiveData: 'No', systemConnection: 'Yes', systemAccess: 'Read and write',
        submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1, triage: null
      });
      injectRecord(repo, 'submissions/synthetic-unsure-access.json', {
        yourName: 'Synthetic', shortName: 'Unsure access case', 'function': 'Ops', owner: 'Synthetic',
        whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
        effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
        sensitiveData: 'No', systemConnection: 'Yes', systemAccess: 'Unsure',
        submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1, triage: null
      });
      injectRecord(repo, 'submissions/synthetic-old-shape.json', {
        yourName: 'Synthetic', shortName: 'Old shape case', 'function': 'Ops', owner: 'Synthetic',
        whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
        effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
        sensitiveData: 'No', systemAccess: 'Read only',
        submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1, triage: null
      });
      injectRecord(repo, 'submissions/synthetic-not-given.json', {
        yourName: 'Synthetic', shortName: 'Not given case', 'function': 'Ops', owner: 'Synthetic',
        whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
        effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
        sensitiveData: 'No', systemConnection: '', systemAccess: '',
        submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1, triage: null
      });

      await context.close();

      // ---- triage: requests table — list, filter, sort, search, open, save, reload ----
      section(`Viewport ${width}px — triage (token path)`);
      const tContext = await browser.newContext({ viewport: { width, height: 900 } });
      const tPage = await tContext.newPage();
      await withConfig(tPage, base, CONFIG_WITH_TOKEN);
      await routeGithub(tPage, repo);
      await tPage.goto(base + '/triage.html');
      await tPage.waitForSelector('#reqBody tr');
      const listCount = await tPage.locator('#reqBody tr').count();
      ok('triage table lists every submitted and synthetic request', listCount === 7);
      const pickerHtml = await tPage.locator('#reqBody').innerHTML();
      ok('table shows no raw ".json" filename text', !/\.json/i.test(pickerHtml));
      const pickerText = await tPage.locator('#reqBody').innerText();
      ok('table shows short name, function, requester, date', /Vendor on-time tracker/.test(pickerText) &&
        /Tax/.test(pickerText) && /Jordan Lee/.test(pickerText) && /\d{4}/.test(pickerText));
      ok('table shows "Not triaged" status before any save', /Not triaged/.test(pickerText));
      ok('count text shows "N of M requests"', (await tPage.locator('#reqCount').innerText()) === '7 of 7 requests');
      ok('unscored row shows "—" for lenses and total', (await tableRowTexts(tPage))
        .some((r) => r[5] === '—' && r[9] === '—'));
      ok('default sort is Submitted, newest first', await headerAriaSort(tPage, 'submitted') === 'descending');
      {
        const stamps = await tPage.locator('#reqBody tr').evaluateAll((rows) => rows.map((r) => r.dataset.submitted));
        const sortedDesc = [...stamps].sort().reverse();
        ok('rows are ordered newest submittedAt first', JSON.stringify(stamps) === JSON.stringify(sortedDesc));
      }

      // ---- status filter ----
      await tPage.selectOption('#fStatus', 'Not triaged');
      ok('status filter: All 7 are "Not triaged" before any save', (await tPage.locator('#reqBody tr').count()) === 7);
      await tPage.selectOption('#fStatus', 'Big rock');
      ok('status filter: none match "Big rock" yet', (await tPage.locator('#reqBody tr').count()) === 0);
      ok('filtered-to-nothing message shown', (await tPage.locator('#reqCount').innerText()) === 'No requests match these filters.');
      await tPage.selectOption('#fStatus', '');

      // ---- function filter (case-insensitive dedupe: Tax and Ops only) ----
      const fnOptions = await tPage.locator('#fFunction option').allTextContents();
      ok('function filter lists distinct functions plus All', fnOptions.sort().join(',') === ['All', 'Ops', 'Tax'].join(','));
      await tPage.selectOption('#fFunction', 'Tax');
      ok('function filter: only Tax rows shown', (await tableRowTexts(tPage)).every((r) => r[1] === 'Tax'));
      await tPage.selectOption('#fFunction', '');

      // ---- search (short name, requester, function, what-goes-wrong) ----
      await tPage.fill('#fSearch', 'vendor terms');
      ok('search matches "What goes wrong today"', (await tPage.locator('#reqBody tr').count()) === 1 &&
        /Vendor on-time tracker/.test(await tPage.locator('#reqBody').innerText()));
      await tPage.fill('#fSearch', 'jordan lee');
      ok('search matches requester, case-insensitive', (await tPage.locator('#reqBody tr').count()) === 1);
      await tPage.fill('#fSearch', '');

      // ---- combined filters ----
      await tPage.selectOption('#fFunction', 'Ops');
      await tPage.fill('#fSearch', 'second');
      ok('combined function + search narrows to one row', (await tPage.locator('#reqBody tr').count()) === 1 &&
        /Second request/.test(await tPage.locator('#reqBody').innerText()));
      await tPage.fill('#fSearch', '');
      await tPage.selectOption('#fFunction', '');

      // ---- sort per column type ----
      await tPage.locator('#reqTable th[data-col="short"]').click();
      ok('sort by Request: ascending, aria-sort set', await headerAriaSort(tPage, 'short') === 'ascending');
      {
        const names = (await tableRowTexts(tPage)).map((r) => r[0]);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        ok('sort by Request: alphabetical order', JSON.stringify(names) === JSON.stringify(sorted));
      }
      await tPage.locator('#reqTable th[data-col="short"]').click();
      ok('sort toggles to descending on second click', await headerAriaSort(tPage, 'short') === 'descending');

      await tPage.locator('#reqTable th[data-col="cost"]').click();
      ok('sort by Cost: numeric, "—" sorts last (ascending)', (await tableRowTexts(tPage)).at(-1)[5] === '—');
      await tPage.locator('#reqTable th[data-col="cost"]').click();
      ok('sort by Cost: "—" still sorts last after toggling descending', (await tableRowTexts(tPage)).at(-1)[5] === '—');

      // Enter on a header sorts too
      await tPage.locator('#reqTable th[data-col="function"]').focus();
      await tPage.keyboard.press('Enter');
      ok('Enter on a header sorts it', await headerAriaSort(tPage, 'function') !== 'none');

      // restore default sort for the rest of the flow: switching to a new column
      // starts Submitted newest-first, Request/Function/etc. oldest/A-Z first
      await tPage.locator('#reqTable th[data-col="submitted"]').click();
      ok('switching to Submitted starts newest-first', await headerAriaSort(tPage, 'submitted') === 'descending');

      // ---- row open: click ----
      await selectRecordByName(tPage, 'Vendor on-time tracker');
      await tPage.waitForFunction(() => document.getElementById('sampleDl').children.length > 0);
      const recordText = await tPage.locator('#sampleDl').innerText();
      ok('triage shows the submission\'s answers', /Vendor on-time tracker/.test(recordText) && /Tax/.test(recordText));
      ok('triage record shows all 15 rows', (await tPage.locator('#sampleDl dt').count()) === 15);
      ok('triage row: sys=Yes + wb=Read only -> "Yes, read only"', (await rowValue(tPage, 'System access')) === 'Yes, read only');
      ok('clicked row is marked open', await tPage.locator('#reqBody tr').filter({ hasText: 'Vendor on-time tracker' }).first().getAttribute('aria-current') === 'true');

      // ---- row open: Enter key ----
      await selectRecordByName(tPage, 'Second request');
      const rwRow = tPage.locator('#reqBody tr').filter({ hasText: 'RW case' }).first();
      await rwRow.focus();
      await tPage.keyboard.press('Enter');
      await tPage.waitForFunction(() => /RW case/.test(document.getElementById('sampleDl').innerText));
      ok('Enter on a row opens it', /RW case/.test(await tPage.locator('#sampleDl').innerText()));

      await selectRecordByName(tPage, 'Second request');
      ok('triage row: sys=No -> "No"', (await rowValue(tPage, 'System access')) === 'No');

      await selectRecordByName(tPage, 'Third request');
      ok('triage row: sys=Unsure -> "Unsure"', (await rowValue(tPage, 'System access')) === 'Unsure');

      await selectRecordByName(tPage, 'RW case');
      ok('triage row: sys=Yes + wb=Read and write -> "Yes, read and write"', (await rowValue(tPage, 'System access')) === 'Yes, read and write');

      await selectRecordByName(tPage, 'Unsure access case');
      ok('triage row: sys=Yes + wb=Unsure -> "Yes, unsure"', (await rowValue(tPage, 'System access')) === 'Yes, unsure');

      await selectRecordByName(tPage, 'Old shape case');
      ok('triage row: old shape shows systemAccess as-is', (await rowValue(tPage, 'System access')) === 'Read only');

      await selectRecordByName(tPage, 'Not given case');
      ok('triage row: empty systemConnection -> "Not given"', (await rowValue(tPage, 'System access')) === 'Not given');

      await selectRecordByName(tPage, 'Vendor on-time tracker');

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
      const vendorRow = tPage.locator('#reqBody tr').filter({ hasText: 'Vendor on-time tracker' }).first();
      ok('row status updates in place after save, no reload', /Small rock/.test(await vendorRow.innerText()));
      const vendorCells = await vendorRow.evaluate((r) => Array.from(r.children).map((td) => td.textContent));
      ok('row Cost score updates in place after save', vendorCells[5] === '+1');
      ok('row Total updates in place after save', vendorCells[9] === '+1');

      // now that one row is scored, confirm numeric sort puts it first (desc) and dashes last
      await tPage.locator('#reqTable th[data-col="cost"]').click();
      await tPage.locator('#reqTable th[data-col="cost"]').click();
      ok('sort by Cost descending: the one scored row (+1) sorts first',
        (await tableRowTexts(tPage))[0][5] === '+1');
      ok('sort by Cost descending: unscored rows ("—") still sort last',
        (await tableRowTexts(tPage)).at(-1)[5] === '—');

      await tPage.reload();
      await tPage.waitForSelector('#reqBody tr');
      await selectRecordByName(tPage, 'Vendor on-time tracker');
      await tPage.waitForFunction(() => document.querySelector('input[name=disp]:checked'));
      ok('reload shows the saved disposition', await tPage.locator('input[name=disp][value="Small rock"]').isChecked());
      ok('reload shows the saved fit answers', await tPage.locator('input[name=rd][value=Yes]').isChecked());
      ok('reload shows the saved note', (await tPage.locator('#note').inputValue()) === 'Approved for next sprint.');

      if (width === 375) {
        const scrollWidth = await tPage.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await tPage.evaluate(() => document.documentElement.clientWidth);
        ok('375px: page body never scrolls sideways', scrollWidth <= clientWidth);
        const filtersDirection = await tPage.locator('.reqFilters').evaluate((el) => getComputedStyle(el).flexDirection);
        ok('375px: filters stack (column layout)', filtersDirection === 'column');
        const wrapOverflowX = await tPage.locator('.reqTableWrap').evaluate((el) => getComputedStyle(el).overflowX);
        ok('375px: requests table sits in its own overflow-x:auto container', wrapOverflowX === 'auto');
      }
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
      ok('triage preview count shows "No requests yet."', (await tpPage.locator('#reqCount').innerText()) === 'No requests yet.');
      await tpContext.close();
      await pContext.close();
    }

    // ---- progress rail (index.html only; assets/rail.js + assets/rail.css) ----
    for (const width of [1280, 900, 375]) {
      section(`Viewport ${width}px — progress rail`);
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await withConfig(page, base, CONFIG_NO_TOKEN);
      await page.goto(base + '/index.html');

      const railHeadings = await page.locator('#f .step h2').evaluateAll((els) =>
        els.map((el) => { const c = el.cloneNode(true); c.querySelector('.n')?.remove(); return c.textContent.trim(); })
      );
      const stepButtons = width <= 640 ? page.locator('#progressRail .rail-dot-btn') : page.locator('#progressRail .rail-step');
      ok('rail has 5 steps', await stepButtons.count() === 5);
      if (width > 640) {
        const railLabels = await page.locator('#progressRail .rail-label').allInnerTexts();
        ok('rail step names come from the h2 headings', JSON.stringify(railLabels) === JSON.stringify(railHeadings));
      } else {
        const ariaLabels = await stepButtons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
        ok('rail dot names come from the h2 headings', JSON.stringify(ariaLabels) === JSON.stringify(railHeadings));
      }

      ok('no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (width <= 640) {
        ok('slim top bar shows at this width', await page.locator('#progressRail').evaluate((el) => getComputedStyle(el).position === 'sticky' && el.getBoundingClientRect().top === 0));
        ok('horizontal fill bar is used on the mobile top bar', await page.locator('#progressRail .rail-track').isVisible());
      } else {
        ok('horizontal fill bar is hidden in favor of the vertical timeline', !(await page.locator('#progressRail .rail-track').isVisible()));
        ok('vertical timeline track sits behind the step dots', await page.locator('#progressRail .rail-track-v').isVisible());
      }

      // clicking step 4 scrolls section 4 into view and moves focus to its heading
      await stepButtons.nth(3).click();
      await page.waitForFunction(() => Math.abs(document.getElementById('s4').getBoundingClientRect().top) < 120, { timeout: 3000 }).catch(() => {});
      ok('clicking step 4 scrolls section 4 into view',
        await page.evaluate(() => Math.abs(document.getElementById('s4').getBoundingClientRect().top) < 120));
      ok('clicking step 4 focuses its heading', await page.locator('#s4').evaluate((el) => el === document.activeElement));

      // step buttons never submit the form
      ok('step buttons are type=button', (await page.locator(width <= 640 ? '#progressRail .rail-dot-btn' : '#progressRail .rail-step').evaluateAll((els) => els.every((el) => el.getAttribute('type') === 'button'))));

      // filling each required field raises percent 0 -> 100, ending in "Ready to submit"
      const percentText = () => page.locator('#railPercent').innerText();
      ok('percent starts at 0%', (await percentText()) === '0%');
      await page.fill('#name', 'Rail Tester');
      await page.fill('#fn', 'Ops');
      await page.fill('#short', 'Rail check');
      await page.fill('#steward', 'Rail Tester');
      await page.fill('#miss', 'Testing the rail.');
      await page.fill('#freq', 'Weekly');
      ok('percent below 100 before gap is picked', parseInt(await percentText(), 10) > 0 && parseInt(await percentText(), 10) < 100);
      await radioLabel(page, 'gap', 'See').click();
      ok('percent reaches 100% once all 7 required answers are given', (await percentText()) === '100%');
      ok('"Ready to submit" shown at 100%', (await page.locator('#railStatus').innerText()) === 'Ready to submit');
      if (width > 640) {
        await page.waitForTimeout(300); // let the fill's height transition settle
        const [trackLen, fillLen] = await page.evaluate(() => [
          document.querySelector('#progressRail .rail-track-v').offsetHeight,
          document.querySelector('#progressRail .rail-fill-v').offsetHeight
        ]);
        ok('vertical fill runs the full track height at 100%', trackLen > 0 && Math.abs(fillLen - trackLen) <= 1);
      }

      // scroll-spy marks aria-current on the section in view (checked on the visible
      // representation only: the rail keeps a mirrored, display:none dot/step list in
      // sync for the other breakpoint, and that hidden twin also carries the attribute).
      const visibleCurrentSel = width <= 640 ? '#progressRail .rail-dot-btn[aria-current="step"]' : '#progressRail .rail-step[aria-current="step"]';
      await page.evaluate(() => document.getElementById('s1').scrollIntoView());
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, visibleCurrentSel, { timeout: 3000 }).catch(() => {});
      const currentCount = await page.locator(visibleCurrentSel).count();
      ok('scroll-spy marks exactly one step as aria-current', currentCount === 1);
      ok('scroll-spy current step is step 1 after scrolling to section 1',
        await page.locator(visibleCurrentSel).first().evaluate((el) => /1|About the Request/.test(el.textContent || el.getAttribute('aria-label') || '')));

      // submit and confirm the rail hides, then reappears at 0% after "Start another request"
      await page.click('button[type=submit]');
      await page.waitForSelector('#done.show', { timeout: 5000 });
      ok('rail hides after successful submit', !(await page.locator('#progressRail').isVisible()));
      await page.click('#another');
      await page.waitForTimeout(50);
      ok('rail shows again after "Start another request"', await page.locator('#progressRail').isVisible());
      ok('rail is back at 0% after "Start another request"', (await percentText()) === '0%');

      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
