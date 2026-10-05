#!/usr/bin/env node
// Playwright check for artifact/intake-artifact.html.
// Kept outside the repo's own dependency tree, same as scripts/e2e.test.mjs.
// Run from a folder with Playwright installed:
//   node /path/to/intake_triage/artifact/test-harness.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_HTML = fs.readFileSync(path.join(ROOT, 'artifact', 'intake-artifact.html'), 'utf8');

let failures = 0;
function ok(desc, cond){
  if (cond) { console.log('  PASS  ' + desc); }
  else { console.log('  FAIL  ' + desc); failures++; }
}
function section(name){ console.log('\n== ' + name + ' =='); }

function freePort(){
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

// A minimal document skeleton, wrapping the fragment the same way claude.ai
// wraps a published artifact's own HTML.
function skeleton(){
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${ARTIFACT_HTML}</body></html>`;
}

// ---- fake in-page db/user, matching db.d.ts / user.d.ts semantics we use ----
// ponytail: an in-memory fake scoped to one browser context (one signed-in
// viewer's page load), not a real store. Good enough to prove the page's own
// logic and the access rules it must respect; it is not a db.d.ts conformance
// suite.
function fakeClaudeScript(store, viewer){
  // store: { requests: {uid: {items:[...]}} , triage: {key: {...}} } (shared,
  // JSON-serialiable object injected via addInitScript per test, read/written
  // through window.__store for real cross-reload persistence within one test).
  return `
    window.__viewer = ${JSON.stringify(viewer)};
    window.__store = ${JSON.stringify(store)};
    (function(){
      function clone(x){ return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
      function requireLevel(level){
        var order = { view: 0, interact: 1, admin: 2, owner: 3 };
        return order[window.__viewer.level] >= order[level];
      }
      function docRef(path){
        var parts = path.split('/');
        return {
          id: parts[parts.length-1],
          path: path,
          get: function(){
            var d = window.__store._docs[path];
            return Promise.resolve({ exists: !!d, data: function(){ return d ? clone(d) : undefined; } });
          },
          set: function(data){
            if(!window.__viewer.id) return Promise.reject({code:'invalid_argument', message:'no viewer'});
            if(!checkWrite(path)) return Promise.reject({code:'invalid_argument', message:'not permitted'});
            window.__store._docs[path] = clone(data);
            fireSubs();
            return Promise.resolve();
          },
          collection: function(sub){ return collRef(path + '/' + sub); }
        };
      }
      function checkRead(path){
        if(path.indexOf('triage') === 0) return requireLevel('admin');
        if(path.indexOf('requests') === 0){
          if(requireLevel('admin')) return true;
          // requests/{self}: own subtree only
          var rest = path.slice('requests/'.length);
          var uid = rest.split('/')[0];
          return uid === window.__viewer.id;
        }
        return requireLevel('view');
      }
      function checkWrite(path){
        if(path.indexOf('triage') === 0) return requireLevel('admin');
        if(path.indexOf('requests') === 0){
          if(requireLevel('admin')) return true;
          var rest = path.slice('requests/'.length);
          var uid = rest.split('/')[0];
          return uid === window.__viewer.id && requireLevel('interact');
        }
        return requireLevel('admin');
      }
      var subs = [];
      function fireSubs(){ subs.forEach(function(s){ s(); }); }
      function collRef(path){
        return {
          path: path,
          onSnapshot: function(next, err){
            function emit(){
              var docs = Object.keys(window.__store._docs)
                .filter(function(p){
                  var parts = p.split('/'); var cparts = path.split('/');
                  return parts.length === cparts.length + 1 && p.indexOf(path + '/') === 0;
                })
                .filter(function(p){ return checkRead(p); })
                .map(function(p){
                  var d = window.__store._docs[p];
                  var id = p.split('/').pop();
                  return { id: id, exists: true, data: function(){ return clone(d); } };
                });
              next({ docs: docs, size: docs.length, empty: docs.length === 0, docChanges: function(){ return []; }, metadata: { fromCache: false, hasPendingWrites: false } });
            }
            subs.push(emit);
            emit();
            return function(){ subs = subs.filter(function(s){ return s !== emit; }); };
          },
          get: function(){
            var docs = Object.keys(window.__store._docs)
              .filter(function(p){
                var parts = p.split('/'); var cparts = path.split('/');
                return parts.length === cparts.length + 1 && p.indexOf(path + '/') === 0;
              })
              .filter(function(p){ return checkRead(p); })
              .map(function(p){
                var d = window.__store._docs[p];
                var id = p.split('/').pop();
                return { id: id, exists: true, data: function(){ return clone(d); } };
              });
            return Promise.resolve({ docs: docs, size: docs.length, empty: docs.length === 0 });
          },
          doc: function(id){ return docRef(path + '/' + (id || Math.random().toString(36).slice(2))); }
        };
      }
      if(!window.__store._docs) window.__store._docs = {};
      var db = {
        doc: function(p){
          if(!checkRead(p) && !checkWrite(p)){
            // reads of an invisible doc behave as non-existent, not an error
          }
          var real = docRef(p);
          var origGet = real.get;
          real.get = function(){
            if(!checkRead(p)) return Promise.resolve({ exists: false, data: function(){ return undefined; } });
            return origGet();
          };
          var origSet = real.set;
          real.set = function(data){
            if(!checkWrite(p)) return Promise.reject({code:'invalid_argument', message:'not permitted'});
            return origSet(data);
          };
          return real;
        },
        collection: function(p){ return collRef(p); }
      };
      var user = window.__viewer.id === null && window.__viewer.signedOut ? null : {
        id: function(){ return Promise.resolve(window.__viewer.id); },
        canEdit: function(){ return Promise.resolve(window.__viewer.level === 'admin'); },
        isOwner: function(){ return Promise.resolve(window.__viewer.level === 'owner'); }
      };
      window.claude = {
        use: function(name){
          if(window.__viewer.noCapabilities) return Promise.resolve(null);
          if(name === 'db') return Promise.resolve(window.__viewer.signedOut ? null : db);
          if(name === 'user') return Promise.resolve(window.__viewer.signedOut ? null : user);
          return Promise.resolve(null);
        }
      };
    })();
  `;
}

function radioLabel(page, name, value){
  return page.locator(`label:has(input[name="${name}"][value="${value}"])`);
}
async function rowValue(page, label){
  return page.evaluate((l) => {
    const dts = Array.from(document.querySelectorAll('#sampleDl dt'));
    const dt = dts.find((d) => d.textContent === l);
    return dt ? dt.nextElementSibling.textContent : null;
  }, label);
}
async function selectRecordByName(page, name){
  await page.locator('#fileList button').filter({ hasText: name }).first().click();
}

async function run(){
  const http = await import('node:http');
  const port = await freePort();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(skeleton());
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch();

  try {
    for (const width of [1280, 375]) {
      section(`Viewport ${width}px — requester: submit success`);
      {
        const store = { _docs: {} };
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(fakeClaudeScript(store, { id: 'u_alice', level: 'interact', signedOut: false }));
        await page.goto(base);

        ok('notes text matches exactly',
          (await page.locator('.notes p').innerText()) === 'Please describe sensitive data rather than pasting verbatim.');

        // required errors (7): name, fn, short, steward, freq, miss, gap
        await page.click('button[type=submit]');
        ok('7 required errors shown when form is empty', (await page.locator('#errs li').count()) === 7);

        const otherCk = page.locator('#srcOtherCk');
        await otherCk.check();
        await page.click('button[type=submit]');
        ok('Other-empty error shown', /Where else the information lives/.test(await page.locator('#errs').innerText()));
        await otherCk.uncheck();

        await page.fill('#name', 'Jordan Lee');
        await page.fill('#fn', 'Tax');
        await page.fill('#short', 'Vendor on-time tracker');
        await page.fill('#steward', 'Jordan Lee');
        await page.fill('#miss', 'We re-check vendor terms by hand every month.');
        await page.fill('#freq', 'Monthly');
        await page.locator('#srcs input[value="NetSuite"]').check();
        await radioLabel(page, 'gap', 'Verify').click();
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
        await page.click('button[type=submit]');
        await page.waitForSelector('#done.show', { timeout: 5000 });
        ok('confirmation panel shows after submit', await page.locator('#done.show').isVisible());

        const docs = await page.evaluate(() => window.__store._docs);
        const doc = docs['requests/u_alice'];
        ok('doc landed at requests/<uid>', !!doc);
        const item = doc && doc.items && doc.items[0];
        ok('decoded payload matches expected object', !!item &&
          item.yourName === 'Jordan Lee' && item.function === 'Tax' &&
          item.shortName === 'Vendor on-time tracker' && item.owner === 'Jordan Lee' &&
          item.whatGoesWrong === 'We re-check vendor terms by hand every month.' &&
          item.frequency === 'Monthly' && item.closestGap === 'We take it on trust' &&
          item.sensitiveData === 'No' && item.systemConnection === 'Yes' && item.systemAccess === 'Read only' &&
          item.formTitle === 'Request Intake' && item.schemaVersion === 1 &&
          item.triage === undefined && typeof item.submittedAt === 'string' && typeof item.id === 'string');

        ok('requester DOM has no triage section', (await page.locator('#triage').count()) === 0);
        ok('requester DOM has no view switcher visible', !(await page.locator('#viewswitch').isVisible()));

        // start another request resets the system follow-up
        await page.click('#another');
        ok('start another request resets the system follow-up', !(await wbFollowup.isVisible()));

        // second submission (sys=No case)
        await page.fill('#name', 'Ada Lovelace');
        await page.fill('#fn', 'Ops');
        await page.fill('#short', 'Second request');
        await page.fill('#steward', 'Ada Lovelace');
        await page.fill('#miss', 'Something else goes wrong.');
        await page.fill('#freq', 'Weekly');
        await radioLabel(page, 'gap', 'Guess').click();
        await radioLabel(page, 'sys', 'No').click();
        await page.click('button[type=submit]');
        await page.waitForSelector('#done.show', { timeout: 5000 });
        const docs2 = await page.evaluate(() => window.__store._docs);
        const item2 = docs2['requests/u_alice'].items[1];
        ok('sys=No payload: systemConnection No, systemAccess empty',
          item2.systemConnection === 'No' && item2.systemAccess === '');

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
        await page.click('button[type=submit]');
        await page.waitForSelector('#done.show', { timeout: 5000 });
        const docs3 = await page.evaluate(() => window.__store._docs);
        const item3 = docs3['requests/u_alice'].items[2];
        ok('sys=Unsure payload: systemConnection Unsure, systemAccess empty',
          item3.systemConnection === 'Unsure' && item3.systemAccess === '');

        await context.close();
      }

      section(`Viewport ${width}px — signed-out path`);
      {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(fakeClaudeScript({ _docs: {} }, { id: null, level: 'view', signedOut: true }));
        await page.goto(base);
        await page.fill('#name', 'No Sign In');
        await page.fill('#fn', 'Ops');
        await page.fill('#short', 'A request');
        await page.fill('#steward', 'No Sign In');
        await page.fill('#miss', 'Something goes wrong.');
        await page.fill('#freq', 'Weekly');
        await radioLabel(page, 'gap', 'See').click();
        await page.click('button[type=submit]');
        await page.waitForSelector('#errs.show');
        ok('signed-out submit shows the sign-in error', /Sign in to claude\.ai to submit\. Nothing was sent\./.test(await page.locator('#errs').innerText()));
        ok('signed-out submit does not show confirmation', !(await page.locator('#done.show').isVisible()));
        await context.close();
      }

      section(`Viewport ${width}px — editor: picker, record, save, isolation`);
      {
        function syntheticItem(id, shortName, systemConnection, systemAccess){
          return {
            id: id, yourName: 'Synthetic', function: 'Ops', shortName: shortName, owner: 'Synthetic',
            whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
            effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
            sensitiveData: 'No', systemConnection: systemConnection, systemAccess: systemAccess,
            submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1
          };
        }
        const store = {
          _docs: {
            'requests/u_alice': { items: [{
              id: 'itm1', yourName: 'Jordan Lee', function: 'Tax', shortName: 'Vendor on-time tracker',
              owner: 'Jordan Lee', whatGoesWrong: 'We re-check vendor terms by hand every month.',
              envisionedSolution: '', cultureFactors: ['Poka yoke'], frequency: 'Monthly', effort: '',
              users: '', informationLivesIn: ['NetSuite'], closestGap: 'We take it on trust',
              sensitiveData: 'No', systemConnection: 'Yes', systemAccess: 'Read only', submittedAt: '2026-09-30T12:00:00.000Z',
              formTitle: 'Request Intake', schemaVersion: 1
            },
            syntheticItem('itm2', 'No case', 'No', ''),
            syntheticItem('itm3', 'Unsure case', 'Unsure', ''),
            syntheticItem('itm4', 'RW case', 'Yes', 'Read and write'),
            syntheticItem('itm5', 'Unsure access case', 'Yes', 'Unsure'),
            syntheticItem('itm6', 'Not given case', '', '')
            ] },
            'requests/u_old': { items: [{
              id: 'itmOld', yourName: 'Synthetic', function: 'Ops', shortName: 'Old shape case', owner: 'Synthetic',
              whatGoesWrong: 'x', envisionedSolution: '', cultureFactors: [], frequency: 'Once',
              effort: '', users: '', informationLivesIn: [], closestGap: 'We take it on trust',
              sensitiveData: 'No', systemAccess: 'Read only',
              submittedAt: '2026-09-30T00:00:00.000Z', formTitle: 'Request Intake', schemaVersion: 1
            }] }
          }
        };
        const editorContext = await browser.newContext({ viewport: { width, height: 900 } });
        const editorPage = await editorContext.newPage();
        await editorPage.addInitScript(fakeClaudeScript(store, { id: 'u_cfo', level: 'admin', signedOut: false }));
        await editorPage.goto(base);

        ok('editor sees the view switcher', await editorPage.locator('#viewswitch').isVisible());
        await editorPage.click('#swTri');
        ok('editor sees the picker', (await editorPage.locator('#fileList button').count()) === 7);
        const pickerText = await editorPage.locator('#fileList').innerText();
        ok('picker shows short name, function, requester, status', /Vendor on-time tracker/.test(pickerText) &&
          /Tax/.test(pickerText) && /Jordan Lee/.test(pickerText) && /Not triaged/.test(pickerText));

        await selectRecordByName(editorPage, 'Vendor on-time tracker');
        await editorPage.waitForFunction(() => document.getElementById('sampleDl').children.length > 0);
        ok('triage record shows all 15 rows', (await editorPage.locator('#sampleDl dt').count()) === 15);
        ok('triage row: sys=Yes + wb=Read only -> "Yes, read only"', (await rowValue(editorPage, 'System access')) === 'Yes, read only');

        await selectRecordByName(editorPage, 'No case');
        ok('triage row: sys=No -> "No"', (await rowValue(editorPage, 'System access')) === 'No');

        await selectRecordByName(editorPage, 'Unsure case');
        ok('triage row: sys=Unsure -> "Unsure"', (await rowValue(editorPage, 'System access')) === 'Unsure');

        await selectRecordByName(editorPage, 'RW case');
        ok('triage row: sys=Yes + wb=Read and write -> "Yes, read and write"', (await rowValue(editorPage, 'System access')) === 'Yes, read and write');

        await selectRecordByName(editorPage, 'Unsure access case');
        ok('triage row: sys=Yes + wb=Unsure -> "Yes, unsure"', (await rowValue(editorPage, 'System access')) === 'Yes, unsure');

        await selectRecordByName(editorPage, 'Not given case');
        ok('triage row: empty systemConnection -> "Not given"', (await rowValue(editorPage, 'System access')) === 'Not given');

        await selectRecordByName(editorPage, 'Old shape case');
        ok('triage row: old shape shows systemAccess as-is', (await rowValue(editorPage, 'System access')) === 'Read only');

        await selectRecordByName(editorPage, 'Vendor on-time tracker');

        await radioLabel(editorPage, 'rd', 'Yes').click();
        await radioLabel(editorPage, 'de', 'Partly').click();
        await radioLabel(editorPage, 'sc', 'Yes').click();
        await radioLabel(editorPage, 'lens-Cost', '1').click();
        await radioLabel(editorPage, 'disp', 'Small rock').click();
        await editorPage.fill('#ddate', '2026-10-03');
        await editorPage.fill('#note', 'Approved for next sprint.');
        await editorPage.click('#saveT');
        await editorPage.waitForFunction(() => document.getElementById('savedMsg').textContent.includes('saved'));
        ok('save outcome shows saved', (await editorPage.locator('#savedMsg').innerText()).includes('saved'));
        const editorDocs = await editorPage.evaluate(() => window.__store._docs);
        ok('triage doc written at triage/<uid>__<itemId>', !!editorDocs['triage/u_alice__itm1'] &&
          editorDocs['triage/u_alice__itm1'].disposition === 'Small rock');
        ok('status tag updates live after save', /Small rock/.test(await editorPage.locator('#fileList').innerText()));
        await editorContext.close();

        // isolation: a second requester cannot read requests/u_alice or triage/*.
        // Seed the fresh page's store with the editor's saved triage doc so the
        // isolation check is against real post-save state, not just the seed.
        const seeded = { _docs: Object.assign({}, editorDocs) };
        const otherContext = await browser.newContext({ viewport: { width, height: 900 } });
        const otherPage = await otherContext.newPage();
        await otherPage.addInitScript(fakeClaudeScript(seeded, { id: 'u_bob', level: 'interact', signedOut: false }));
        await otherPage.goto(base);
        const aliceVisible = await otherPage.evaluate(async () => {
          const db = await window.claude.use('db');
          const snap = await db.doc('requests/u_alice').get();
          return snap.exists;
        });
        ok('requester cannot read another requester\'s subtree', aliceVisible === false);
        const triageVisible = await otherPage.evaluate(async () => {
          const db = await window.claude.use('db');
          const snap = await db.doc('triage/u_alice__itm1').get();
          return snap.exists;
        });
        ok('requester cannot read triage', triageVisible === false);
        ok('requester (non-editor) DOM has no triage section', (await otherPage.locator('#triage').count()) === 0);
        await otherContext.close();
      }

      section(`Viewport ${width}px — layout`);
      {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript(fakeClaudeScript({ _docs: {} }, { id: 'u_x', level: 'admin', signedOut: false }));
        await page.goto(base);
        const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        ok(`no horizontal scroll at ${width}px`, !hasHScroll);
        await context.close();
      }
    }

    section('Empty-state first frame (editor, no requests)');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript(fakeClaudeScript({ _docs: {} }, { id: 'u_cfo2', level: 'admin', signedOut: false }));
      await page.goto(base);
      await page.click('#swTri');
      ok('designed empty state shows "No requests yet"', /No requests yet/.test(await page.locator('#fileList').innerText()));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(1); });
