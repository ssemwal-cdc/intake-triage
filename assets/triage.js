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
    shortName: 'Entity-level tax allocation check', 'function': 'Tax', owner: 'Named by requester',
    frequency: 'Per project', closestGap: 'We take it on trust',
    cultureFactors: ['Built to last','Poka yoke'],
    informationLivesIn: ['NetSuite','Excel models',"in someone's head"],
    sensitiveData: 'Yes', systemAccess: 'Read only', triage: null
  };

  function renderRecord(rec){
    var rows = [['Request', rec.shortName||''],['From', rec['function']||''],['Owner once built', rec.owner||''],
      ['Frequency', rec.frequency||''],['Closest gap', rec.closestGap||''],
      ['Culture factors', (rec.cultureFactors||[]).join(', ') || 'None selected'],
      ['Information lives in', (rec.informationLivesIn||[]).join(', ') || 'Not given'],
      ['Sensitive data', rec.sensitiveData || 'Not given'],['System access', rec.systemAccess || 'Not given']];
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

  function refreshList(){
    fileList.innerHTML = '';
    listNote.textContent = 'Loading...';
    api('submissions').then(function(res){
      if(res.status === 404) return [];
      if(!res.ok) throw new Error('Could not list submissions (' + res.status + ')');
      return res.json();
    }).then(function(items){
      items = items.filter(function(i){ return i.type==='file' && /\.json$/.test(i.name); });
      items.sort(function(a,b){ return b.name.localeCompare(a.name); });
      if(!items.length){ listNote.textContent = 'No submissions yet.'; return; }
      listNote.textContent = 'Pick a submission to triage.';
      items.forEach(function(it){
        var li = document.createElement('li');
        var btn = document.createElement('button'); btn.type='button'; btn.textContent = it.name;
        btn.onclick = function(){ selectFile(it.path, btn); };
        li.appendChild(btn); fileList.appendChild(li);
      });
    }).catch(function(err){
      listNote.textContent = err.message;
    });
  }

  function selectFile(path, btn){
    Array.prototype.forEach.call(fileList.querySelectorAll('button'), function(b){ b.removeAttribute('aria-current'); });
    if(btn) btn.setAttribute('aria-current','true');
    currentPath = path;
    sampleNote.textContent = 'Loading...';
    api(path).then(function(res){
      if(!res.ok) throw new Error('Could not open submission (' + res.status + ')');
      return res.json();
    }).then(function(file){
      var rec = JSON.parse(b64ToUtf8(file.content));
      renderRecord(rec);
      sampleNote.textContent = path;
      fillTriage(rec.triage);
      savedMsg.textContent = '';
      terrs.classList.remove('show');
    }).catch(function(err){
      sampleNote.textContent = err.message;
    });
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
