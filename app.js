(function (global) {
  'use strict';

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('Informe uma data válida.');
    var date = new Date(value + 'T00:00:00Z');
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.');
    return date;
  }

  function nextDay(value) {
    var date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function validateTime(value) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new Error('Informe o horário no formato HH:MM.');
  }

  function compactUTC(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function zonedDateTimeToUTC(dateISO, timeHHMM, timeZone) {
    parseDate(dateISO);
    validateTime(timeHHMM);
    if (!timeZone) throw new Error('Informe o fuso horário do evento.');
    var target = Date.parse(dateISO + 'T' + timeHHMM + ':00Z');
    var candidate = target;
    var formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    function wallTime(timestamp) {
      var parts = {};
      formatter.formatToParts(new Date(timestamp)).forEach(function (part) { parts[part.type] = part.value; });
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    }
    for (var i = 0; i < 5; i += 1) {
      var difference = target - wallTime(candidate);
      if (difference === 0) return new Date(candidate);
      candidate += difference;
    }
    if (wallTime(candidate) !== target) throw new Error('O horário não existe nesse fuso. Confira a data e o horário.');
    return new Date(candidate);
  }

  function getCalendarData(config) {
    var event = config.event || {};
    if (event.dateConfirmed !== true) throw new Error('A data será disponibilizada em breve.');
    parseDate(event.date);
    var allDay = !event.startTime;
    var start;
    var end;
    if (allDay) {
      start = event.date.replace(/-/g, '');
      end = nextDay(event.date).replace(/-/g, '');
    } else {
      var startDate = zonedDateTimeToUTC(event.date, event.startTime, event.timeZone);
      start = compactUTC(startDate);
      end = '';
      if (event.endTime) {
        validateTime(event.endTime);
        var endDay = event.endTime <= event.startTime ? nextDay(event.date) : event.date;
        end = compactUTC(zonedDateTimeToUTC(endDay, event.endTime, event.timeZone));
      }
    }
    var names = (config.couple && config.couple.firstNames) || 'Geovanna & Yuri';
    var location = [event.venue, event.address].filter(Boolean).join(' — ');
    var description = 'Vamos celebrar o casamento de ' + names + '!';
    if (config.site && /^https?:\/\//i.test(config.site.url || '')) description += '\nConvite: ' + config.site.url;
    return { allDay: allDay, start: start, end: end, title: 'Casamento de ' + names, location: location, description: description };
  }

  function buildGoogleCalendarUrl(config) {
    var event = getCalendarData(config);
    var params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates: event.start + '/' + (event.end || event.start), details: event.description });
    if (event.location) params.set('location', event.location);
    if (config.event.timeZone) params.set('ctz', config.event.timeZone);
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function escapeICS(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
  }

  function utf8Length(character) {
    var point = character.codePointAt(0);
    return point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
  }

  function foldICSLine(line) {
    var result = '';
    var bytes = 0;
    for (var character of String(line)) {
      var size = utf8Length(character);
      if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
      result += character;
      bytes += size;
    }
    return result;
  }

  function stableHash(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16);
  }

  function buildICS(config, now) {
    var event = getCalendarData(config);
    var uid = 'geovanna-yuri-' + stableHash(event.title + '|' + config.event.date) + '@convite.local';
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Geovanna e Yuri//Convite de casamento//PT-BR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + compactUTC(now || new Date()), 'DTSTART' + (event.allDay ? ';VALUE=DATE:' : ':') + event.start];
    if (event.end) lines.push('DTEND' + (event.allDay ? ';VALUE=DATE:' : ':') + event.end);
    lines.push('SUMMARY:' + escapeICS(event.title), 'DESCRIPTION:' + escapeICS(event.description));
    if (event.location) lines.push('LOCATION:' + escapeICS(event.location));
    if (config.site && /^https?:\/\//i.test(config.site.url || '')) lines.push('URL:' + config.site.url.replace(/[\r\n]/g, ''));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldICSLine).join('\r\n') + '\r\n';
  }

  function buildRsvpMessage(config, guest) {
    var name = String(guest.name || '').trim();
    if (!name) throw new Error('Escreva seu nome para preparar a mensagem.');
    var response = guest.response === 'no' ? 'Infelizmente, não poderei comparecer.' : 'Quero confirmar minha presença!';
    var names = (config.couple && config.couple.firstNames) || 'Geovanna & Yuri';
    var message = 'Olá, ' + names + '! Meu nome é ' + name + '. ' + response;
    if (config.rsvp && config.rsvp.allowCompanions && guest.response !== 'no') {
      var companions = Number(guest.companions || 0);
      if (!Number.isInteger(companions) || companions < 0 || companions > 99) throw new Error('Informe uma quantidade válida de acompanhantes.');
      message += '\nAcompanhantes: ' + companions + '.';
    }
    return message;
  }

  global.WeddingUtils = Object.freeze({
    buildGoogleCalendarUrl: buildGoogleCalendarUrl, buildICS: buildICS, buildRsvpMessage: buildRsvpMessage,
    getCalendarData: getCalendarData, escapeICS: escapeICS, foldICSLine: foldICSLine, zonedDateTimeToUTC: zonedDateTimeToUTC
  });

  if (!global.document) return;
  function init() {
    var document=global.document, config=global.WEDDING_CONFIG||{}, event=config.event||{}, gifts=config.gifts||{};
    var byId=function(id){return document.getElementById(id);};
    var all=function(selector){return Array.from(document.querySelectorAll(selector));};
    var reduced=global.matchMedia('(prefers-reduced-motion: reduce)');
    var opening=false, openingTimer, toastTimer, muralLoaded=false;
    var dialogOpeners=new WeakMap();
    function toast(message){global.clearTimeout(toastTimer);byId('toast').textContent=message;byId('toast').hidden=false;toastTimer=global.setTimeout(function(){byId('toast').hidden=true;},5500);}
    var openingTimeline, progressCleanup;
    var animatedParts = '.wax-seal,.envelope-flap,.envelope-letter,.stationery,.cover-heading,.open-hint,.cover-bottom>p,.envelope-scene';
    function stopOpening() {
      global.clearTimeout(openingTimer);
      if (openingTimeline) { openingTimeline.kill(); openingTimeline = null; }
    }
    function reveal() {
      stopOpening(); opening = false;
      byId('envelope-scene').hidden = true;
      byId('invitation').hidden = false;
      byId('invitation').classList.add('invitation-visible');
      document.body.classList.remove('is-sealed', 'is-opening', 'css-opening');
      document.body.classList.add('is-open');
      byId('skip-opening').hidden = true;
      byId('invitation').focus({preventScroll:true});
      if (global.gsap && !reduced.matches) global.gsap.fromTo('.hero-copy,.hero-mark', {y:22,opacity:0}, {y:0,opacity:1,duration:.75,stagger:.12,clearProps:'transform,opacity'});
      var target;
      try { target = document.getElementById(decodeURIComponent(global.location.hash.slice(1))); } catch (_) {}
      if (target && target.closest('main')) target.scrollIntoView({behavior:reduced.matches?'auto':'smooth'});
      else global.scrollTo({top:0,behavior:'auto'});
      if (global.WeddingExperience) { if(progressCleanup)progressCleanup();progressCleanup=global.WeddingExperience.initProgress(document,global); }
    }
    byId('open-invitation').addEventListener('click',function(){
      if (opening) return;
      opening = true; this.disabled = true; this.setAttribute('aria-expanded','true');
      byId('skip-opening').hidden = false;
      document.body.classList.add('is-opening');
      if (reduced.matches) { openingTimer = global.setTimeout(reveal,20); return; }
      if (!global.gsap) {
        document.body.classList.add('css-opening');
        openingTimer = global.setTimeout(reveal,2650); return;
      }
      openingTimeline = global.gsap.timeline({onComplete:reveal,defaults:{ease:'power2.inOut'}});
      openingTimeline
        .to('.wax-seal',{scale:1.12,y:12,opacity:0,duration:.35},0)
        .to('.envelope-flap',{rotationX:180,duration:.85,transformOrigin:'50% 0%'},.22)
        .to('.cover-heading',{y:-18,opacity:0,duration:.45},.45)
        .to('.open-hint,.cover-bottom>p',{opacity:0,duration:.4},.9)
        .set('.envelope-flap',{zIndex:0},1.08)
        .to('.envelope-letter',{yPercent:-48,scale:1.04,duration:1,ease:'power3.out'},.95)
        .to('.stationery',{yPercent:16,scale:1.06,duration:.75},1.7)
        .to('.envelope-scene',{opacity:0,duration:.45},2.2);
      openingTimer = global.setTimeout(reveal,4200);
    });
    byId('skip-opening').addEventListener('click',reveal);
    byId('replay-envelope').addEventListener('click',function(){
      stopOpening(); opening = false;
      if (global.gsap) global.gsap.set(animatedParts,{clearProps:'all'});
      byId('invitation').hidden = true;
      byId('invitation').classList.remove('invitation-visible');
      byId('envelope-scene').hidden = false;
      document.body.classList.remove('is-open','is-opening','css-opening');
      document.body.classList.add('is-sealed');
      byId('open-invitation').disabled = false;
      byId('open-invitation').setAttribute('aria-expanded','false');
      byId('skip-opening').hidden = true;
      global.scrollTo({top:0,behavior:'auto'});
      byId('open-invitation').focus({preventScroll:true});
    });
    reduced.addEventListener('change',function(){if(reduced.matches&&opening)reveal();});
    if (global.WeddingExperience) {
      var countdownTarget='';
      try { if(event.dateConfirmed && event.startTime)countdownTarget=global.WeddingUtils.zonedDateTimeToUTC(event.date,event.startTime,event.timeZone).toISOString(); } catch (_) {}
      global.WeddingExperience.mountCountdown(document,global,countdownTarget);
    }
    if ('IntersectionObserver' in global) {
      var sectionObserver = new global.IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (!entry.isIntersecting) return;
          all('.desktop-nav a,.mobile-menu a').forEach(function(link){
            if(link.getAttribute('href')==='#'+entry.target.id)link.setAttribute('aria-current','location');
            else link.removeAttribute('aria-current');
          });
        });
      },{rootMargin:'-15% 0px -45% 0px'});
      all('#dia,#presentes,#mural').forEach(function(section){sectionObserver.observe(section);});
    }

    function setMenu(open){byId('menu-toggle').setAttribute('aria-expanded',String(open));byId('mobile-menu').hidden=!open;}
    byId('menu-toggle').addEventListener('click',function(){setMenu(this.getAttribute('aria-expanded')!=='true');});
    all('#mobile-menu a,#mobile-menu button').forEach(function(item){item.addEventListener('click',function(){setMenu(false);});});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&byId('menu-toggle').getAttribute('aria-expanded')==='true'){setMenu(false);byId('menu-toggle').focus();}});
    function openDialog(dialog,trigger){if(trigger&&trigger.closest('#mobile-menu'))trigger=byId('menu-toggle');dialogOpeners.set(dialog,trigger||document.activeElement);if(!dialog.open)dialog.showModal();}
    function closeDialog(dialog){if(dialog.open)dialog.close();}
    all('[data-close-dialog]').forEach(function(button){button.addEventListener('click',function(){closeDialog(button.closest('dialog'));});});
    all('dialog').forEach(function(dialog){dialog.addEventListener('close',function(){var trigger=dialogOpeners.get(dialog);if(trigger&&trigger.isConnected)trigger.focus({preventScroll:true});});dialog.addEventListener('click',function(e){if(e.target!==dialog)return;var rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeDialog(dialog);});});
    all('[data-open-rsvp]').forEach(function(button){button.addEventListener('click',function(){openDialog(byId('rsvp-dialog'),button);});});
    byId('open-message').addEventListener('click',function(){openDialog(byId('message-dialog'),this);});
    all('[data-open-pix]').forEach(function(button){button.addEventListener('click',function(){document.querySelector('[data-pix-status]').textContent='';openDialog(byId('pix-dialog'),button);});});
    byId('pix-key').value=gifts.pixKey||'';
    if(gifts.pixRecipient){byId('pix-recipient').textContent=gifts.pixRecipient;byId('pix-recipient').hidden=false;}
    async function copy(value,field){if(global.navigator.clipboard){try{await global.navigator.clipboard.writeText(value);return true;}catch(_){}}var temporary=!field;if(!field){field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);}field.focus();field.select();field.setSelectionRange(0,value.length);var success=false;try{success=document.execCommand('copy');}catch(_){}if(temporary)field.remove();return success;}
    byId('copy-pix').addEventListener('click',async function(){var status=document.querySelector('[data-pix-status]');if(!gifts.pixKey){status.textContent='A chave Pix ainda não está disponível.';return;}status.textContent=await copy(gifts.pixKey,byId('pix-key'))?'Chave copiada. Abra seu banco para presentear.':'Selecione a chave acima e use a opção Copiar do seu aparelho.';});
    var destination=[event.venue,event.address].filter(Boolean).join(', ');
    all('[data-event-venue]').forEach(function(el){el.textContent=event.venue||'Local em breve';});
    all('[data-event-address]').forEach(function(el){el.textContent=event.address||'Endereço em breve';});
    if(event.mapsUrl)byId('maps-link').href=event.mapsUrl;
    byId('directions-link').href='https://www.google.com/maps/dir/?'+new URLSearchParams({api:'1',destination:destination,travelmode:'driving'}).toString();
    byId('venue-map').src='https://maps.google.com/maps?'+new URLSearchParams({q:destination,z:'16',output:'embed'}).toString();
    byId('copy-address').addEventListener('click',async function(){toast(await copy(destination)?'Endereço copiado.':'Selecione e copie o endereço exibido no convite.');});
    if(gifts.registryUrl)byId('registry-link').href=gifts.registryUrl;if(gifts.amazonUrl)byId('amazon-link').href=gifts.amazonUrl;
    all('[data-open-calendar]').forEach(function(button){button.addEventListener('click',function(){try{byId('google-calendar-link').href=global.WeddingUtils.buildGoogleCalendarUrl(config);byId('calendar-status').textContent='13 de janeiro de 2027, às 19h · Casa Colonial. Escolha sua agenda:';byId('calendar-options').hidden=false;}catch(error){byId('calendar-status').textContent=error.message;byId('calendar-options').hidden=true;}openDialog(byId('calendar-dialog'),button);});});
    byId('download-ics').addEventListener('click',function(){try{var blob=new Blob([global.WeddingUtils.buildICS(config)],{type:'text/calendar;charset=utf-8'});var url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='casamento-yuri-geovanna.ics';document.body.appendChild(anchor);anchor.click();anchor.remove();global.setTimeout(function(){URL.revokeObjectURL(url);},30000);byId('calendar-status').textContent='Arquivo baixado. Abra na sua agenda e confirme a inclusão.';}catch(error){byId('calendar-status').textContent=error.message;}});
    byId('share-invitation').addEventListener('click',async function(){var url=config.site&&config.site.url||global.location.href.split('#')[0];if(!/^https?:\/\//i.test(url)){toast('O link estará disponível quando o convite for publicado.');return;}if(global.navigator.share){try{await global.navigator.share({title:'Yuri & Geovanna · Nosso casamento',text:'Um convite para celebrar o nosso sim.',url:url});return;}catch(error){if(error.name==='AbortError')return;}}toast(await copy(url)?'Link do convite copiado.':'Copie o endereço na barra do navegador.');});
    var apiBase=String(config.guestbook&&config.guestbook.apiBase||'').replace(/\/$/,'');
    async function request(path,options){var response=await fetch(apiBase+path,Object.assign({headers:{'Accept':'application/json'},signal:AbortSignal.timeout(15000)},options));if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Não foi possível conectar. Tente novamente em instantes.');var result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir. Tente novamente.');return result;}
    function requestId(){if(global.crypto&&global.crypto.randomUUID)return global.crypto.randomUUID();if(!global.crypto||!global.crypto.getRandomValues)throw new Error('Abra o convite por HTTPS ou pelo endereço local e tente novamente.');var b=global.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var s=Array.from(b,function(n){return n.toString(16).padStart(2,'0');}).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}
    var seen=new Set(),cursor=null,loading=false;
    function renderMessage(item,first){if(seen.has(item.id))return;seen.add(item.id);var card=document.createElement('article');card.className='message-card';var text=document.createElement('p');text.textContent=item.message;var footer=document.createElement('footer'),name=document.createElement('strong'),date=document.createElement('time');name.textContent=item.name;date.dateTime=item.createdAt;date.textContent=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'America/Manaus'}).format(new Date(item.createdAt));footer.append(name,date);card.append(text,footer);if(first)byId('guestbook-list').prepend(card);else byId('guestbook-list').appendChild(card);}
    async function loadMessages(){if(loading)return;loading=true;byId('guestbook-retry').hidden=true;byId('guestbook-status').textContent='Carregando os recados…';try{var result=await request('/api/messages'+(cursor?'?before='+encodeURIComponent(cursor):''));result.messages.forEach(function(item){renderMessage(item,false);});cursor=result.nextCursor;byId('guestbook-more').hidden=!cursor;byId('guestbook-status').textContent=seen.size?'Recados cheios de carinho para a nossa história.':'O primeiro recado pode ser o seu. Vamos adorar ler!';}catch(error){byId('guestbook-status').textContent='Não conseguimos carregar o mural agora.';byId('guestbook-retry').hidden=false;}finally{loading=false;}}
    byId('guestbook-more').addEventListener('click',loadMessages);byId('guestbook-retry').addEventListener('click',loadMessages);
    if('IntersectionObserver' in global){var observer=new IntersectionObserver(function(entries){if(!muralLoaded&&entries.some(function(entry){return entry.isIntersecting;})){muralLoaded=true;observer.disconnect();loadMessages();}},{rootMargin:'350px'});observer.observe(byId('mural'));}else loadMessages();
    byId('message-text').addEventListener('input',function(){byId('message-count').textContent=this.value.length+' / 600';});
    function bindForm(settings){var form=byId(settings.form),sending=false,id;form.addEventListener('input',function(){if(!sending)id=null;});form.addEventListener('submit',async function(e){e.preventDefault();if(sending||!form.reportValidity())return;sending=true;var button=byId(settings.button),status=byId(settings.status),fields=Array.from(form.querySelectorAll('input,textarea,select'));button.disabled=true;fields.forEach(function(field){if(field.tagName==='SELECT')field.disabled=true;else field.readOnly=true;});status.classList.remove('is-success');status.textContent='Enviando…';try{if(!id)id=requestId();var body=Object.assign(settings.payload(),{requestId:id});var result=await request(settings.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});settings.success(result,status);form.reset();if(settings.form==='rsvp-form')updateCompanions();id=null;}catch(error){status.textContent=error.name==='TimeoutError'?'A resposta demorou. Tente enviar novamente para confirmar.':error.message==='Failed to fetch'?'Não foi possível conectar. Seus dados continuam aqui para tentar novamente.':error.message;}finally{sending=false;button.disabled=false;fields.forEach(function(field){if(field.tagName==='SELECT')field.disabled=false;else field.readOnly=false;});if(settings.form==='rsvp-form')updateCompanions();}});}
    bindForm({form:'message-form',button:'send-message',status:'message-status',endpoint:'/api/messages',payload:function(){return {name:byId('message-name').value,message:byId('message-text').value,website:byId('message-website').value};},success:function(result,status){if(!result.message||!result.message.id)throw new Error('A publicação não foi confirmada. Tente novamente.');renderMessage(result.message,true);byId('message-count').textContent='0 / 600';status.textContent='';byId('guestbook-status').textContent='Recados cheios de carinho para a nossa história.';byId('guestbook-retry').hidden=true;closeDialog(byId('message-dialog'));toast('Recado publicado. Obrigado pelo carinho!');}});
    var rsvp=config.rsvp||{};
    function updateCompanions(){var hidden=!rsvp.allowCompanions||byId('guest-response').value==='no';byId('companions-field').hidden=hidden;byId('guest-companions').disabled=hidden;}
    updateCompanions();byId('guest-response').addEventListener('change',updateCompanions);
    bindForm({form:'rsvp-form',button:'send-rsvp',status:'rsvp-status',endpoint:'/api/rsvps',payload:function(){return {name:byId('guest-name').value,response:byId('guest-response').value,companions:rsvp.allowCompanions&&byId('guest-response').value==='yes'?Number(byId('guest-companions').value):0,website:byId('rsvp-website').value};},success:function(result,status){if(!result.confirmation||!result.confirmation.id)throw new Error('A gravação não foi confirmada. Tente novamente.');status.textContent=result.confirmation.response==='yes'?'Sua presença foi registrada. Vai ser lindo ter você com a gente!':'Sua resposta foi registrada. Obrigado por nos avisar com carinho.';status.classList.add('is-success');toast('Resposta de presença salva para os noivos.');updateCompanions();}});
  }
  if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
