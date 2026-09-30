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

  var fileList = document.getElementById('fileList'), listNote = document.getElementById('listNote');
  var sampleDl = document.getElementById('sampleDl'), sampleNote = document.getElementById('sampleNote');
  var terrs = document.getElementById('terrs'), savedMsg = document.getElementById('savedMsg');
  var saveT = document.getElementById('saveT');
  var currentPath = null;

  var SAMPLE = {
    yourName: 'Named by requester', shortName: 'Entity-level tax allocation check', 'function': 'Tax',
    owner: 'Named by requester',
    whatGoesWrong: 'We re-check the entity allocation by hand every close, and it is easy to miss a step.',
    envisionedSolution: '', cultureFactors: ['Built to last','Poka yoke'],
    frequency: 'Per project', effort: '', users: '',
    informationLivesIn: ['NetSuite','Excel models',"in someone's head"],
    closestGap: 'We take it on trust',
    sensitiveData: 'Yes', systemAccess: 'Read only',
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
      ['System access', orNotGiven(rec.systemAccess)],
      ['Submitted', fmtDate(rec.submittedAt) || 'Not given']
    ];
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
    document.getElementById('note').value = t.note || '';
  }

  function loadSample(){
    renderRecord(SAMPLE);
    sampleNote.textContent = 'Sample record. Submitting the requester form fills this with that submission.';
    fillTriage(null);
    savedMsg.textContent = 'Preview only.';
  }

  if(!cfg.token){
    listNote.textContent = 'Preview only. No token set: showing the sample record.';
    loadSample();
    saveT.onclick = function(){ savedMsg.textContent = 'Outcome saved in this preview only.'; };
    return;
  }

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

  // ponytail: one GET per submission to build the picker card (name, function, requester,
  // date, status). Fine at today's volume; add a repo-side index file if submissions pass ~100.
  function refreshList(){
    fileList.innerHTML = '';
    listNote.textContent = 'Loading submissions...';
    api('submissions').then(function(res){
      if(res.status === 404) return [];
      if(!res.ok) throw new Error('Could not list submissions (' + res.status + ')');
      return res.json();
    }).then(function(items){
      items = items.filter(function(i){ return i.type==='file' && /\.json$/.test(i.name); });
      if(!items.length){ listNote.textContent = 'No submissions yet.'; return []; }
      return Promise.all(items.map(function(it){
        return api(it.path).then(function(res){
          if(!res.ok) throw new Error('Could not open ' + it.name + ' (' + res.status + ')');
          return res.json();
        }).then(function(file){
          var rec = JSON.parse(b64ToUtf8(file.content));
          return { path: it.path, rec: rec };
        });
      }));
    }).then(function(entries){
      if(!entries.length) return;
      entries.sort(function(a,b){ return (b.rec.submittedAt||'').localeCompare(a.rec.submittedAt||''); });
      listNote.textContent = 'Pick a submission to triage.';
      entries.forEach(function(e){
        var rec = e.rec;
        var li = document.createElement('li');
        var btn = document.createElement('button'); btn.type='button';
        var name = document.createElement('span'); name.className='fname'; name.textContent = rec.shortName || e.path;
        var meta = document.createElement('span'); meta.className='fmeta';
        meta.textContent = [rec['function']||'Not given', rec.yourName||'Not given', fmtDate(rec.submittedAt)].filter(Boolean).join(' · ');
        var tag = document.createElement('span'); tag.className='ftag';
        tag.textContent = (rec.triage && rec.triage.disposition) || 'Not triaged';
        btn.appendChild(name); btn.appendChild(meta); btn.appendChild(tag);
        btn.onclick = function(){ selectFile(e.path, btn, rec); };
        li.appendChild(btn); fileList.appendChild(li);
      });
    }).catch(function(err){
      listNote.textContent = err.message;
    });
  }

  function selectFile(path, btn, rec){
    Array.prototype.forEach.call(fileList.querySelectorAll('button'), function(b){ b.removeAttribute('aria-current'); });
    if(btn) btn.setAttribute('aria-current','true');
    currentPath = path;
    renderRecord(rec);
    sampleNote.textContent = '';
    fillTriage(rec.triage);
    savedMsg.textContent = '';
    terrs.classList.remove('show');
  }

  saveT.onclick = function(){
    if(!currentPath){ terrs.innerHTML = 'Pick a submission first.'; terrs.classList.add('show'); return; }
    function radioVal(name){ var el = document.querySelector('input[name="'+name+'"]:checked'); return el ? el.value : null; }
    var lenses = {};
    ['Cost','Risk','Time','Benefit'].forEach(function(l){
      var v = radioVal('lens-'+l); lenses[l] = v === null ? null : Number(v);
    });
    var triage = {
      changesRecurringDecision: radioVal('rd'),
      dataExists: radioVal('de'),
      ownerConfirmed: radioVal('sc'),
      lenses: lenses,
      disposition: radioVal('disp'),
      decisionDate: document.getElementById('ddate').value || '',
      redirectTo: document.getElementById('rto').value.trim(),
      note: document.getElementById('note').value.trim(),
      savedAt: new Date().toISOString()
    };
    saveT.disabled = true;
    api(currentPath).then(function(res){
      if(!res.ok) throw new Error('Could not reload submission (' + res.status + ')');
      return res.json();
    }).then(function(file){
      var rec = JSON.parse(b64ToUtf8(file.content));
      rec.triage = triage;
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
      var curBtn = fileList.querySelector('button[aria-current="true"] .ftag');
      if(curBtn) curBtn.textContent = triage.disposition || 'Not triaged';
    }).catch(function(err){
      terrs.innerHTML = err.message; terrs.classList.add('show');
    }).then(function(){
      saveT.disabled = false;
    }, function(){
      saveT.disabled = false;
    });
  };

  refreshList();
})();
