(function(){
  var FORM_TITLE = 'Request Intake';            // single place to rename the form
  document.getElementById('formTitle').textContent = FORM_TITLE;
  document.title = FORM_TITLE + ' | Compass Datacenters';

  var f = document.getElementById('f'), errs = document.getElementById('errs'), done = document.getElementById('done');
  var srcOtherCk = document.getElementById('srcOtherCk'), srcOther = document.getElementById('srcOther');
  var wbFollowup = document.getElementById('wbFollowup');
  var submitBtn = f.querySelector('button[type=submit]');
  srcOtherCk.addEventListener('change', function(){
    var on = srcOtherCk.checked;
    srcOther.hidden = !on;
    if(on) srcOther.focus(); else { srcOther.value=''; srcOther.classList.remove('invalid'); }
  });
  function updateWbFollowup(){
    var on = picked('sys') === 'Yes';
    wbFollowup.hidden = !on;
    if(!on){
      Array.prototype.forEach.call(f.querySelectorAll('input[name="wb"]'), function(el){ el.checked = false; });
    }
  }
  Array.prototype.forEach.call(f.querySelectorAll('input[name="sys"]'), function(r){
    r.addEventListener('change', updateWbFollowup);
  });
  function val(id){ return document.getElementById(id).value.trim(); }
  function picked(name){ var x = f.querySelector('input[name="'+name+'"]:checked'); return x ? x.value : ''; }
  var required = [['name','Your name'],['fn','Function'],['short','Short name for the request'],
                  ['steward','Who would own it once it is built'],
                  ['freq','How often this need arises'],['miss','What goes wrong today']];
  var gapText = {'Remember':'We answer it from scratch every time','Verify':'We take it on trust',
                 'See':"We can't see it clearly",'Guess':'We estimate it by hand','None fit':'None of these fit'};

  // Payload keys follow the form's order; values are the words the requester saw.
  function buildPayload(){
    var srcs = Array.prototype.map.call(document.querySelectorAll('#srcs input:checked'), function(c){
      return c.value === 'Other' ? (val('srcOther') || 'Other') : c.value;
    });
    var culture = Array.prototype.map.call(document.querySelectorAll('#culture input:checked'), function(c){ return c.value; });
    return {
      yourName: val('name'),
      function: val('fn'),
      shortName: val('short'),
      owner: val('steward'),
      whatGoesWrong: val('miss'),
      envisionedSolution: val('solution'),
      cultureFactors: culture,
      frequency: val('freq'),
      effort: val('effort'),
      users: val('users'),
      informationLivesIn: srcs,
      closestGap: gapText[picked('gap')] || '',
      sensitiveData: picked('sens') || '',
      systemConnection: picked('sys') || '',
      systemAccess: picked('sys') === 'Yes' ? (picked('wb') || '') : '',
      submittedAt: new Date().toISOString(),
      formTitle: FORM_TITLE,
      schemaVersion: 1,
      triage: null
    };
  }

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

    var payload = buildPayload();
    submitBtn.disabled = true;
    window.submitRequest(payload).then(function(){
      submitBtn.disabled = false;
      document.getElementById('doneMsg').textContent =
        '"'+payload.shortName+'" from '+payload.function+' is in the queue for review.';
      f.hidden = true; done.classList.add('show'); done.focus();
    }).catch(function(err){
      submitBtn.disabled = false;
      errs.innerHTML = '<strong>The request could not be sent.</strong><p>'+(err && err.message ? err.message : 'Try again.')+'</p>';
      errs.classList.add('show'); errs.focus();
    });
  });

  document.getElementById('another').onclick = function(){
    f.reset(); srcOther.hidden = true; wbFollowup.hidden = true;
    f.querySelectorAll('.invalid').forEach(function(el){el.classList.remove('invalid')});
    done.classList.remove('show'); f.hidden = false; window.scrollTo(0,0);
  };
})();
