(function(){
  var cfg = window.INTAKE_CONFIG || {};
  var lensBox = document.getElementById('lenses');
  ['Cost','Risk','Time','Benefit'].forEach(function(l){
    var row = document.createElement('div'); row.className='lens';
    var n = document.createElement('span'); n.className='name'; n.id='lens'+l; n.textContent=l;
    var sc = document.createElement('div'); sc.className='scale'; sc.setAttribute('role','radiogroup');
    sc.setAttribute('aria-labelledby','lens'+l);
    [-3,-2,-1,0,1,2,3].forEach(function(v){
      var lab=document.createElement('label'), i=document.createElement('input'), s=document.createElement('span');
      i.type='radio'; i.name='lens-'+l; i.value=v; i.setAttribute('aria-label', l+' '+(v>0?'+'+v:v));
      s.textContent = v>0 ? '+'+v : (v<0 ? '−'+Math.abs(v) : '0');
      lab.appendChild(i); lab.appendChild(s); sc.appendChild(lab);
    });
    row.appendChild(n); row.appendChild(sc); lensBox.appendChild(row);
  });

  var listNote = document.getElementById('listNote');
  var reqCount = document.getElementById('reqCount'), reqBody = document.getElementById('reqBody');
  var fStatus = document.getElementById('fStatus'), fFunction = document.getElementById('fFunction'), fSearch = document.getElementById('fSearch');
  var sampleDl = document.getElementById('sampleDl'), sampleNote = document.getElementById('sampleNote');
  var emptyNote = document.getElementById('emptyNote');
  var terrs = document.getElementById('terrs'), savedMsg = document.getElementById('savedMsg');
  var saveT = document.getElementById('saveT');
  var copySlidePrompt = document.getElementById('copySlidePrompt');
  var slidePromptFallback = document.getElementById('slidePromptFallback');
  var currentPath = null;
  var entries = []; // [{path, rec}], loaded once by refreshList
  var filters = { status: '', fn: '', search: '' };
  var sortCol = 'submitted', sortDir = 'desc';

  var COLUMNS = {
    short: { type: 'text', get: function(e){ return e.rec.shortName || ''; } },
    'function': { type: 'text', get: function(e){ return e.rec['function'] || ''; } },
    requester: { type: 'text', get: function(e){ return e.rec.yourName || ''; } },
    submitted: { type: 'date', get: function(e){ return e.rec.submittedAt || ''; } },
    status: { type: 'text', get: function(e){ return statusOf(e.rec); } },
    cost: { type: 'num', get: function(e){ return lensVal(e.rec, 'Cost'); } },
    risk: { type: 'num', get: function(e){ return lensVal(e.rec, 'Risk'); } },
    time: { type: 'num', get: function(e){ return lensVal(e.rec, 'Time'); } },
    benefit: { type: 'num', get: function(e){ return lensVal(e.rec, 'Benefit'); } },
    total: { type: 'num', get: function(e){ return totalOf(e.rec); } }
  };

  function statusOf(rec){ return (rec.triage && rec.triage.disposition) || 'Not triaged'; }
  function lensVal(rec, l){
    var v = rec.triage && rec.triage.lenses ? rec.triage.lenses[l] : null;
    return (v === null || v === undefined) ? null : v;
  }
  function totalOf(rec){
    var any = false, sum = 0;
    ['Cost','Risk','Time','Benefit'].forEach(function(l){
      var v = lensVal(rec, l);
      if(v !== null){ any = true; sum += v; }
    });
    return any ? sum : null;
  }
  function fmtScore(v){
    if(v === null) return '—';
    return v > 0 ? '+' + v : (v < 0 ? '−' + Math.abs(v) : '0');
  }
  function fmtDateOnly(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  }

  function matchesFilters(e){
    var rec = e.rec;
    if(filters.status && statusOf(rec) !== filters.status) return false;
    if(filters.fn && (rec['function']||'').toLowerCase() !== filters.fn.toLowerCase()) return false;
    if(filters.search){
      var q = filters.search.toLowerCase();
      var hay = [rec.shortName, rec.yourName, rec['function'], rec.whatGoesWrong]
        .map(function(v){ return (v||'').toLowerCase(); }).join(' ');
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function cmpEntries(a, b){
    var def = COLUMNS[sortCol];
    var av = def.get(a), bv = def.get(b);
    if(def.type === 'num'){
      var an = av === null, bn = bv === null;
      if(an && bn) return 0;
      if(an) return 1;
      if(bn) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    if(def.type === 'date'){
      if(av === bv) return 0;
      var r = av < bv ? -1 : 1;
      return sortDir === 'asc' ? r : -r;
    }
    var as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
    if(as === bs) return 0;
    var r2 = as < bs ? -1 : 1;
    return sortDir === 'asc' ? r2 : -r2;
  }

  function populateFunctionFilter(){
    var seen = {}, opts = [];
    entries.forEach(function(e){
      var fn = (e.rec['function']||'').trim();
      if(!fn || seen[fn.toLowerCase()]) return;
      seen[fn.toLowerCase()] = true; opts.push(fn);
    });
    opts.sort(function(a,b){ return a.localeCompare(b, undefined, {sensitivity:'base'}); });
    var current = fFunction.value;
    fFunction.innerHTML = '<option value="">All</option>';
    opts.forEach(function(fn){
      var o = document.createElement('option'); o.value = fn; o.textContent = fn; fFunction.appendChild(o);
    });
    fFunction.value = current && seen[current.toLowerCase()] ? current : '';
  }

  function updateAriaSort(){
    Array.prototype.forEach.call(document.querySelectorAll('#reqTable th[data-col]'), function(th){
      th.setAttribute('aria-sort', th.dataset.col === sortCol ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  function renderTable(){
    reqBody.innerHTML = '';
    if(!entries.length){ reqCount.textContent = 'No requests yet.'; return; }
    var filtered = entries.filter(matchesFilters);
    filtered.sort(cmpEntries);
    if(!filtered.length){ reqCount.textContent = 'No requests match these filters.'; return; }
    reqCount.textContent = filtered.length + ' of ' + entries.length + ' requests';
    filtered.forEach(function(e){
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.dataset.submitted = e.rec.submittedAt || '';
      if(e.path === currentPath) tr.setAttribute('aria-current', 'true');
      function cell(text, numeric){
        var td = document.createElement('td');
        if(numeric) td.className = 'num';
        td.textContent = text;
        tr.appendChild(td);
      }
      cell(e.rec.shortName || e.path);
      cell(e.rec['function'] || 'Not given');
      cell(e.rec.yourName || 'Not given');
      cell(fmtDateOnly(e.rec.submittedAt));
      cell(statusOf(e.rec));
      cell(fmtScore(lensVal(e.rec,'Cost')), true);
      cell(fmtScore(lensVal(e.rec,'Risk')), true);
      cell(fmtScore(lensVal(e.rec,'Time')), true);
      cell(fmtScore(lensVal(e.rec,'Benefit')), true);
      cell(fmtScore(totalOf(e.rec)), true);
      tr.onclick = function(){ selectEntry(e); };
      tr.onkeydown = function(ev){ if(ev.key === 'Enter'){ ev.preventDefault(); selectEntry(e); } };
      reqBody.appendChild(tr);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('#reqTable th[data-col]'), function(th){
    function activate(){
      if(sortCol === th.dataset.col){ sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
      else { sortCol = th.dataset.col; sortDir = sortCol === 'submitted' ? 'desc' : 'asc'; }
      updateAriaSort();
      renderTable();
    }
    th.addEventListener('click', activate);
    th.addEventListener('keydown', function(ev){ if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); activate(); } });
  });
  fStatus.addEventListener('change', function(){ filters.status = fStatus.value; renderTable(); });
  fFunction.addEventListener('change', function(){ filters.fn = fFunction.value; renderTable(); });
  fSearch.addEventListener('input', function(){ filters.search = fSearch.value.trim(); renderTable(); });

  var SAMPLE = {
    yourName: 'Named by requester', shortName: 'Entity-level tax allocation check', 'function': 'Tax',
    owner: 'Named by requester',
    whatGoesWrong: 'We re-check the entity allocation by hand every close, and it is easy to miss a step.',
    envisionedSolution: '', cultureFactors: ['Built to last','Poka yoke'],
    frequency: 'Per project', effort: '', users: '',
    informationLivesIn: ['NetSuite','Excel models',"in someone's head"],
    closestGap: 'We take it on trust',
    sensitiveData: 'Yes', systemConnection: 'Yes', systemAccess: 'Read only',
    submittedAt: '2026-09-30T12:25:00.000Z', triage: null
  };

  function fmtDate(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }

  function orNotGiven(v){
    if(Array.isArray(v)) return v.length ? v.join(', ') : 'Not given';
    return v ? v : 'Not given';
  }

  // "System access" row text. New records carry systemConnection (Yes/No/Unsure) plus
  // systemAccess as the Yes follow-up (Read only/Read and write/Unsure). Old records carry
  // only systemAccess (Read only/Read and write/Neither/Unsure) and show that value as-is.
  function systemAccessText(rec){
    if(rec.systemConnection === undefined) return orNotGiven(rec.systemAccess);
    var sc = rec.systemConnection;
    if(!sc) return 'Not given';
    if(sc === 'No' || sc === 'Unsure') return sc;
    if(sc === 'Yes'){
      var map = {'Read only':'Yes, read only','Read and write':'Yes, read and write','Unsure':'Yes, unsure'};
      return map[rec.systemAccess] || 'Not given';
    }
    return sc;
  }

  function renderRecord(rec){
    var rows = [
      ['Requester', orNotGiven(rec.yourName)],
      ['Request', orNotGiven(rec.shortName)],
      ['From', orNotGiven(rec['function'])],
      ['Owner once built', orNotGiven(rec.owner)],
      ['What goes wrong today', orNotGiven(rec.whatGoesWrong)],
      ['Envisioned solution', orNotGiven(rec.envisionedSolution)],
      ['Culture factors', orNotGiven(rec.cultureFactors)],
      ['Frequency', orNotGiven(rec.frequency)],
      ['Time it takes', orNotGiven(rec.effort)],
      ['Who uses the result', orNotGiven(rec.users)],
      ['Information lives in', orNotGiven(rec.informationLivesIn)],
      ['Closest gap', orNotGiven(rec.closestGap)],
      ['Sensitive data', orNotGiven(rec.sensitiveData)],
      ['System access', systemAccessText(rec)],
      ['Submitted', fmtDate(rec.submittedAt) || 'Not given']
    ];
    if(rec.triage && rec.triage.triagedBy) rows.push(['Triaged by', rec.triage.triagedBy]);
    sampleDl.innerHTML = '';
    rows.forEach(function(r){ var dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=r[0]; dd.textContent=r[1]; sampleDl.appendChild(dt); sampleDl.appendChild(dd); });
  }

  function setRadio(name, value){
    var els = document.querySelectorAll('input[name="'+name+'"]');
    Array.prototype.forEach.call(els, function(el){ el.checked = (value !== undefined && value !== null && el.value === String(value)); });
  }

  function fillTriage(t){
    t = t || {};
    setRadio('rd', t.changesRecurringDecision);
    setRadio('de', t.dataExists);
    setRadio('sc', t.ownerConfirmed);
    ['Cost','Risk','Time','Benefit'].forEach(function(l){
      setRadio('lens-'+l, t.lenses && t.lenses[l] !== undefined ? t.lenses[l] : null);
    });
    setRadio('disp', t.disposition);
    document.getElementById('ddate').value = t.decisionDate || '';
    document.getElementById('rto').value = t.redirectTo || '';
    document.getElementById('tby').value = t.triagedBy || '';
    document.getElementById('note').value = t.note || '';
  }

  function loadSample(){
    renderRecord(SAMPLE);
    sampleNote.textContent = 'Sample record. Submitting the requester form fills this with that submission.';
    fillTriage(null);
    savedMsg.textContent = 'Preview only.';
  }

  copySlidePrompt.onclick = function(){
    if(!currentPath){ terrs.textContent = 'Pick a request first.'; terrs.classList.add('show'); return; }
    var prompt = 'Make the management slide for ' + currentPath;
    function showCopied(){ savedMsg.textContent = 'Copied.'; }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(prompt).then(showCopied, function(){
        slidePromptFallback.value = prompt;
        slidePromptFallback.style.position = 'static';
        slidePromptFallback.style.width = 'auto';
        slidePromptFallback.style.height = 'auto';
        slidePromptFallback.select();
        showCopied();
      });
    } else {
      slidePromptFallback.value = prompt;
      slidePromptFallback.style.position = 'static';
      slidePromptFallback.style.width = 'auto';
      slidePromptFallback.style.height = 'auto';
      slidePromptFallback.select();
      showCopied();
    }
  };

  if(!cfg.token){
    listNote.textContent = 'Preview only. No token set: showing the sample record.';
    reqCount.textContent = 'No requests yet.';
    loadSample();
    saveT.onclick = function(){ savedMsg.textContent = 'Outcome saved in this preview only.'; };
    return;
  }

  emptyNote.hidden = false;

  function api(path, opts){
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json' };
    if(opts.headers) for(var k in opts.headers) headers[k] = opts.headers[k];
    opts.headers = headers;
    return fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + path, opts);
  }

  function b64ToUtf8(b64){
    var bin = atob(b64.replace(/\n/g,''));
    var bytes = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function utf8ToB64(str){
    var bytes = new TextEncoder().encode(str);
    var bin=''; bytes.forEach(function(b){bin+=String.fromCharCode(b);});
    return btoa(bin);
  }

  // ponytail: one GET per submission to build the requests table (name, function, requester,
  // date, status, scores). Fine at today's volume; add a repo-side index file if submissions
  // pass ~100.
  function httpError(res, body){
    var reason = (body && body.message) || res.statusText || 'unknown error';
    return { status: res.status, reason: reason };
  }

  function refreshList(){
    listNote.textContent = 'Loading submissions...';
    api('submissions').then(function(res){
      if(res.status === 404) return [];
      if(!res.ok) return res.json().catch(function(){ return null; }).then(function(body){ throw httpError(res, body); });
      return res.json();
    }).then(function(items){
      items = items.filter(function(i){ return i.type==='file' && /\.json$/.test(i.name); });
      if(!items.length) return [];
      return Promise.all(items.map(function(it){
        return api(it.path).then(function(res){
          if(!res.ok) return res.json().catch(function(){ return null; }).then(function(body){ throw httpError(res, body); });
          return res.json();
        }).then(function(file){
          var rec = JSON.parse(b64ToUtf8(file.content));
          return { path: it.path, rec: rec };
        });
      }));
    }).then(function(loaded){
      loaded.sort(function(a,b){ return (b.rec.submittedAt||'').localeCompare(a.rec.submittedAt||''); });
      entries = loaded;
      listNote.textContent = '';
      populateFunctionFilter();
      updateAriaSort();
      renderTable();
    }).catch(function(err){
      var status = err && err.status !== undefined ? err.status : 'error';
      var reason = err && err.reason !== undefined ? err.reason : (err && err.message) || 'unknown error';
      reqCount.textContent = '';
      listNote.textContent = 'Could not load requests (' + status + ': ' + reason + '). Reload, or tell Shivam.';
    });
  }

  function selectEntry(e){
    currentPath = e.path;
    emptyNote.hidden = true;
    renderRecord(e.rec);
    sampleNote.textContent = '';
    fillTriage(e.rec.triage);
    savedMsg.textContent = '';
    terrs.classList.remove('show');
    renderTable();
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('t1').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  saveT.onclick = function(){
    if(!currentPath){ terrs.textContent = 'Pick a submission first.'; terrs.classList.add('show'); return; }
    function radioVal(name){ var el = document.querySelector('input[name="'+name+'"]:checked'); return el ? el.value : null; }
    var disposition = radioVal('disp');
    var redirectTo = document.getElementById('rto').value.trim();
    var validationError = !disposition ? 'Pick a disposition.'
      : (disposition === 'Redirect' && !redirectTo ? 'Say where to redirect it.' : null);
    if(validationError){ terrs.textContent = validationError; terrs.classList.add('show'); return; }
    terrs.classList.remove('show');
    var lenses = {};
    ['Cost','Risk','Time','Benefit'].forEach(function(l){
      var v = radioVal('lens-'+l); lenses[l] = v === null ? null : Number(v);
    });
    var triage = {
      changesRecurringDecision: radioVal('rd'),
      dataExists: radioVal('de'),
      ownerConfirmed: radioVal('sc'),
      lenses: lenses,
      disposition: disposition,
      decisionDate: document.getElementById('ddate').value || '',
      redirectTo: redirectTo,
      triagedBy: document.getElementById('tby').value.trim(),
      note: document.getElementById('note').value.trim(),
      savedAt: new Date().toISOString()
    };
    saveT.disabled = true;
    var savedRec = null;
    api(currentPath).then(function(res){
      if(!res.ok) throw new Error('Could not reload submission (' + res.status + ')');
      return res.json();
    }).then(function(file){
      var rec = JSON.parse(b64ToUtf8(file.content));
      rec.triage = triage;
      savedRec = rec;
      var json = JSON.stringify(rec, null, 2);
      return api(currentPath, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          message: 'Triage outcome: ' + (rec.shortName||currentPath),
          content: utf8ToB64(json),
          sha: file.sha,
          branch: cfg.branch
        })
      });
    }).then(function(res){
      if(!res.ok) return res.text().then(function(t){ throw new Error('Save failed (' + res.status + ')' + (t?': '+t:'')); });
      terrs.classList.remove('show');
      savedMsg.textContent = 'Outcome saved.';
      var entry = entries.filter(function(e){ return e.path === currentPath; })[0];
      if(entry) entry.rec = savedRec;
      renderTable();
    }).catch(function(err){
      terrs.textContent = err.message; terrs.classList.add('show');
    }).then(function(){
      saveT.disabled = false;
    }, function(){
      saveT.disabled = false;
    });
  };

  refreshList();
})();
