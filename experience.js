(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeddingExperience = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_EVENT = '2027-01-13T23:00:00Z';
  const weddingDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function getCountdown(iso = DEFAULT_EVENT, now = Date.now()) {
    const target = Date.parse(iso);
    const current = typeof now === 'string' ? Date.parse(now) : Number(now);
    if (!Number.isFinite(target) || !Number.isFinite(current)) throw new RangeError('Informe uma data válida para a contagem regressiva.');
    const remaining = Math.max(0, Math.floor((target - current) / 1000));
    return {
      days: Math.floor(remaining / 86400),
      hours: Math.floor(remaining / 3600) % 24,
      minutes: Math.floor(remaining / 60) % 60,
      seconds: remaining % 60,
      state: current >= target ? 'started' : weddingDay.format(current) === weddingDay.format(target) ? 'today' : 'future'
    };
  }

  function find(document, selector) {
    return document && typeof document.querySelector === 'function' ? document.querySelector(selector) : null;
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function listen(target, name, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return function () {};
    target.addEventListener(name, handler, options);
    return function () {
      if (typeof target.removeEventListener === 'function') target.removeEventListener(name, handler, options);
    };
  }

  function readable(countdown) {
    if (countdown.state === 'started') return 'Chegou a hora do casamento de Geovanna e Yuri!';
    const parts = [['days','dia'],['hours','hora'],['minutes','minuto'],['seconds','segundo']]
      .map(function (entry) {
        const number = countdown[entry[0]];
        return number + ' ' + entry[1] + (number === 1 ? '' : 's');
      });
    return 'Tempo até o casamento: ' + parts.slice(0, -1).join(', ') + ' e ' + parts.at(-1) + '.';
  }

  function mountCountdown(document, window, iso = DEFAULT_EVENT) {
    window = window || {};
    const fields = {};
    ['days','hours','minutes','seconds'].forEach(function (key) { fields[key] = find(document, '[data-countdown="' + key + '"]'); });
    const caption = find(document, '#countdown-caption');
    const accessible = find(document, '#countdown-accessible');
    if (accessible && typeof accessible.setAttribute === 'function') accessible.setAttribute('aria-live', 'off');
    let timer = null;
    let timerType = '';
    let disposed = false;
    let finished = false;
    const visible = function () { return !document || (document.hidden !== true && document.visibilityState !== 'hidden'); };

    function stop() {
      if (timer === null) return;
      const clear = timerType === 'timeout' ? window.clearTimeout : window.clearInterval;
      if (typeof clear === 'function') clear.call(window, timer);
      timer = null;
    }

    function render() {
      let countdown;
      try {
        const now = window.Date && typeof window.Date.now === 'function' ? window.Date.now() : Date.now();
        countdown = getCountdown(iso, now);
      } catch {
        setText(caption, 'A data da celebração será confirmada.');
        setText(accessible, 'A data da celebração será confirmada.');
        finished = true;
        return;
      }
      Object.keys(fields).forEach(function (key) { setText(fields[key], String(countdown[key]).padStart(2, '0')); });
      setText(caption, countdown.state === 'started' ? 'Chegou a hora de celebrar!' : countdown.state === 'today' ? 'É hoje! Nosso encontro está chegando.' : 'Falta pouco para celebrarmos juntos.');
      setText(accessible, readable(countdown));
      finished = countdown.state === 'started';
    }

    function schedule() {
      if (disposed || finished || !visible() || timer !== null) return;
      if (typeof window.setTimeout === 'function' && typeof window.clearTimeout === 'function') {
        timerType = 'timeout';
        timer = window.setTimeout(function () { timer = null; tick(); }, 1000);
      } else if (typeof window.setInterval === 'function' && typeof window.clearInterval === 'function') {
        timerType = 'interval';
        timer = window.setInterval(tick, 1000);
      }
    }

    function tick() {
      if (disposed || !visible()) { stop(); return; }
      render();
      if (finished) stop();
      else schedule();
    }

    const removeVisibility = listen(document, 'visibilitychange', function () {
      stop();
      if (visible() && !disposed) { render(); schedule(); }
    });
    render();
    schedule();
    return function () { disposed = true; stop(); removeVisibility(); };
  }

  function initProgress(document, window) {
    window = window || {};
    const bar = find(document, '#reading-progress');
    if (!bar || !bar.style) return function () {};
    if (typeof bar.setAttribute === 'function') {
      bar.setAttribute('aria-hidden', 'true');
      bar.setAttribute('aria-live', 'off');
    }
    bar.style.transformOrigin = 'left center';
    function update() {
      const html = document.documentElement || {};
      const body = document.body || {};
      const scrolling = document.scrollingElement || html;
      const height = Math.max(Number(scrolling.scrollHeight) || 0, Number(html.scrollHeight) || 0, Number(body.scrollHeight) || 0);
      const viewport = Number(window.innerHeight) || Number(html.clientHeight) || Number(scrolling.clientHeight) || 0;
      const top = Number.isFinite(window.scrollY) ? window.scrollY : Number.isFinite(window.pageYOffset) ? window.pageYOffset : Number(scrolling.scrollTop) || 0;
      const distance = height - viewport;
      const progress = distance > 0 ? Math.min(1, Math.max(0, top / distance)) : 0;
      bar.style.transform = 'scaleX(' + progress + ')';
    }
    const removeScroll = listen(window, 'scroll', update, {passive:true});
    const removeResize = listen(window, 'resize', update);
    const removeLoad = listen(window, 'load', update);
    update();
    return function () { removeScroll(); removeResize(); removeLoad(); };
  }

  return {getCountdown:getCountdown,mountCountdown:mountCountdown,initProgress:initProgress};
}));
