(function(){
  var FORM_TITLE = 'Request Intake';            // single place to rename the form
  document.getElementById('formTitle').textContent = FORM_TITLE;
  document.title = FORM_TITLE + ' | Compass Datacenters';

  var req = document.getElementById('requester'), tri = document.getElementById('triage');
  var bReq = document.getElementById('vReq'), bTri = document.getElementById('vTri');
  function show(which){
    var t = which === 'tri';
    tri.hidden = !t; req.hidden = t;
    bTri.setAttribute('aria-pressed', t); bReq.setAttribute('aria-pressed', !t);
    window.scrollTo(0,0);
  }
  bReq.onclick = function(){show('req')}; bTri.onclick = function(){show('tri')};

  // business lens scales
  var lensBox = document.getElementById('lenses');
  ['Cost','Risk','Time','Benefit'].forEach(function(l){
    var row = document.createElement('div'); row.className='lens';
    var n = document.createElement('span'); n.className='name'; n.id='lens'+l; n.textContent=l;
    var sc = document.createElement('div'); sc.className='scale'; sc.setAttribute('role','radiogroup');
    sc.setAttribute('aria-labelledby','lens'+l);
    [-3,-2,-1,0,1,2,3].forEach(function(v){
      var lab=document.createElement('label'), i=document.createElement('input'), s=document.createElement('span');
      i.type='radio'; i.name='lens-'+l; i.value=v; i.setAttribute('aria-label', l+' '+(v>0?'+'+v:v));
      s.textContent = v>0 ? '+'+v : (v<0 ? '\u2212'+Math.abs(v) : '0');
      lab.appendChild(i); lab.appendChild(s); sc.appendChild(lab);
    });
    row.appendChild(n); row.appendChild(sc); lensBox.appendChild(row);
  });

  var f = document.getElementById('f'), errs = document.getElementById('errs'), done = document.getElementById('done');
  var srcOtherCk = document.getElementById('srcOtherCk'), srcOther = document.getElementById('srcOther');
  srcOtherCk.addEventListener('change', function(){
    var on = srcOtherCk.checked;
    srcOther.hidden = !on;
    if(on) srcOther.focus(); else { srcOther.value=''; srcOther.classList.remove('invalid'); }
  });
  function val(id){ return document.getElementById(id).value.trim(); }
  function picked(name){ var x = f.querySelector('input[name="'+name+'"]:checked'); return x ? x.value : ''; }
  var required = [['name','Your name'],['fn','Function'],['short','Short name for the request'],
                  ['steward','Who would own it once it is built'],
                  ['freq','How often this need arises'],['miss','What goes wrong today']];

  f.addEventListener('submit', function(e){
    e.preventDefault();
    var missing = [];
    required.forEach(function(r){
      var el = document.getElementById(r[0]); var bad = !el.value.trim();
      el.classList.toggle('invalid', bad); el.setAttribute('aria-invalid', bad);
      if(bad) missing.push(r[1]);
    });
    var otherBad = srcOtherCk.checked && !srcOther.value.trim();
    srcOther.classList.toggle('invalid', otherBad); srcOther.setAttribute('aria-invalid', otherBad);
    if(otherBad) missing.push('Where else the information lives, described');
    if(!picked('gap')) missing.push('Which of the four is closest');
    if(missing.length){
      errs.innerHTML = '<strong>'+missing.length+' answer'+(missing.length>1?'s':'')+' needed before submitting:</strong><ul>'+
        missing.map(function(m){return '<li>'+m+'</li>'}).join('')+'</ul>';
      errs.classList.add('show'); errs.focus(); return;
    }
    errs.classList.remove('show');

    var srcs = Array.prototype.map.call(document.querySelectorAll('#srcs input:checked'), function(c){
      return c.value === 'Other' ? (val('srcOther') || 'Other') : c.value;
    });
    var gapText = {'Remember':'We answer it from scratch every time','Verify':'We take it on trust',
                   'See':"We can't see it clearly",'Guess':'We estimate it by hand','None fit':'None of these fit'};
    var rows = [['Request',val('short')],['From',val('fn')],['Owner once built',val('steward')],
                ['Frequency',val('freq')],['Closest gap',gapText[picked('gap')]],
                ['Culture factors', Array.prototype.map.call(document.querySelectorAll('#culture input:checked'),
                   function(c){return c.value}).join(', ') || 'None selected'],
                ['Information lives in',srcs.join(', ')||'Not given'],
                ['Sensitive data',picked('sens')||'Not given'],['System access',picked('wb')||'Not given']];
    var dl = document.getElementById('sampleDl'); dl.innerHTML='';
    rows.forEach(function(r){ var dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=r[0]; dd.textContent=r[1]; dl.appendChild(dt); dl.appendChild(dd); });

    document.getElementById('doneMsg').textContent =
      '"'+val('short')+'" from '+val('fn')+' is in the queue for review. The outcome, and where to send any supporting files, will come back to '+val('name')+'.';
    f.hidden = true; done.classList.add('show'); done.focus();
  });

  document.getElementById('another').onclick = function(){
    f.reset(); srcOther.hidden = true;
    f.querySelectorAll('.invalid').forEach(function(el){el.classList.remove('invalid')});
    done.classList.remove('show'); f.hidden = false; window.scrollTo(0,0);
  };
  document.getElementById('saveT').onclick = function(){
    document.getElementById('savedMsg').textContent = 'Outcome saved in this preview only.';
  };
})();
