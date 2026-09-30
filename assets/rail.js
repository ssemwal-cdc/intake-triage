(function(){
  var rail = document.getElementById('progressRail');
  var form = document.getElementById('f');
  var done = document.getElementById('done');
  var another = document.getElementById('another');
  if(!rail || !form) return;

  // Same required set app.js validates: 6 text/textarea fields plus the gap radio group.
  var REQUIRED_IDS = ['name','fn','short','steward','miss','freq'];
  var steps = Array.prototype.slice.call(document.querySelectorAll('#f .step'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function escapeHtml(s){
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function headingText(h2){
    var clone = h2.cloneNode(true);
    var n = clone.querySelector('.n');
    if(n) n.remove();
    return clone.textContent.trim();
  }
  function closestStep(el){ return el ? el.closest('.step') : null; }

  // Map each required control to its section, so section state can be computed.
  var reqBySection = new Map();
  steps.forEach(function(s){ reqBySection.set(s, []); });
  REQUIRED_IDS.forEach(function(id){
    var el = document.getElementById(id);
    var sec = closestStep(el);
    if(sec) reqBySection.get(sec).push(id);
  });
  var gapGroup = document.getElementById('gap');
  var gapSection = closestStep(gapGroup);
  if(gapSection) reqBySection.get(gapSection).push('__gap');

  var TOTAL_REQUIRED = REQUIRED_IDS.length + (gapSection ? 1 : 0);

  function fieldFilled(id){
    var el = document.getElementById(id);
    return !!(el && el.value.trim());
  }
  function gapPicked(){
    return !!form.querySelector('input[name="gap"]:checked');
  }
  function sectionHasAnyAnswer(step){
    var controls = step.querySelectorAll('input, textarea');
    for (var i = 0; i < controls.length; i++){
      var el = controls[i];
      if(el.type === 'checkbox' || el.type === 'radio'){ if(el.checked) return true; }
      else if(el.value && el.value.trim()) return true;
    }
    return false;
  }

  // ---- build rail DOM ----
  var progress = document.createElement('div');
  progress.className = 'rail-progress';
  progress.innerHTML =
    '<div class="rail-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Form completion">' +
      '<div class="rail-fill" id="railFill"></div>' +
    '</div>' +
    '<div class="rail-meta"><span id="railPercent">0%</span><span id="railStatus">' + TOTAL_REQUIRED + ' required left</span></div>';

  var stepsList = document.createElement('div');
  stepsList.className = 'rail-steps';
  var dotsList = document.createElement('div');
  dotsList.className = 'rail-dots';

  var entries = []; // { step, h2, btn, dot }

  steps.forEach(function(step, i){
    var h2 = step.querySelector('h2');
    if(!h2.hasAttribute('tabindex')) h2.setAttribute('tabindex', '-1');
    var label = headingText(h2);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-step';
    btn.setAttribute('data-state', 'none');
    btn.innerHTML =
      '<span class="rail-num">' + (i + 1) + '</span>' +
      '<span class="rail-label">' + escapeHtml(label) + '</span>' +
      '<span class="rail-check">&#10003;</span>';

    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'rail-dot-btn';
    dot.setAttribute('data-state', 'none');
    dot.setAttribute('aria-label', label);
    dot.innerHTML = '<span class="rail-dot"></span>';

    function go(){
      var behavior = reduced.matches ? 'auto' : 'smooth';
      step.scrollIntoView({ behavior: behavior, block: 'start' });
      h2.focus({ preventScroll: true });
    }
    btn.addEventListener('click', go);
    dot.addEventListener('click', go);

    stepsList.appendChild(btn);
    dotsList.appendChild(dot);
    entries.push({ step: step, h2: h2, btn: btn, dot: dot });
  });

  rail.innerHTML = '';
  rail.appendChild(progress);
  rail.appendChild(stepsList);
  rail.appendChild(dotsList);

  var railFill = document.getElementById('railFill');
  var railPercent = document.getElementById('railPercent');
  var railStatus = document.getElementById('railStatus');
  var railTrack = rail.querySelector('.rail-track');

  function recompute(){
    var filled = 0;
    REQUIRED_IDS.forEach(function(id){ if(fieldFilled(id)) filled++; });
    if(gapSection && gapPicked()) filled++;
    var remaining = TOTAL_REQUIRED - filled;
    var percent = TOTAL_REQUIRED ? Math.round((filled / TOTAL_REQUIRED) * 100) : 100;

    railFill.style.width = percent + '%';
    railPercent.textContent = percent + '%';
    railStatus.textContent = remaining > 0 ? (remaining + ' required left') : 'Ready to submit';
    railTrack.setAttribute('aria-valuenow', String(percent));

    entries.forEach(function(entry){
      var reqIds = reqBySection.get(entry.step) || [];
      var state;
      if(reqIds.length){
        var have = reqIds.filter(function(id){ return id === '__gap' ? gapPicked() : fieldFilled(id); }).length;
        state = have === 0 ? 'none' : (have === reqIds.length ? 'done' : 'partial');
      } else {
        state = sectionHasAnyAnswer(entry.step) ? 'done' : 'none';
      }
      entry.btn.setAttribute('data-state', state);
      entry.dot.setAttribute('data-state', state);
    });
  }

  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);
  form.addEventListener('reset', function(){ setTimeout(recompute, 0); });

  // ---- scroll-spy ----
  var ratios = new Map();
  var io = new IntersectionObserver(function(observerEntries){
    observerEntries.forEach(function(e){ ratios.set(e.target, e.intersectionRatio); });
    var best = null, bestRatio = 0;
    entries.forEach(function(entry){
      var r = ratios.get(entry.step) || 0;
      if(r > bestRatio){ bestRatio = r; best = entry; }
    });
    entries.forEach(function(entry){
      var isCurrent = entry === best && bestRatio > 0;
      entry.btn.classList.toggle('is-current', isCurrent);
      entry.dot.classList.toggle('is-current', isCurrent);
      if(isCurrent){
        entry.btn.setAttribute('aria-current', 'step');
        entry.dot.setAttribute('aria-current', 'step');
      } else {
        entry.btn.removeAttribute('aria-current');
        entry.dot.removeAttribute('aria-current');
      }
    });
  }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  steps.forEach(function(s){ io.observe(s); });

  // ---- hide after submit, show + reset on "Start another request" ----
  if(done){
    new MutationObserver(function(){
      if(done.classList.contains('show')) rail.classList.add('rail-hidden');
    }).observe(done, { attributes: true, attributeFilter: ['class'] });
  }
  if(another){
    another.addEventListener('click', function(){
      rail.classList.remove('rail-hidden');
      setTimeout(recompute, 0);
    });
  }

  recompute();
})();
