(function (global) {
  'use strict';

  function parseParts(value, pattern, keys) {
    var match = pattern.exec(String(value || '').trim());
    if (!match) return null;
    var out = {};
    keys.forEach(function (key, index) {
      out[key] = Number(match[index + 1]);
    });
    return out;
  }

  function parseDate(value) {
    var parts = parseParts(value, /^(\d{4})-(\d{2})-(\d{2})$/, ['year', 'month', 'day']);
    if (!parts) return null;
    var check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return check.getUTCFullYear() === parts.year && check.getUTCMonth() === parts.month - 1 && check.getUTCDate() === parts.day ? parts : null;
  }

  function parseTime(value) {
    var parts = parseParts(value, /^(\d{2}):(\d{2})$/, ['hour', 'minute']);
    return parts && parts.hour >= 0 && parts.hour <= 23 && parts.minute >= 0 && parts.minute <= 59 ? parts : null;
  }

  function offsetMinutesAt(date, timeZone) {
    var formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    var map = {};
    formatter.formatToParts(date).forEach(function (part) {
      if (part.type !== 'literal') map[part.type] = Number(part.value);
    });
    var zoned = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
    var actual = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    );
    return Math.round((zoned - actual) / 60000);
  }

  function zonedDateTimeToUTC(dateString, timeString, timeZone) {
    var date = parseDate(dateString);
    var time = parseTime(timeString);
    if (!date) throw new Error('Data do casamento inválida.');
    if (!time) throw new Error('Horário do casamento inválido.');
    var zone = timeZone || 'America/Manaus';
    var localMillis = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
    var firstGuess = new Date(localMillis);
    var firstOffset = offsetMinutesAt(firstGuess, zone);
    var candidate = new Date(localMillis - firstOffset * 60000);
    var secondOffset = offsetMinutesAt(candidate, zone);
    return secondOffset === firstOffset ? candidate : new Date(localMillis - secondOffset * 60000);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatCompactDate(date) {
    return String(date.year) + pad(date.month) + pad(date.day);
  }

  function formatUTCStamp(date) {
    return (
      date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) +
      'T' +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes()) +
      pad(date.getUTCSeconds()) +
      'Z'
    );
  }

  function nextDay(date) {
    var d = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }

  function escapeICS(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function foldICSLine(line) {
    var bytes = 0;
    var chunk = '';
    var out = [];
    Array.from(line).forEach(function (ch) {
      var size = encodeURIComponent(ch).replace(/%[0-9A-F]{2}/gi, 'x').length;
      var limit = out.length === 0 ? 75 : 74;
      if (bytes + size > limit) {
        out.push(chunk);
        chunk = ' ' + ch;
        bytes = size;
      } else {
        chunk += ch;
        bytes += size;
      }
    });
    if (chunk) out.push(chunk);
    return out.join('\r\n');
  }

  function getCalendarData(config) {
    var couple = (config && config.couple) || {};
    var event = (config && config.event) || {};
    var site = (config && config.site) || {};
    if (!event.dateConfirmed) throw new Error('A data final ainda não está confirmada.');
    var date = parseDate(event.date);
    if (!date) throw new Error('Configure a data no formato AAAA-MM-DD.');
    var title = 'Casamento de ' + (couple.firstNames || 'Yuri & Geovanna');
    var location = [event.fullVenue || event.venue, event.address].filter(Boolean).join(' — ');
    var details = ['Celebração do casamento de ' + (couple.firstNames || 'Yuri & Geovanna') + '.'];
    if (site.url) details.push('Convite: ' + site.url);
    var description = details.join('\n');
    var timeZone = event.timeZone || 'America/Manaus';
    if (!String(event.startTime || '').trim()) {
      return {
        allDay: true,
        title: title,
        location: location,
        description: description,
        timeZone: timeZone,
        startDate: formatCompactDate(date),
        endDate: formatCompactDate(nextDay(date)),
        url: site.url || ''
      };
    }
    var start = zonedDateTimeToUTC(event.date, event.startTime, timeZone);
    var end = String(event.endTime || '').trim()
      ? zonedDateTimeToUTC(event.date, event.endTime, timeZone)
      : new Date(start.getTime() + 4 * 3600000);
    if (end <= start) end = new Date(end.getTime() + 86400000);
    return {
      allDay: false,
      title: title,
      location: location,
      description: description,
      timeZone: timeZone,
      startUTC: start,
      endUTC: end,
      startStamp: formatUTCStamp(start),
      endStamp: formatUTCStamp(end),
      url: site.url || ''
    };
  }

  function buildGoogleCalendarUrl(config) {
    var data = getCalendarData(config);
    var dates = data.allDay ? data.startDate + '/' + data.endDate : data.startStamp + '/' + data.endStamp;
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: data.title,
      dates: dates,
      details: data.description,
      location: data.location,
      ctz: data.timeZone
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function buildOutlookCalendarUrl(config) {
    var data = getCalendarData(config);
    var startIso;
    var endIso;
    if (data.allDay) {
      startIso = data.startDate.slice(0, 4) + '-' + data.startDate.slice(4, 6) + '-' + data.startDate.slice(6, 8);
      endIso = data.endDate.slice(0, 4) + '-' + data.endDate.slice(4, 6) + '-' + data.endDate.slice(6, 8);
    } else {
      startIso = data.startUTC.toISOString();
      endIso = data.endUTC.toISOString();
    }
    var params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: data.title,
      startdt: startIso,
      enddt: endIso,
      body: data.description,
      location: data.location,
      allday: data.allDay ? 'true' : 'false'
    });
    return 'https://outlook.live.com/calendar/0/deeplink/compose?' + params.toString();
  }

  function buildICS(config, now) {
    var data = getCalendarData(config);
    var stamp = formatUTCStamp(now instanceof Date ? now : new Date());
    var uidDate = data.allDay ? data.startDate : data.startStamp;
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Yuri e Geovanna//Convite de casamento//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:casamento-' + uidDate + '@yuri-e-geovanna.local',
      'DTSTAMP:' + stamp
    ];
    if (data.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + data.startDate, 'DTEND;VALUE=DATE:' + data.endDate);
    } else {
      lines.push('DTSTART:' + data.startStamp, 'DTEND:' + data.endStamp);
    }
    lines.push(
      'SUMMARY:' + escapeICS(data.title),
      'DESCRIPTION:' + escapeICS(data.description),
      'LOCATION:' + escapeICS(data.location),
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE'
    );
    if (data.url && /^https?:\/\//i.test(data.url)) lines.push('URL:' + escapeICS(data.url));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldICSLine).join('\r\n') + '\r\n';
  }

  function buildRsvpMessage(input, coupleNames) {
    var name = String((input && input.name) || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) throw new Error('Por favor, informe o nome do responsável pela resposta.');
    var attending = !input || input.response !== 'no';
    var count = Math.max(0, Math.min(20, Number((input && input.companions) || 0) || 0));
    var lines = [
      'Olá! Gostaria de confirmar presença no casamento de ' + (coupleNames || 'Yuri & Geovanna') + '.',
      'Nome: ' + name,
      'Presença: ' + (attending ? 'Sim, estarei presente.' : 'Não poderei comparecer.')
    ];
    if (attending && count > 0) lines.push('Pessoas adicionais: ' + count);
    return lines.join('\n');
  }

  function maskPhone(phone) {
    var digits = String(phone || '').replace(/\D+/g, '');
    if (digits.length >= 4) return 'final ' + digits.slice(-4);
    return digits ? 'final ' + digits : 'não informado';
  }

  global.WeddingUtils = Object.freeze({
    buildGoogleCalendarUrl: buildGoogleCalendarUrl,
    buildOutlookCalendarUrl: buildOutlookCalendarUrl,
    buildICS: buildICS,
    buildRsvpMessage: buildRsvpMessage,
    getCalendarData: getCalendarData,
    escapeICS: escapeICS,
    foldICSLine: foldICSLine,
    zonedDateTimeToUTC: zonedDateTimeToUTC,
    maskPhone: maskPhone
  });

  if (!global.document) return;

  function init() {
    var document = global.document;
    var config = global.WEDDING_CONFIG || {};
    var event = config.event || {};
    var gifts = config.gifts || {};
    var rsvpConfig = config.rsvp || {};
    var byId = function (id) { return document.getElementById(id); };
    var all = function (selector) { return Array.from(document.querySelectorAll(selector)); };
    var reduced = global.matchMedia('(prefers-reduced-motion: reduce)');
    var opening = false;
    var openingTimer;
    var toastTimer;
    var muralLoaded = false;
    var dialogOpeners = new WeakMap();
    var INVITE_TOKEN_KEY = 'convite_family_token_v1';
    var SOUND_PREF_KEY = 'convite_sound_v1';

    function createSoundEngine() {
      var AudioCtx = global.AudioContext || global.webkitAudioContext;
      var ctx = null;
      var master = null;
      var noiseBuffer = null;
      var enabled = true;
      var ambientTimer = null;
      var chordIndex = 0;
      var lastHoverAt = 0;
      var lastBlockAt = 0;
      var lastEnvHoverAt = 0;
      var chords = [
        [293.66, 369.99, 440.0, 554.37],
        [246.94, 293.66, 369.99, 440.0],
        [196.0, 293.66, 369.99, 493.88],
        [220.0, 277.18, 329.63, 440.0]
      ];
      try {
        enabled = global.localStorage.getItem(SOUND_PREF_KEY) !== 'off';
      } catch (_) {}

      function ensureCtx(allowCreate) {
        if (!enabled || !AudioCtx) return null;
        if (!ctx) {
          if (!allowCreate) return null;
          try {
            ctx = new AudioCtx();
            master = ctx.createGain();
            master.gain.value = 0.72;
            var warmth = ctx.createBiquadFilter();
            warmth.type = 'lowpass';
            warmth.frequency.value = 6800;
            master.connect(warmth);
            warmth.connect(ctx.destination);
          } catch (_) {
            ctx = null;
            return null;
          }
        }
        if (ctx.state === 'suspended' && allowCreate) {
          try { ctx.resume().catch(function () {}); } catch (_) {}
        }
        return ctx;
      }

      function getNoise(c) {
        if (noiseBuffer) return noiseBuffer;
        var length = Math.floor(c.sampleRate * 1.4);
        var buf = c.createBuffer(1, length, c.sampleRate);
        var data = buf.getChannelData(0);
        var b0 = 0;
        var b1 = 0;
        var b2 = 0;
        for (var i = 0; i < length; i++) {
          var white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.963 * b1 + white * 0.2965164;
          b2 = 0.57 * b2 + white * 1.0526913;
          data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
        }
        noiseBuffer = buf;
        return buf;
      }

      function playTone(c, opts) {
        var now = c.currentTime + (opts.delay || 0);
        var osc = c.createOscillator();
        var harm = c.createOscillator();
        var gain = c.createGain();
        var peak = opts.gain || 0.08;
        var dur = opts.dur || 0.7;
        osc.type = opts.type || 'triangle';
        osc.frequency.setValueAtTime(opts.freq, now);
        if (opts.freqEnd) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), now + dur);
        }
        harm.type = 'sine';
        harm.frequency.setValueAtTime(opts.freq * 2, now);
        var harmGain = c.createGain();
        harmGain.gain.value = opts.harm != null ? opts.harm : 0.14;
        harm.connect(harmGain);
        harmGain.connect(gain);
        osc.connect(gain);
        gain.connect(master);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + (opts.attack || 0.014));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.start(now);
        harm.start(now);
        osc.stop(now + dur + 0.05);
        harm.stop(now + dur + 0.05);
      }

      function playNoise(c, opts) {
        var now = c.currentTime + (opts.delay || 0);
        var src = c.createBufferSource();
        src.buffer = getNoise(c);
        var filter = c.createBiquadFilter();
        filter.type = opts.filterType || 'bandpass';
        filter.Q.value = opts.q || 1.3;
        filter.frequency.setValueAtTime(opts.freqStart || 950, now);
        if (opts.freqEnd) {
          filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, now + (opts.dur || 0.4));
        }
        var gain = c.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(opts.gain || 0.06, now + (opts.attack || 0.04));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (opts.dur || 0.4));
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(now);
        src.stop(now + (opts.dur || 0.4) + 0.05);
      }

      function stopAmbient() {
        if (ambientTimer) {
          global.clearInterval(ambientTimer);
          ambientTimer = null;
        }
      }

      function playAmbientChord() {
        if (!enabled || document.hidden) return;
        var c = ensureCtx(false);
        if (!c || c.state !== 'running') return;
        var chord = chords[chordIndex % chords.length];
        chordIndex += 1;
        chord.forEach(function (freq, idx) {
          playTone(c, {
            freq: freq,
            type: 'sine',
            harm: 0.05,
            gain: 0.015,
            attack: 1.5,
            dur: 5.4,
            delay: idx * 0.16
          });
        });
      }

      function startAmbient() {
        stopAmbient();
        if (!enabled || !document.body.classList.contains('is-open')) return;
        playAmbientChord();
        ambientTimer = global.setInterval(playAmbientChord, 6200);
      }

      function syncToggleButtons() {
        all('#sound-toggle,#cover-sound-toggle').forEach(function (btn) {
          btn.setAttribute('aria-pressed', String(enabled));
          btn.setAttribute('aria-label', enabled ? 'Som do convite ativado' : 'Som do convite silenciado');
          var lbl = btn.querySelector('.sound-label, span:last-child');
          if (lbl) lbl.textContent = enabled ? 'Som' : 'Mudo';
        });
      }

      return {
        isEnabled: function () { return enabled; },
        syncUi: syncToggleButtons,
        toggle: function () {
          enabled = !enabled;
          try { global.localStorage.setItem(SOUND_PREF_KEY, enabled ? 'on' : 'off'); } catch (_) {}
          syncToggleButtons();
          if (!enabled) {
            stopAmbient();
            if (master && ctx) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
            return;
          }
          var c = ensureCtx(true);
          if (master && c) master.gain.setTargetAtTime(0.72, c.currentTime, 0.04);
          if (c) {
            playTone(c, { freq: 587.33, type: 'triangle', harm: 0.16, gain: 0.06, dur: 0.55 });
            playTone(c, { freq: 880.0, type: 'sine', harm: 0.08, gain: 0.05, dur: 0.65, delay: 0.07 });
          }
          if (document.body.classList.contains('is-open')) startAmbient();
        },
        envelopeHover: function () {
          var nowMs = global.performance.now();
          if (nowMs - lastEnvHoverAt < 750) return;
          var c = ensureCtx(false);
          if (!c || c.state !== 'running') return;
          lastEnvHoverAt = nowMs;
          playNoise(c, { freqStart: 1350, freqEnd: 1750, q: 1.8, gain: 0.018, attack: 0.03, dur: 0.24 });
        },
        envelopeOpen: function () {
          var c = ensureCtx(true);
          if (!c) return;
          playTone(c, { freq: 145, freqEnd: 58, type: 'sine', harm: 0.05, gain: 0.14, attack: 0.003, dur: 0.14 });
          playNoise(c, { freqStart: 2200, freqEnd: 950, q: 2.1, gain: 0.085, attack: 0.004, dur: 0.075 });
          playNoise(c, { freqStart: 620, freqEnd: 1750, q: 1.2, gain: 0.085, attack: 0.09, dur: 0.72, delay: 0.12 });
          playNoise(c, { freqStart: 1150, freqEnd: 2050, q: 1.5, gain: 0.065, attack: 0.12, dur: 0.95, delay: 0.48 });
          [293.66, 440.0, 659.25, 739.99, 880.0].forEach(function (freq, i) {
            playTone(c, { freq: freq, type: 'triangle', harm: 0.18, gain: 0.075, attack: 0.018, dur: 1.85, delay: 0.62 + i * 0.14 });
          });
        },
        envelopeReveal: function () {
          var c = ensureCtx(false);
          if (!c || c.state !== 'running') return;
          [293.66, 369.99, 440.0, 587.33].forEach(function (freq, i) {
            playTone(c, { freq: freq, type: 'sine', harm: 0.1, gain: 0.045, attack: 0.04, dur: 1.6, delay: i * 0.07 });
          });
          startAmbient();
        },
        stopAmbient: stopAmbient,
        startAmbient: startAmbient,
        click: function () {
          var c = ensureCtx(true);
          if (!c) return;
          playTone(c, { freq: 510, freqEnd: 350, type: 'sine', harm: 0.08, gain: 0.055, attack: 0.003, dur: 0.065 });
          playNoise(c, { freqStart: 1800, freqEnd: 1100, q: 2.4, gain: 0.018, attack: 0.003, dur: 0.035 });
        },
        hover: function () {
          var nowMs = global.performance.now();
          if (nowMs - lastHoverAt < 140) return;
          var c = ensureCtx(false);
          if (!c || c.state !== 'running') return;
          lastHoverAt = nowMs;
          playTone(c, { freq: 1480, freqEnd: 1680, type: 'sine', harm: 0.02, gain: 0.014, attack: 0.004, dur: 0.05 });
        },
        blockChange: function (idx) {
          var nowMs = global.performance.now();
          if (nowMs - lastBlockAt < 480) return;
          var c = ensureCtx(false);
          if (!c || c.state !== 'running') return;
          lastBlockAt = nowMs;
          var notes = [587.33, 659.25, 739.99, 880.0, 659.25, 587.33];
          playNoise(c, { freqStart: 900, freqEnd: 1450, q: 1.6, gain: 0.022, attack: 0.03, dur: 0.24 });
          playTone(c, { freq: notes[idx % notes.length], type: 'sine', harm: 0.08, gain: 0.032, attack: 0.02, dur: 0.65 });
        },
        modal: function (open) {
          var c = ensureCtx(true);
          if (!c) return;
          var seq = open ? [587.33, 880.0] : [739.99, 523.25];
          playTone(c, { freq: seq[0], type: 'triangle', harm: 0.1, gain: 0.05, attack: 0.008, dur: 0.36 });
          playTone(c, { freq: seq[1], type: 'sine', harm: 0.06, gain: 0.045, attack: 0.01, dur: 0.45, delay: 0.065 });
        },
        success: function () {
          var c = ensureCtx(true);
          if (!c) return;
          [587.33, 739.99, 880.0, 1174.66].forEach(function (freq, i) {
            playTone(c, { freq: freq, type: 'triangle', harm: 0.14, gain: 0.065, attack: 0.01, dur: 0.9, delay: i * 0.075 });
          });
        }
      };
    }
    var sound = createSoundEngine();
    sound.syncUi();
    all('#sound-toggle,#cover-sound-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        sound.toggle();
      });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) sound.stopAmbient();
      else if (document.body.classList.contains('is-open')) sound.startAmbient();
    });

    function toast(message) {
      global.clearTimeout(toastTimer);
      byId('toast').textContent = message;
      byId('toast').hidden = false;
      toastTimer = global.setTimeout(function () {
        byId('toast').hidden = true;
      }, 5500);
    }

    // Animação original do envelope do floral-v3 (4174) preservada na íntegra
    var openingTimeline;
    var animatedParts = '.wax-seal,.envelope-flap,.envelope-letter,.stationery,.cover-heading,.open-hint,.cover-bottom>p,.envelope-scene';

    function stopOpening() {
      global.clearTimeout(openingTimer);
      if (openingTimeline) {
        openingTimeline.kill();
        openingTimeline = null;
      }
    }

    var reactBitsMounted = false;
    function reveal(instant) {
      stopOpening();
      opening = false;
      byId('envelope-scene').hidden = true;
      byId('invitation').hidden = false;
      byId('invitation').classList.add('invitation-visible');
      document.documentElement.classList.add('is-open-snap');
      document.body.classList.remove('is-sealed', 'is-opening', 'css-opening');
      document.body.classList.add('is-open');
      if (!instant) sound.envelopeReveal();
      else sound.startAmbient();
      if (!instant) byId('invitation').focus({ preventScroll: true });
      if (global.gsap && !reduced.matches && !instant) {
        global.gsap.fromTo('.hero-copy', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, clearProps: 'transform,opacity' });
        global.gsap.fromTo('.hero-emblem', { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'power3.out', clearProps: 'transform,opacity' });
      }
      if (!reactBitsMounted) {
        reactBitsMounted = true;
        mountReactBits();
      }
      if (typeof markTallBlocks === 'function') markTallBlocks();
      var target;
      try {
        target = document.getElementById(decodeURIComponent(global.location.hash.slice(1)));
      } catch (_) {}
      if (target && target.closest('main')) target.scrollIntoView({ behavior: reduced.matches || instant ? 'auto' : 'smooth' });
      else global.scrollTo({ top: 0, behavior: 'auto' });
    }

    var envelopeBtn = byId('open-invitation');
    var envelopeScene = byId('envelope-scene');
    if (envelopeScene && envelopeBtn) {
      envelopeScene.addEventListener('pointermove', function (e) {
        if (opening || reduced.matches || e.pointerType !== 'mouse') return;
        var rect = envelopeScene.getBoundingClientRect();
        var nx = (e.clientX - rect.left) / rect.width - 0.5;
        var ny = (e.clientY - rect.top) / rect.height - 0.5;
        envelopeBtn.style.transform = 'perspective(1400px) rotateY(' + (nx * 7).toFixed(2) + 'deg) rotateX(' + (-ny * 6).toFixed(2) + 'deg)';
      });
      envelopeScene.addEventListener('pointerleave', function () {
        if (!opening) envelopeBtn.style.transform = '';
      });
      envelopeScene.addEventListener('click', function (e) {
        if (e.target.closest('#cover-sound-toggle')) return;
        if (opening) {
          if (openingTimeline && openingTimeline.time() > 1.8 && openingTimeline.time() < 5.7) {
            openingTimeline.time(5.75);
          }
          return;
        }
        if (e.target.closest('#open-invitation')) return;
        envelopeBtn.click();
      });
      envelopeBtn.addEventListener('pointerenter', function (e) {
        if (!opening && e.pointerType !== 'touch') sound.envelopeHover();
      });
    }

    byId('open-invitation').addEventListener('click', function () {
      if (opening) {
        if (openingTimeline && openingTimeline.time() > 1.8 && openingTimeline.time() < 5.7) {
          openingTimeline.time(5.75);
        }
        return;
      }
      sound.envelopeOpen();
      opening = true;
      this.style.transform = '';
      this.disabled = true;
      this.setAttribute('aria-expanded', 'true');
      document.body.classList.add('is-opening');
      if (reduced.matches) {
        openingTimer = global.setTimeout(function () { reveal(true); }, 20);
        return;
      }
      if (!global.gsap) {
        document.body.classList.add('css-opening');
        openingTimer = global.setTimeout(function () { reveal(false); }, 6400);
        return;
      }
      openingTimeline = global.gsap.timeline({ onComplete: function () { reveal(false); }, defaults: { ease: 'power2.inOut' } });
      openingTimeline
        .to('.cover-heading', { y: -16, opacity: 0, duration: 0.45 }, 0.08)
        .to('.open-hint,.cover-bottom>p', { y: 12, opacity: 0, duration: 0.35 }, 0.1)
        .to('.wax-seal', { scale: 0.94, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' }, 0)
        .set('.wax-seal', { zIndex: 4 }, 0.28)
        .to('.envelope-flap', { transformPerspective: 1400, rotationX: 180, duration: 0.85, transformOrigin: '50% 0%' }, 0.1)
        .set('.envelope-flap', { zIndex: 0 }, 0.52)
        .to('.stationery', { yPercent: 24, rotation: -2, duration: 1.05, ease: 'power2.out' }, 0.48)
        .to('.envelope-letter', { yPercent: -120, duration: 1.35, ease: 'power3.out' }, 0.48)
        .to('.envelope-scene', { opacity: 0, duration: 0.65 }, 5.75);
      openingTimer = global.setTimeout(function () { reveal(false); }, 7800);
    });

    byId('replay-envelope').addEventListener('click', function () {
      sound.stopAmbient();
      sound.modal(false);
      stopOpening();
      opening = false;
      if (global.gsap) global.gsap.set(animatedParts, { clearProps: 'all' });
      byId('invitation').hidden = true;
      byId('invitation').classList.remove('invitation-visible');
      byId('envelope-scene').hidden = false;
      document.documentElement.classList.remove('is-open-snap');
      document.body.classList.remove('is-open', 'is-opening', 'css-opening');
      document.body.classList.add('is-sealed');
      byId('open-invitation').disabled = false;
      byId('open-invitation').setAttribute('aria-expanded', 'false');
      global.scrollTo({ top: 0, behavior: 'auto' });
      byId('open-invitation').focus({ preventScroll: true });
    });

    reduced.addEventListener('change', function () {
      if (reduced.matches && opening) reveal(true);
    });

    if (global.WeddingExperience) {
      var countdownTarget = '';
      try {
        if (event.dateConfirmed && event.startTime) {
          countdownTarget = global.WeddingUtils.zonedDateTimeToUTC(event.date, event.startTime, event.timeZone).toISOString();
        }
      } catch (_) {}
      global.WeddingExperience.mountCountdown(document, global, countdownTarget);
    }

    if ('IntersectionObserver' in global) {
      var blockIds = ['inicio', 'contagem', 'presentes', 'mural', 'dia', 'encerramento'];
      var currentBlockId = '';
      var blockSoundArmed = false;
      var sectionObserver = new global.IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var id = entry.target.id;
            if (currentBlockId && currentBlockId !== id && blockSoundArmed) {
              sound.blockChange(Math.max(0, blockIds.indexOf(id)));
            }
            currentBlockId = id;
            blockSoundArmed = true;
            all('.desktop-nav a,.mobile-menu a').forEach(function (link) {
              if (link.getAttribute('href') === '#' + id) link.setAttribute('aria-current', 'location');
              else link.removeAttribute('aria-current');
            });
            all('.block-dots a').forEach(function (dot) {
              if (dot.getAttribute('data-block-dot') === id) dot.setAttribute('aria-current', 'true');
              else dot.removeAttribute('aria-current');
            });
          });
        },
        { threshold: 0.45 }
      );
      all('#inicio,#contagem,#presentes,#mural,#dia,#encerramento').forEach(function (section) {
        sectionObserver.observe(section);
      });
    }

    document.addEventListener('click', function (e) {
      var target = e.target instanceof Element ? e.target.closest('button,a,.gift-link,.calendar-option') : null;
      if (!target || target.disabled) return;
      if (target.closest('#open-invitation,#sound-toggle,#cover-sound-toggle,#replay-envelope,[data-open-rsvp],[data-open-calendar],[data-open-pix],[data-close-dialog]')) return;
      sound.click();
    });
    if (global.matchMedia('(pointer:fine)').matches) {
      document.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
        var item = e.target.closest('.rb-spotlight,.gift-link');
        if (item) sound.hover();
      }, true);
    }

    // Descida em blocos idêntica ao portfólio: scroll-snap mandatory + data-alto em blocos maiores que a área útil
    var snapBlocks = all('.snap-block');
    var siteHeaderEl = document.querySelector('.site-header');
    var headerBottom = function () {
      return siteHeaderEl ? siteHeaderEl.getBoundingClientRect().bottom : 0;
    };
    function markTallBlocks() {
      if (!document.body.classList.contains('is-open')) return;
      var util = global.innerHeight - headerBottom();
      snapBlocks.forEach(function (sec) {
        sec.toggleAttribute('data-alto', sec.getBoundingClientRect().height > util + 2);
      });
    }
    markTallBlocks();
    global.addEventListener('resize', markTallBlocks, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(markTallBlocks);
    if ('ResizeObserver' in global && snapBlocks.length > 0) {
      var blockRo = new global.ResizeObserver(markTallBlocks);
      snapBlocks.forEach(function (sec) { blockRo.observe(sec); });
    }

    var snapDirs = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
    var snapIgnore = 'input, textarea, select, button, [contenteditable=""], [contenteditable="true"], [role="tablist"], [role="tab"], summary, video, audio';
    var snapPending = null;
    if (snapBlocks.length > 1) {
      document.addEventListener('keydown', function (e) {
        var dir = snapDirs[e.key];
        if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!document.body.classList.contains('is-open') || document.querySelector('dialog[open]')) return;
        if (!global.getComputedStyle(document.documentElement).scrollSnapType.includes('mandatory')) return;
        var focusEl = document.activeElement;
        if (focusEl instanceof Element && focusEl.closest(snapIgnore)) return;

        var now = global.performance.now();
        var scrollY = global.scrollY;
        var line = headerBottom();
        var util = global.innerHeight - line;
        var docEnd = document.documentElement.scrollHeight - global.innerHeight;
        var onTrack = snapPending !== null &&
          scrollY >= Math.min(snapPending.from, snapPending.target) - 2 &&
          scrollY <= Math.max(snapPending.from, snapPending.target) + 2;
        var y = snapPending && onTrack && !e.repeat && now < snapPending.until ? snapPending.target : scrollY;

        var ranges = snapBlocks.map(function (sec) {
          var box = sec.getBoundingClientRect();
          var start = Math.min(docEnd, Math.max(0, box.top + scrollY - line));
          var base = box.height > util + 2 ? Math.min(docEnd, box.bottom + scrollY - global.innerHeight) : start;
          return { start: start, base: Math.max(start, base) };
        });

        var step = e.key.indexOf('Arrow') === 0 ? 40 : Math.round(util * 0.85);
        var inside = ranges.find(function (r) { return r.base > r.start + 2 && y >= r.start - 2 && y <= r.base + 2; });
        var targetY;
        if (inside && dir > 0 && y < inside.base - 2) targetY = Math.min(inside.base, y + step);
        else if (inside && dir < 0 && y > inside.start + 2) targetY = Math.max(inside.start, y - step);
        else {
          var stops = [];
          ranges.forEach(function (r) { stops.push(r.start, r.base); });
          stops.push(docEnd);
          stops.sort(function (a, b) { return a - b; });
          targetY = dir > 0
            ? stops.find(function (s) { return s > y + 2; })
            : stops.slice().reverse().find(function (s) { return s < y - 2; });
        }
        if (targetY === undefined) return;
        e.preventDefault();
        snapPending = { target: targetY, from: scrollY, until: now + 700 };
        global.scrollTo({ top: targetY, behavior: reduced.matches ? 'instant' : 'smooth' });
      });
    }

    // Porte React Bits (AnimatedContent + SpotlightCard)
    var spotlightObserverTargets = new Set();
    var registerSpotlight = function () {};
    function mountReactBits() {
      var calm = reduced.matches;
      // 1) AnimatedContent ([data-reveal])
      var reveals = all('[data-reveal]');
      if (!calm && 'IntersectionObserver' in global && reveals.length > 0) {
        var revealObs = new global.IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              revealObs.unobserve(entry.target);
              entry.target.classList.add('reveal-run');
              entry.target.classList.remove('reveal-pending');
              global.setTimeout(function () { entry.target.classList.remove('reveal-run'); }, 850);
            });
          },
          { rootMargin: '0px 0px -8% 0px' }
        );
        reveals.forEach(function (el) {
          var rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.top > global.innerHeight * 0.9) {
            el.classList.add('reveal-pending');
            revealObs.observe(el);
          }
        });
      }

      // 2) SpotlightCard (.rb-spotlight) em desktop com ponteiro fino
      var finePointer = global.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (finePointer && !calm && 'IntersectionObserver' in global) {
        var states = new WeakMap();
        var visibleCards = new Set();
        var activeCards = new Set();
        var pointer = { x: 0, y: 0, active: false };
        var pressedCard = null;
        var raf = 0;
        var lastT = 0;

        var ensureLayers = function (card) {
          var st = states.get(card);
          if (st) return st;
          var border = document.createElement('span');
          border.className = 'sc-borda';
          border.setAttribute('aria-hidden', 'true');
          var borderDot = document.createElement('i');
          border.append(borderDot, document.createElement('b'));
          var light = document.createElement('span');
          light.className = 'sc-luz';
          light.setAttribute('aria-hidden', 'true');
          var lightDot = document.createElement('i');
          light.append(lightDot);
          card.prepend(border, light);
          st = { light: light, lightDot: lightDot, border: border, borderDot: borderDot, x: 0, y: 0, presence: 0, flare: 0 };
          states.set(card, st);
          return st;
        };

        var scVisObs = new global.IntersectionObserver(
          function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) visibleCards.add(e.target);
              else visibleCards.delete(e.target);
            });
            if (pointer.active) wake();
          },
          { rootMargin: '80px' }
        );

        registerSpotlight = function (el) {
          if (!el || spotlightObserverTargets.has(el)) return;
          spotlightObserverTargets.add(el);
          scVisObs.observe(el);
        };
        all('.rb-spotlight').forEach(registerSpotlight);

        var paint = function (s) {
          var scale = (1 + 0.18 * s.flare).toFixed(3);
          var boost = 1 + 0.65 * s.flare;
          s.lightDot.style.transform = 'translate3d(' + (s.x - 1).toFixed(1) + 'px,' + (s.y - 1).toFixed(1) + 'px,0) scale(' + scale + ')';
          s.borderDot.style.transform = 'translate3d(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px,0) scale(' + scale + ')';
          s.light.style.opacity = Math.min(1, s.presence * 0.15 * 0.34 * boost).toFixed(4);
          s.border.style.opacity = Math.min(1, s.presence * 0.55 * 0.75 * boost).toFixed(4);
        };

        var tick = function (now) {
          raf = 0;
          var dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
          lastT = now;
          var list = new Set(visibleCards);
          activeCards.forEach(function (c) { list.add(c); });
          var rects = new Map();
          list.forEach(function (c) { rects.set(c, c.getBoundingClientRect()); });
          var busy = false;
          list.forEach(function (card) {
            var r = rects.get(card);
            var s = states.get(card);
            var targetP = 0;
            var tx = s ? s.x : 0;
            var ty = s ? s.y : 0;
            if (pointer.active) {
              tx = pointer.x - r.left;
              ty = pointer.y - r.top;
              var d = Math.hypot(Math.max(0, -tx, tx - r.width), Math.max(0, -ty, ty - r.height));
              targetP = d === 0 ? 1 : Math.pow(Math.max(0, 1 - d / 80), 2);
            }
            if (!s) {
              if (targetP <= 0) return;
              s = ensureLayers(card);
            }
            var press = pressedCard === card ? 1 : 0;
            if (targetP === 0 && s.presence === 0 && s.flare === 0 && press === 0) {
              activeCards.delete(card);
              return;
            }
            if (s.presence < 0.02 && targetP > 0) {
              s.x = tx;
              s.y = ty;
            }
            var follow = 1 - Math.exp(-dt / (0.015 + 0.3 * 0.22));
            s.x += (tx - s.x) * follow;
            s.y += (ty - s.y) * follow;
            s.presence += (targetP - s.presence) * (1 - Math.exp(-dt / (targetP > s.presence ? 0.1 : 0.32)));
            if (Math.abs(targetP - s.presence) < 0.002) s.presence = targetP;
            s.flare += (press - s.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
            if (Math.abs(press - s.flare) < 0.002) s.flare = press;
            paint(s);
            if (s.presence > 0 || s.flare > 0) activeCards.add(card);
            else activeCards.delete(card);
            if (Math.abs(tx - s.x) > 0.1 || Math.abs(ty - s.y) > 0.1 || s.presence !== targetP || s.flare !== press) busy = true;
          });
          if (busy) raf = global.requestAnimationFrame(tick);
        };

        var wake = function () {
          if (raf) return;
          lastT = global.performance.now();
          raf = global.requestAnimationFrame(tick);
        };

        document.addEventListener('pointermove', function (e) {
          if (e.pointerType === 'touch') return;
          pointer.x = e.clientX;
          pointer.y = e.clientY;
          pointer.active = true;
          wake();
        }, { passive: true });
        document.addEventListener('pointerout', function (e) {
          if (e.relatedTarget) return;
          pointer.active = false;
          wake();
        }, { passive: true });
        document.addEventListener('pointerdown', function (e) {
          if (e.pointerType === 'touch' || e.button !== 0) return;
          var card = e.target instanceof Element ? e.target.closest('.rb-spotlight') : null;
          if (!card) return;
          pressedCard = card;
          wake();
        }, { passive: true });
        var release = function () {
          if (!pressedCard) return;
          pressedCard = null;
          wake();
        };
        global.addEventListener('pointerup', release, { passive: true });
        global.addEventListener('pointercancel', release, { passive: true });
      }
    }

    function setMenu(open) {
      byId('menu-toggle').setAttribute('aria-expanded', String(open));
      byId('mobile-menu').hidden = !open;
    }
    byId('menu-toggle').addEventListener('click', function () {
      setMenu(this.getAttribute('aria-expanded') !== 'true');
    });
    all('#mobile-menu a,#mobile-menu button').forEach(function (item) {
      item.addEventListener('click', function () {
        setMenu(false);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && byId('menu-toggle').getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        byId('menu-toggle').focus();
      }
    });

    function openDialog(dialog, trigger) {
      if (trigger && trigger.closest('#mobile-menu')) trigger = byId('menu-toggle');
      dialogOpeners.set(dialog, trigger || document.activeElement);
      if (!dialog.open) {
        sound.modal(true);
        dialog.showModal();
      }
      dialog.scrollTop = 0;
    }
    function closeDialog(dialog) {
      if (dialog.open) {
        sound.modal(false);
        dialog.close();
      }
    }
    all('[data-close-dialog]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeDialog(button.closest('dialog'));
      });
    });
    all('dialog').forEach(function (dialog) {
      dialog.addEventListener('close', function () {
        var trigger = dialogOpeners.get(dialog);
        if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
      });
      dialog.addEventListener('click', function (e) {
        if (e.target !== dialog) return;
        var rect = dialog.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          closeDialog(dialog);
        }
      });
    });

    async function copy(value, field) {
      if (global.navigator.clipboard) {
        try {
          await global.navigator.clipboard.writeText(value);
          return true;
        } catch (_) {}
      }
      var temporary = !field;
      if (!field) {
        field = document.createElement('textarea');
        field.value = value;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
      }
      field.focus();
      field.select();
      field.setSelectionRange(0, value.length);
      var success = false;
      try {
        success = document.execCommand('copy');
      } catch (_) {}
      if (temporary) field.remove();
      return success;
    }

    var destination = [event.venue, event.address].filter(Boolean).join(', ');
    all('[data-event-venue]').forEach(function (el) {
      el.textContent = event.venue || 'Local em breve';
    });
    all('[data-event-address]').forEach(function (el) {
      el.textContent = event.address || 'Endereço em breve';
    });
    if (event.mapsUrl) byId('maps-link').href = event.mapsUrl;
    byId('directions-link').href =
      'https://www.google.com/maps/dir/?' +
      new URLSearchParams({ api: '1', destination: destination, travelmode: 'driving' }).toString();
    byId('venue-map').src =
      'https://maps.google.com/maps?' + new URLSearchParams({ q: destination, z: '16', output: 'embed' }).toString();
    byId('copy-address').addEventListener('click', async function () {
      var copied = await copy(destination);
      if (copied) sound.success();
      toast(copied ? 'Endereço copiado.' : 'Selecione e copie o endereço exibido no convite.');
    });

    if (gifts.registryUrl) byId('registry-link').href = gifts.registryUrl;
    if (gifts.amazonUrl) byId('amazon-link').href = gifts.amazonUrl;
    byId('pix-key').value = gifts.pixKey || '';
    if (gifts.pixRecipient) {
      byId('pix-recipient').textContent = 'Favorecido: ' + gifts.pixRecipient;
      byId('pix-recipient').hidden = false;
    }
    all('[data-open-pix]').forEach(function (button) {
      button.addEventListener('click', function () {
        var st = document.querySelector('[data-pix-status]');
        st.className = 'form-status';
        st.textContent = '';
        openDialog(byId('pix-dialog'), button);
      });
    });
    byId('copy-pix').addEventListener('click', async function () {
      var status = document.querySelector('[data-pix-status]');
      if (!gifts.pixKey) {
        status.className = 'form-status is-error';
        status.textContent = 'A chave Pix ainda não está disponível.';
        return;
      }
      var copied = await copy(gifts.pixKey, byId('pix-key'));
      if (copied) sound.success();
      status.className = 'form-status ' + (copied ? 'is-success' : '');
      status.textContent = copied ? 'Chave Pix copiada.' : 'Selecione a chave acima e use a opção Copiar do seu aparelho.';
    });

    function syncCalendarLinks() {
      byId('google-calendar-link').href = global.WeddingUtils.buildGoogleCalendarUrl(config);
      byId('outlook-calendar-link').href = global.WeddingUtils.buildOutlookCalendarUrl(config);
    }
    function downloadIcsFile() {
      var blob = new Blob([global.WeddingUtils.buildICS(config)], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'casamento-yuri-geovanna.ics';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 30000);
    }
    all('[data-apple-calendar]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var usesStaticDefault =
          global.location &&
          /^https?:$/i.test(global.location.protocol) &&
          event.date === '2027-01-13' &&
          event.startTime === '19:00' &&
          !event.endTime;
        if (usesStaticDefault) return;
        e.preventDefault();
        try {
          var ics = global.WeddingUtils.buildICS(config);
          var isApple = /iPad|iPhone|iPod|Macintosh/i.test(global.navigator.userAgent || '');
          if (isApple) global.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
          else downloadIcsFile();
        } catch (error) {
          toast(error.message);
        }
      });
    });
    function openCalendarModal(trigger) {
      try {
        syncCalendarLinks();
        byId('calendar-status').textContent = '13 de janeiro de 2027, às 19h · Casa Colonial. Escolha sua agenda:';
        byId('calendar-options').hidden = false;
      } catch (error) {
        byId('calendar-status').textContent = error.message;
        byId('calendar-options').hidden = true;
      }
      openDialog(byId('calendar-dialog'), trigger);
    }
    all('[data-open-calendar]').forEach(function (button) {
      button.addEventListener('click', function () {
        openCalendarModal(button);
      });
    });
    byId('download-ics').addEventListener('click', function () {
      try {
        downloadIcsFile();
        byId('calendar-status').textContent = 'Arquivo .ics baixado. Abra na sua agenda para concluir a inclusão.';
      } catch (error) {
        byId('calendar-status').textContent = error.message;
      }
    });

    function getPublicShareUrl() {
      if (config.site && config.site.url && /^https?:\/\//i.test(config.site.url)) {
        return config.site.url;
      }
      try {
        var u = new URL(global.location.href);
        u.searchParams.delete('c');
        u.searchParams.delete('convite');
        u.searchParams.delete('token');
        u.searchParams.delete('aberto');
        u.hash = '';
        return u.toString();
      } catch (_) {
        return global.location.href.split('?')[0].split('#')[0];
      }
    }

    byId('share-invitation').addEventListener('click', async function () {
      var url = getPublicShareUrl();
      if (!/^https?:\/\//i.test(url)) {
        toast('O link público estará disponível quando o convite for publicado.');
        return;
      }
      if (global.navigator.share) {
        try {
          await global.navigator.share({
            title: 'Yuri & Geovanna · Nosso casamento',
            text: 'Um convite para celebrar o nosso sim.',
            url: url
          });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return;
        }
      }
      var sharedCopy = await copy(url);
      if (sharedCopy) sound.success();
      toast(sharedCopy ? 'Link público do convite copiado.' : 'Copie o endereço público na barra do navegador.');
    });

    var apiBase = String((config.guestbook && config.guestbook.apiBase) || '').replace(/\/$/, '');
    var isStaticPages = !apiBase && /github\.io$/i.test(global.location.hostname);
    async function request(path, options) {
      if (isStaticPages) {
        var staticErr = new Error('Nesta prévia estática do GitHub Pages, o envio direto fica ativo com a API conectada ou pelo WhatsApp (92) 98484-9557.');
        staticErr.isStaticPages = true;
        throw staticErr;
      }
      var response = await fetch(
        apiBase + path,
        Object.assign({ headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }, options)
      );
      if (!(response.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('Não conseguimos enviar agora. Confira sua conexão e tente novamente.');
      }
      var result = await response.json();
      if (!response.ok) {
        var err = new Error(result.error || 'Não conseguimos enviar agora. Confira sua conexão e tente novamente.');
        err.status = response.status;
        throw err;
      }
      return result;
    }
    function requestId() {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
      if (!global.crypto || !global.crypto.getRandomValues) {
        throw new Error('Abra o convite por HTTPS ou pelo endereço local e tente novamente.');
      }
      var b = global.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var s = Array.from(b, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
      return s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20);
    }

    // Mural de Recados com moderação prévia (exibe aprovados; novos entram pendentes)
    var seen = new Set();
    var cursor = null;
    var loading = false;
    function renderMessage(item, first) {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      var card = document.createElement('article');
      card.className = 'message-card rb-spotlight';
      var text = document.createElement('p');
      text.textContent = item.message;
      var footer = document.createElement('footer');
      var name = document.createElement('strong');
      var date = document.createElement('time');
      name.textContent = item.name;
      date.dateTime = item.createdAt;
      date.textContent = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        timeZone: 'America/Manaus'
      }).format(new Date(item.createdAt));
      footer.append(name, date);
      card.append(text, footer);
      if (first) byId('guestbook-list').prepend(card);
      else byId('guestbook-list').appendChild(card);
      registerSpotlight(card);
    }
    async function loadMessages() {
      if (loading) return;
      loading = true;
      byId('guestbook-retry').hidden = true;
      byId('guestbook-status').textContent = 'Carregando os recados…';
      try {
        var result = await request('/api/messages' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''));
        result.messages.forEach(function (item) {
          renderMessage(item, false);
        });
        cursor = result.nextCursor;
        byId('guestbook-more').hidden = !cursor;
        byId('guestbook-status').textContent = seen.size
          ? 'Recados cheios de carinho para a nossa história.'
          : 'Ainda não há recados por aqui. Que tal deixar o primeiro?';
      } catch (err) {
        if (err && err.isStaticPages) {
          byId('guestbook-status').textContent = 'Ainda não há recados por aqui. Que tal deixar o primeiro?';
          byId('guestbook-retry').hidden = true;
        } else {
          byId('guestbook-status').textContent = 'Não conseguimos carregar o mural agora.';
          byId('guestbook-retry').hidden = false;
        }
      } finally {
        loading = false;
      }
    }
    byId('guestbook-more').addEventListener('click', loadMessages);
    byId('guestbook-retry').addEventListener('click', loadMessages);
    if ('IntersectionObserver' in global) {
      var observer = new IntersectionObserver(
        function (entries) {
          if (!muralLoaded && entries.some(function (entry) { return entry.isIntersecting; })) {
            muralLoaded = true;
            observer.disconnect();
            loadMessages();
          }
        },
        { rootMargin: '350px' }
      );
      observer.observe(byId('mural'));
    } else {
      loadMessages();
    }

    byId('message-text').addEventListener('input', function () {
      byId('message-count').textContent = this.value.length + ' / 600';
    });
    byId('rsvp-message-text').addEventListener('input', function () {
      byId('rsvp-message-count').textContent = this.value.length + ' / 600';
    });

    function bindForm(settings) {
      var form = byId(settings.form);
      var sending = false;
      var id;
      form.addEventListener('input', function () {
        if (!sending) id = null;
      });
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (sending || !form.reportValidity()) return;
        sending = true;
        var button = byId(settings.button);
        var originalHtml = button.innerHTML;
        var status = byId(settings.status);
        var fields = Array.from(form.querySelectorAll('input,textarea,select,button'));
        button.disabled = true;
        button.textContent = 'Enviando...';
        fields.forEach(function (field) {
          if (field.tagName === 'SELECT' || field.tagName === 'BUTTON') field.disabled = true;
          else field.readOnly = true;
        });
        status.className = 'form-status';
        status.textContent = 'Enviando...';
        try {
          if (!id) id = requestId();
          var body = Object.assign(settings.payload(), { requestId: id });
          var result = await request(settings.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          settings.success(result, status);
          form.reset();
          id = null;
        } catch (error) {
          status.className = 'form-status is-error';
          status.textContent =
            error.name === 'TimeoutError' || error.message === 'Failed to fetch'
              ? 'Não conseguimos enviar agora. Confira sua conexão e tente novamente.'
              : error.message;
        } finally {
          sending = false;
          button.disabled = false;
          button.innerHTML = originalHtml;
          fields.forEach(function (field) {
            if (field.tagName === 'SELECT' || field.tagName === 'BUTTON') field.disabled = false;
            else field.readOnly = false;
          });
        }
      });
    }

    var PENDING_MESSAGE_NOTICE = 'Recebemos sua mensagem com carinho!\nObrigado por fazer parte desse momento. Logo mais, seu recado estará disponível no mural.';
    function onMessageSubmitted(result, status, countId) {
      if (!result.message || !result.message.id) {
        throw new Error('Não conseguimos enviar agora. Confira sua conexão e tente novamente.');
      }
      if (result.message.status === 'approved') renderMessage(result.message, true);
      byId(countId).textContent = '0 / 600';
      status.className = 'form-status is-success';
      status.textContent = PENDING_MESSAGE_NOTICE;
      sound.success();
      toast('Recebemos sua mensagem com carinho! Logo mais estará no mural.');
    }

    bindForm({
      form: 'message-form',
      button: 'send-message',
      status: 'message-status',
      endpoint: '/api/messages',
      payload: function () {
        return {
          name: byId('message-name').value,
          message: byId('message-text').value,
          website: byId('message-website').value
        };
      },
      success: function (result, status) {
        onMessageSubmitted(result, status, 'message-count');
      }
    });

    bindForm({
      form: 'rsvp-message-form',
      button: 'rsvp-send-message',
      status: 'rsvp-message-status',
      endpoint: '/api/messages',
      payload: function () {
        return {
          name: byId('rsvp-message-name').value,
          message: byId('rsvp-message-text').value,
          website: byId('rsvp-message-website').value
        };
      },
      success: function (result, status) {
        onMessageSubmitted(result, status, 'rsvp-message-count');
      }
    });

    byId('open-message').addEventListener('click', function () {
      if (currentRespondentName && !byId('message-name').value) byId('message-name').value = currentRespondentName;
      byId('message-status').className = 'form-status';
      byId('message-status').textContent = '';
      openDialog(byId('message-dialog'), this);
    });

    // RSVP por convite individual (?c=TOKEN) + revisão + edição posterior
    var currentInvite = null;
    var currentInviteToken = '';
    var currentRespondentName = '';
    var pendingRsvpPayload = null;
    var pendingRsvpRequestId = null;
    var guestsList = byId('rsvp-guests-list');
    var guestCounter = 0;

    if (rsvpConfig.askAge) byId('guest-age-field').hidden = false;

    function extractTokenFromString(raw) {
      var text = String(raw || '').trim();
      if (!text) return '';
      try {
        if (/^https?:\/\//i.test(text)) {
          var parsed = new URL(text);
          return parsed.searchParams.get('c') || parsed.searchParams.get('convite') || parsed.searchParams.get('token') || '';
        }
      } catch (_) {}
      var match = /[?&](?:c|convite|token)=([a-z0-9-_]+)/i.exec(text);
      if (match) return match[1];
      return text.replace(/[^a-zA-Z0-9-_]/g, '');
    }

    function getMaxAllowedGuests() {
      return currentInvite && currentInvite.maxGuests ? Number(currentInvite.maxGuests) : 10;
    }

    function getSelectedResponse() {
      var noRadio = byId('response-no');
      return noRadio && noRadio.checked ? 'no' : 'yes';
    }

    function setSelectedResponse(val) {
      var isNo = val === 'no';
      byId('response-yes').checked = !isNo;
      byId('response-no').checked = isNo;
      byId('guest-response').value = isNo ? 'no' : 'yes';
      updateResponseMode();
    }

    function updateFamilyCount() {
      var count = guestsList.querySelectorAll('.guest-row').length;
      var max = getMaxAllowedGuests();
      byId('family-count').textContent = count + ' de ' + max + (max === 1 ? ' lugar informado' : ' lugares informados');
      var reachedLimit = count >= max;
      byId('add-guest-btn').disabled = reachedLimit;
      byId('extra-seat-note').hidden = !reachedLimit;
    }

    function addGuestRow(initialName, focusNew) {
      var max = getMaxAllowedGuests();
      var currentCount = guestsList.querySelectorAll('.guest-row').length;
      if (currentCount >= max) return;
      guestCounter += 1;
      var idx = guestCounter;
      var row = document.createElement('div');
      row.className = 'guest-row' + (rsvpConfig.askAge ? ' has-age' : '');

      var nameWrap = document.createElement('div');
      var nameLabel = document.createElement('label');
      nameLabel.setAttribute('for', 'person-name-' + idx);
      nameLabel.textContent = currentCount === 0 ? 'Pessoa 1 (ex.: você)' : 'Pessoa ' + (currentCount + 1);
      var nameInput = document.createElement('input');
      nameInput.id = 'person-name-' + idx;
      nameInput.name = 'personName';
      nameInput.maxLength = 120;
      nameInput.required = getSelectedResponse() === 'yes';
      nameInput.placeholder = 'Nome completo de quem estará presente';
      if (initialName) nameInput.value = initialName;
      nameWrap.append(nameLabel, nameInput);
      row.appendChild(nameWrap);

      if (rsvpConfig.askAge) {
        var ageWrap = document.createElement('div');
        var ageLabel = document.createElement('label');
        ageLabel.setAttribute('for', 'person-age-' + idx);
        ageLabel.textContent = 'Idade';
        var ageInput = document.createElement('input');
        ageInput.id = 'person-age-' + idx;
        ageInput.name = 'personAge';
        ageInput.type = 'number';
        ageInput.inputMode = 'numeric';
        ageInput.min = '0';
        ageInput.max = '120';
        ageInput.placeholder = 'Opcional';
        ageWrap.append(ageLabel, ageInput);
        row.appendChild(ageWrap);
      }

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'guest-remove';
      removeBtn.textContent = 'Remover';
      removeBtn.addEventListener('click', function () {
        if (guestsList.querySelectorAll('.guest-row').length <= 1) {
          nameInput.value = '';
          nameInput.focus();
          return;
        }
        row.remove();
        Array.from(guestsList.querySelectorAll('.guest-row')).forEach(function (r, i) {
          var lbl = r.querySelector('label');
          if (lbl) lbl.textContent = i === 0 ? 'Pessoa 1 (ex.: você)' : 'Pessoa ' + (i + 1);
        });
        updateFamilyCount();
        byId('add-guest-btn').focus();
      });
      row.appendChild(removeBtn);

      guestsList.appendChild(row);
      updateFamilyCount();
      if (focusNew) nameInput.focus();
    }

    function clearGuests() {
      guestsList.innerHTML = '';
      updateFamilyCount();
    }

    function ensureAtLeastOneGuestRow() {
      if (guestsList.querySelectorAll('.guest-row').length === 0) {
        addGuestRow(byId('guest-name').value.trim(), false);
      }
    }

    byId('guest-name').addEventListener('blur', function () {
      var firstInput = guestsList.querySelector('.guest-row input[name="personName"]');
      if (firstInput && !firstInput.value.trim() && this.value.trim()) {
        firstInput.value = this.value.trim();
      }
    });

    function updateResponseMode() {
      var isYes = getSelectedResponse() === 'yes';
      byId('guest-response').value = isYes ? 'yes' : 'no';
      byId('companions-field').hidden = !isYes;
      byId('absence-note-field').hidden = isYes;
      byId('guest-phone').required = isYes;
      byId('guest-phone-label').textContent = isYes ? 'WhatsApp ou telefone' : 'Telefone para contato (opcional)';
      if (isYes) ensureAtLeastOneGuestRow();
      all('#rsvp-guests-list input, #rsvp-guests-list button, #add-guest-btn').forEach(function (el) {
        el.disabled = !isYes;
      });
      if (isYes) updateFamilyCount();
    }

    byId('response-yes').addEventListener('change', updateResponseMode);
    byId('response-no').addEventListener('change', updateResponseMode);
    byId('guest-response').addEventListener('change', function () {
      setSelectedResponse(this.value);
    });
    byId('add-guest-btn').addEventListener('click', function () {
      addGuestRow('', true);
    });

    function collectAttendingGuests() {
      if (getSelectedResponse() !== 'yes') return [];
      var list = [];
      Array.from(guestsList.querySelectorAll('.guest-row')).forEach(function (row) {
        var nameEl = row.querySelector('input[name="personName"]');
        var ageEl = row.querySelector('input[name="personAge"]');
        var clean = String((nameEl && nameEl.value) || '').trim();
        if (clean) {
          var item = { name: clean };
          if (ageEl && ageEl.value !== '') item.age = Number(ageEl.value);
          list.push(item);
        }
      });
      return list;
    }

    function showRsvpStep(step) {
      var steps = {
        token: byId('rsvp-step-token'),
        existing: byId('rsvp-step-existing'),
        form: byId('rsvp-step-form'),
        review: byId('rsvp-step-review'),
        next: byId('rsvp-step-next'),
        message: byId('rsvp-step-message')
      };
      Object.keys(steps).forEach(function (k) {
        if (steps[k]) steps[k].hidden = k !== step;
      });
      byId('rsvp-dialog').scrollTop = 0;
    }

    function renderInviteSummaryHtml(data) {
      var box = document.createElement('div');
      if (data.status === 'yes' || data.response === 'yes') {
        var guests = data.confirmedGuests || data.guests || [];
        var count = guests.length || 1;
        var p1 = document.createElement('p');
        p1.innerHTML = 'Você informou que <strong>' + count + (count === 1 ? ' pessoa estará presente' : ' pessoas estarão presentes') + '</strong>:';
        box.appendChild(p1);
        var ul = document.createElement('ul');
        ul.className = 'review-list';
        guests.forEach(function (g) {
          var li = document.createElement('li');
          li.textContent = typeof g === 'string' ? g : g.name;
          ul.appendChild(li);
        });
        box.appendChild(ul);
      } else {
        var pNo = document.createElement('p');
        pNo.innerHTML = 'Você informou que <strong>não poderá comparecer</strong>.';
        box.appendChild(pNo);
        if (data.respondentName || data.name) {
          var pResp = document.createElement('p');
          pResp.textContent = 'Responsável: ' + (data.respondentName || data.name);
          box.appendChild(pResp);
        }
        if (data.absenceNote) {
          var pNote = document.createElement('p');
          pNote.textContent = 'Mensagem: “' + data.absenceNote + '”';
          box.appendChild(pNote);
        }
      }
      var phoneMaskText = data.phoneMask || maskPhone(data.phone || '');
      if (phoneMaskText && phoneMaskText !== 'não informado') {
        var pPhone = document.createElement('p');
        pPhone.textContent = 'Telefone: ' + phoneMaskText;
        box.appendChild(pPhone);
      }
      return box;
    }

    function syncInviteUi() {
      var metaEl = byId('rsvp-invite-meta');
      var badgeEl = byId('invite-personal-badge');
      var resumePill = byId('rsvp-resume-pill');

      if (currentInvite) {
        metaEl.hidden = false;
        metaEl.textContent = 'Convite para ' + currentInvite.familyName + ' · Pessoas previstas: até ' + currentInvite.maxGuests;
        badgeEl.hidden = false;
        byId('invite-badge-family').textContent = 'Convite para ' + currentInvite.familyName;
        byId('invite-badge-limit').textContent = '· Até ' + currentInvite.maxGuests + (currentInvite.maxGuests === 1 ? ' pessoa' : ' pessoas');

        if (currentInvite.respondentName) {
          currentRespondentName = currentInvite.respondentName;
        }
        var hasAnswered = currentInvite.status === 'yes' || currentInvite.status === 'no';
        resumePill.hidden = !hasAnswered;
        all('[data-rsvp-cta-label]').forEach(function (el) {
          el.textContent = hasAnswered ? 'Consultar ou alterar resposta' : 'Confirmar presença';
        });
      } else {
        metaEl.hidden = true;
        badgeEl.hidden = true;
        resumePill.hidden = true;
      }
      updateFamilyCount();
    }

    function populateFormFromInvite(invite) {
      clearGuests();
      if (!invite) {
        setSelectedResponse('yes');
        ensureAtLeastOneGuestRow();
        return;
      }
      byId('guest-name').value = invite.respondentName || '';
      byId('guest-absence-note').value = invite.absenceNote || '';
      if (invite.status === 'no') {
        setSelectedResponse('no');
      } else {
        byId('response-yes').checked = true;
        byId('response-no').checked = false;
        var list = Array.isArray(invite.confirmedGuests) && invite.confirmedGuests.length
          ? invite.confirmedGuests
          : [{ name: invite.respondentName || '' }];
        list.forEach(function (g) {
          addGuestRow(typeof g === 'string' ? g : g.name, false);
        });
        setSelectedResponse('yes');
      }
      updateFamilyCount();
    }

    function populateExistingStep() {
      if (!currentInvite) return;
      var container = byId('rsvp-existing-summary');
      container.innerHTML = '';
      container.appendChild(renderInviteSummaryHtml(currentInvite));
      byId('rsvp-existing-calendar').hidden = currentInvite.status !== 'yes';
    }

    async function loadInviteByToken(token, silent) {
      var clean = extractTokenFromString(token);
      if (!clean) return false;
      try {
        var result = await request('/api/invite?token=' + encodeURIComponent(clean));
        if (result && result.invite) {
          currentInvite = result.invite;
          currentInviteToken = currentInvite.token;
          try {
            global.localStorage.setItem(INVITE_TOKEN_KEY, currentInviteToken);
          } catch (_) {}
          syncInviteUi();
          populateFormFromInvite(currentInvite);
          return true;
        }
      } catch (error) {
        if (!silent) throw error;
      }
      return false;
    }

    byId('rsvp-token-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var input = byId('invite-token-input');
      var status = byId('rsvp-token-status');
      var btn = byId('load-invite-btn');
      var token = extractTokenFromString(input.value);
      if (!token) {
        status.className = 'form-status is-error';
        status.textContent = 'Informe o código ou cole o link do seu convite.';
        return;
      }
      btn.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Consultando convite...';
      try {
        await loadInviteByToken(token, false);
        status.textContent = '';
        if (currentInvite.status === 'yes' || currentInvite.status === 'no') {
          populateExistingStep();
          showRsvpStep('existing');
        } else {
          showRsvpStep('form');
        }
      } catch (error) {
        status.className = 'form-status is-error';
        status.textContent = error.message || 'Convite não encontrado.';
      } finally {
        btn.disabled = false;
      }
    });

    byId('rsvp-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var status = byId('rsvp-status');
      status.className = 'form-status';
      status.textContent = '';
      if (!this.reportValidity()) return;

      var resp = getSelectedResponse();
      var name = byId('guest-name').value.trim();
      var phone = byId('guest-phone').value.trim();
      var digits = (phone.match(/\d/g) || []).length;

      if (!name) {
        status.className = 'form-status is-error';
        status.textContent = 'Informe o nome do responsável pela resposta.';
        byId('guest-name').focus();
        return;
      }
      if (resp === 'yes' || phone.length > 0) {
        if (phone.length < 8 || digits < 8) {
          status.className = 'form-status is-error';
          status.textContent = 'Informe um WhatsApp ou telefone válido com DDD.';
          byId('guest-phone').focus();
          return;
        }
      }

      var attendingGuests = collectAttendingGuests();
      if (resp === 'yes') {
        if (attendingGuests.length === 0) attendingGuests = [{ name: name }];
        var max = getMaxAllowedGuests();
        if (attendingGuests.length > max) {
          status.className = 'form-status is-error';
          status.textContent = 'Este convite permite até ' + max + ' pessoa(s).';
          return;
        }
      }

      var ageVal = byId('guest-age').value;
      pendingRsvpPayload = {
        name: name,
        age: ageVal !== '' ? Number(ageVal) : null,
        response: resp,
        guests: resp === 'yes' ? attendingGuests : [],
        phone: phone,
        absenceNote: resp === 'no' ? byId('guest-absence-note').value.trim() : '',
        inviteToken: currentInviteToken || '',
        website: byId('rsvp-website').value
      };
      pendingRsvpRequestId = null;

      var reviewContainer = byId('rsvp-review-box');
      reviewContainer.innerHTML = '';
      reviewContainer.appendChild(renderInviteSummaryHtml(pendingRsvpPayload));
      byId('rsvp-review-status').className = 'form-status';
      byId('rsvp-review-status').textContent = '';
      showRsvpStep('review');
      byId('send-rsvp').focus();
    });

    byId('back-to-edit-rsvp').addEventListener('click', function () {
      showRsvpStep('form');
      byId('guest-name').focus();
    });

    var sendingRsvp = false;
    byId('send-rsvp').addEventListener('click', async function () {
      if (sendingRsvp || !pendingRsvpPayload) return;
      sendingRsvp = true;
      var btn = this;
      var backBtn = byId('back-to-edit-rsvp');
      var status = byId('rsvp-review-status');
      var originalHtml = btn.innerHTML;
      btn.disabled = true;
      backBtn.disabled = true;
      btn.textContent = 'Enviando...';
      status.className = 'form-status';
      status.textContent = 'Enviando...';

      try {
        if (!pendingRsvpRequestId) pendingRsvpRequestId = requestId();
        var body = Object.assign({}, pendingRsvpPayload, { requestId: pendingRsvpRequestId });
        var result = await request('/api/rsvps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!result || !result.confirmation || !result.confirmation.id) {
          throw new Error('Não conseguimos enviar agora. Confira sua conexão e tente novamente.');
        }
        if (result.invite) {
          currentInvite = result.invite;
        } else if (currentInvite) {
          currentInvite.status = pendingRsvpPayload.response;
          currentInvite.respondentName = pendingRsvpPayload.name;
          currentInvite.confirmedGuests = pendingRsvpPayload.guests;
          currentInvite.confirmedCount = pendingRsvpPayload.guests.length;
          currentInvite.phoneMask = maskPhone(pendingRsvpPayload.phone);
          currentInvite.absenceNote = pendingRsvpPayload.absenceNote;
        }
        currentRespondentName = pendingRsvpPayload.name;
        syncInviteUi();
        var heading = byId('rsvp-next-heading');
        var nextSummary = byId('rsvp-next-summary');
        var calBtn = byId('rsvp-open-calendar');
        if (pendingRsvpPayload.response === 'yes') {
          heading.innerHTML = 'Presença <em>confirmada!</em>';
          nextSummary.textContent = 'Recebemos sua resposta e estamos felizes por celebrar esse dia com você.';
          calBtn.hidden = false;
        } else {
          heading.innerHTML = 'Resposta <em>recebida.</em>';
          nextSummary.textContent = 'Sentiremos sua falta, mas agradecemos por nos avisar e pelo carinho.';
          calBtn.hidden = true;
        }
        showRsvpStep('next');
        sound.success();
        toast(pendingRsvpPayload.response === 'yes' ? 'Presença confirmada!' : 'Resposta recebida.');
      } catch (error) {
        status.className = 'form-status is-error';
        status.textContent =
          error.name === 'TimeoutError' || error.message === 'Failed to fetch'
            ? 'Não conseguimos enviar agora. Confira sua conexão e tente novamente.'
            : error.message;
      } finally {
        sendingRsvp = false;
        btn.disabled = false;
        backBtn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });

    byId('rsvp-open-calendar').addEventListener('click', function () {
      closeDialog(byId('rsvp-dialog'));
      openCalendarModal(this);
    });
    byId('rsvp-existing-calendar').addEventListener('click', function () {
      closeDialog(byId('rsvp-dialog'));
      openCalendarModal(this);
    });
    function openInlineMessageFromRsvp() {
      if (currentRespondentName && !byId('rsvp-message-name').value) {
        byId('rsvp-message-name').value = currentRespondentName;
      }
      byId('rsvp-message-status').className = 'form-status';
      byId('rsvp-message-status').textContent = '';
      showRsvpStep('message');
      byId('rsvp-message-text').focus();
    }
    byId('rsvp-next-message').addEventListener('click', openInlineMessageFromRsvp);
    byId('rsvp-existing-message').addEventListener('click', openInlineMessageFromRsvp);
    all('[data-rsvp-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showRsvpStep(btn.getAttribute('data-rsvp-back') || 'next');
      });
    });

    function startAlterResponse() {
      populateFormFromInvite(currentInvite);
      byId('rsvp-status').className = 'form-status';
      byId('rsvp-status').textContent = '';
      showRsvpStep('form');
      byId('guest-name').focus();
    }
    byId('rsvp-start-alter').addEventListener('click', startAlterResponse);
    byId('rsvp-edit-response').addEventListener('click', startAlterResponse);

    function openRsvpModal(trigger) {
      if (currentInvite) {
        if (currentInvite.status === 'yes' || currentInvite.status === 'no') {
          populateExistingStep();
          showRsvpStep('existing');
        } else {
          populateFormFromInvite(currentInvite);
          showRsvpStep('form');
        }
      } else if (rsvpConfig.requireInviteLink !== false) {
        byId('rsvp-token-status').textContent = '';
        showRsvpStep('token');
      } else {
        ensureAtLeastOneGuestRow();
        showRsvpStep('form');
      }
      openDialog(byId('rsvp-dialog'), trigger);
    }

    all('[data-open-rsvp]').forEach(function (button) {
      button.addEventListener('click', function () {
        openRsvpModal(button);
      });
    });
    byId('rsvp-resume-pill').addEventListener('click', function () {
      openRsvpModal(this);
    });

    updateResponseMode();
    (async function bootstrap() {
      var params;
      try {
        params = new URLSearchParams(global.location.search);
      } catch (_) {
        params = new URLSearchParams();
      }
      var urlToken = params.get('c') || params.get('convite') || params.get('token') || '';
      var storedToken = '';
      try {
        storedToken = global.localStorage.getItem(INVITE_TOKEN_KEY) || '';
      } catch (_) {}

      if (urlToken) await loadInviteByToken(urlToken, true);
      else if (storedToken) await loadInviteByToken(storedToken, true);

      if (params.get('aberto') === '1') {
        reveal(true);
      }
    })();
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
