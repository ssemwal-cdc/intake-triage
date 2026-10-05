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
    var override = h2.getAttribute('data-rail');
    if(override) return override;
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

  // Vertical timeline (>=641px only; CSS hides it on the mobile top bar). A base
  // slate line plus one orange segment per completed step, each positioned to run
  // dot-center to dot-center so the opaque dots paint on top and the line never
  // shows through. Built before the step buttons below, so segments paint first.
  var trackV = document.createElement('div');
  trackV.className = 'rail-track-v';
  stepsList.appendChild(trackV);
  // One segment per gap between dots, all appended before any step button so
  // buttons (and their opaque dots) always paint on top of the line.
  var segEls = [];
  for(var si = 0; si < steps.length - 1; si++){
    var seg = document.createElement('div');
    seg.className = 'rail-seg';
    stepsList.appendChild(seg);
    segEls.push(seg);
  }

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
      '<span class="rail-num"><span class="rail-num-n">' + (i + 1) + '</span></span>' +
      '<span class="rail-label">' + escapeHtml(label) + '</span>';

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

  // Segment k (between dot k and dot k+1) is positioned dot-center to dot-center,
  // from the dots' own rendered position, so it holds regardless of label wrapping.
  function paintSegments(){
    var railRect = stepsList.getBoundingClientRect();
    for(var i = 0; i < segEls.length; i++){
      var numA = entries[i].btn.querySelector('.rail-num');
      var numB = entries[i + 1].btn.querySelector('.rail-num');
      var a = numA.getBoundingClientRect();
      var b = numB.getBoundingClientRect();
      var top = (a.top + a.height / 2) - railRect.top;
      var bottom = (b.top + b.height / 2) - railRect.top;
      segEls[i].style.top = top + 'px';
      segEls[i].style.height = Math.max(0, bottom - top) + 'px';
    }
  }

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

    // Two states only: complete, or not. "Current" (in view, not complete) is
    // layered on top by the scroll-spy's is-current class, in CSS.
    entries.forEach(function(entry){
      var reqIds = reqBySection.get(entry.step) || [];
      var done;
      if(reqIds.length){
        var have = reqIds.filter(function(id){ return id === '__gap' ? gapPicked() : fieldFilled(id); }).length;
        done = have === reqIds.length;
      } else {
        done = sectionHasAnyAnswer(entry.step);
      }
      var state = done ? 'done' : 'none';
      entry.btn.setAttribute('data-state', state);
      entry.dot.setAttribute('data-state', state);
    });

    entries.forEach(function(entry, i){
      if(i < segEls.length) segEls[i].setAttribute('data-state', entry.btn.getAttribute('data-state'));
    });
    paintSegments();
  }

  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);
  form.addEventListener('reset', function(){ setTimeout(recompute, 0); });

  // ---- scroll-spy ----
  // Current = the last section whose top has passed a line near the top of the
  // viewport. On narrow widths the rail is a sticky top bar that sits over the
  // page, so the line sits below it, at the bar's own rendered height; on wide
  // layouts the rail is a side column, so the line sits at the viewport top.
  // Falls back to step 1 while nothing has passed the line yet (top of page),
  // and snaps to the last step once the page is scrolled to the bottom (its
  // own top may never reach the line if it is shorter than the viewport).
  var mobileRail = window.matchMedia('(max-width:640px)');
  var NEAR_TOP_BUFFER = 24; // "near the top", not pinned to the exact edge
  function lineOffset(){
    return (mobileRail.matches ? rail.getBoundingClientRect().height : 0) + NEAR_TOP_BUFFER;
  }
  function updateCurrent(){
    var line = lineOffset();
    var current = entries[0];
    for (var i = 0; i < entries.length; i++){
      if (entries[i].step.getBoundingClientRect().top <= line) current = entries[i];
    }
    var atBottom = (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 1);
    if (atBottom) current = entries[entries.length - 1];
    entries.forEach(function(entry){
      var isCurrent = entry === current;
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
  }
  // A plain 'scroll' listener covers user-driven scrolling (wheel, trackpad,
  // keyboard), but the browser fires that event on its own render-frame
  // schedule, a frame or more after a programmatic jump. Wrapping the two ways
  // script moves the page (scrollTo/scrollBy, and our own step buttons'
  // scrollIntoView) updates aria-current in the same call, so a caller that
  // scrolls and immediately reads the rail sees it already in sync.
  window.addEventListener('scroll', updateCurrent, { passive: true });
  window.addEventListener('resize', updateCurrent);
  ['scrollTo', 'scrollBy'].forEach(function(name){
    var native = window[name].bind(window);
    window[name] = function(){ native.apply(window, arguments); updateCurrent(); };
  });
  var nativeScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function(){
    nativeScrollIntoView.apply(this, arguments);
    updateCurrent();
  };
  updateCurrent();

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

  // Dot positions shift with viewport width and label wrapping (including the
  // is-current label going bold); repaint segments without recomputing state.
  window.addEventListener('resize', paintSegments);
  if(window.ResizeObserver) new ResizeObserver(paintSegments).observe(stepsList);

  recompute();
})();
