(function (global) {
  'use strict';

  var document = global.document;
  var byId = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.from(document.querySelectorAll(sel)); };
  var toastTimer;
  var currentFilter = 'pending';
  var currentInviteFilter = 'all';
  var currentInviteView = 'sheet';
  var inviteSearchQuery = '';
  var cachedInvites = [];
  var cachedMessages = [];
  var currentEditingInvite = null;
  var currentWhatsappInvite = null;
  var usePublicSiteUrl = false;
  var lastWhatsappCanvasKey = '';

  function toast(msg) {
    global.clearTimeout(toastTimer);
    var el = byId('toast');
    el.textContent = msg;
    el.hidden = false;
    toastTimer = global.setTimeout(function () {
      el.hidden = true;
    }, 4500);
  }

  async function api(path, options) {
    var res = await fetch(
      path,
      Object.assign({ headers: { Accept: 'application/json' }, credentials: 'same-origin' }, options)
    );
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(data.error || 'Não foi possível concluir a operação.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function copyText(value) {
    if (global.navigator.clipboard) {
      try {
        await global.navigator.clipboard.writeText(value);
        return true;
      } catch (_) {}
    }
    var ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }

  function isLocalOrigin() {
    var origin = (global.location && global.location.origin) || '';
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(origin);
  }

  function getConfiguredPublicUrl() {
    var cfg = global.WEDDING_CONFIG && global.WEDDING_CONFIG.site && global.WEDDING_CONFIG.site.url
      ? String(global.WEDDING_CONFIG.site.url).trim()
      : '';
    return cfg ? cfg.replace(/\/+$/, '') + '/' : '';
  }

  function buildInviteLink(inviteOrToken, preferPublic) {
    var token = inviteOrToken && typeof inviteOrToken === 'object' ? inviteOrToken.token : inviteOrToken;
    var base = '';
    if (preferPublic) {
      base = getConfiguredPublicUrl();
    }
    if (!base) {
      var origin = (global.location && global.location.origin && global.location.origin !== 'null')
        ? global.location.origin.replace(/\/+$/, '') + '/'
        : '';
      base = origin || getConfiguredPublicUrl() || '/';
    }
    return base + '?c=' + encodeURIComponent(token || '');
  }

  function formatHonoreeDisplayName(inv) {
    var cleanFam = inv && inv.familyName ? String(inv.familyName).trim() : '';
    if (!cleanFam) return 'Convidado especial';
    var max = Number(inv.maxGuests) || 1;
    var hasGroupWord = /\b(fam[ií]lia|casal|grupo)\b|\be\b/i.test(cleanFam);
    return max > 1 && !hasGroupWord ? cleanFam + ' e família' : cleanFam;
  }

  function slugifyFileName(text) {
    var s = String(text || 'convite').trim();
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'convite';
  }

  function buildWhatsappMessage(inv, preferPublic) {
    var honoree = formatHonoreeDisplayName(inv);
    var max = Number(inv && inv.maxGuests) || 1;
    var seatCopy = max === 1
      ? 'Este link é individual e está reservado para *1 pessoa*.'
      : 'Este link já está reservado para *' + max + ' pessoas*.';
    var link = buildInviteLink(inv, preferPublic);
    return [
      'Olá, *' + honoree + '*!',
      '',
      'Preparamos com muito carinho o convite de casamento de *Yuri & Geovanna* para ' + (max === 1 ? 'você' : 'vocês') + '!',
      '',
      '*Como abrir o seu convite:*',
      '1. Toque no link exclusivo abaixo',
      '2. Ative o som e clique na tela para abrir o envelope',
      '3. Ao final, clique em *"Confirmar presença"*. ' + seatCopy,
      '',
      '*Acesse seu convite pelo site:*',
      link,
      '',
      'Com carinho,',
      '*Yuri & Geovanna*'
    ].join('\n');
  }

  function normalizeWhatsappDigits(phone) {
    var digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return '';
    if ((digits.length === 10 || digits.length === 11) && digits.slice(0, 2) !== '55') {
      digits = '55' + digits;
    }
    return digits;
  }

  function buildWhatsappUrl(phone, text) {
    var digits = normalizeWhatsappDigits(phone);
    var base = digits ? 'https://wa.me/' + digits : 'https://api.whatsapp.com/send';
    return base + '?text=' + encodeURIComponent(text || '');
  }

  function loadAssetImage(src) {
    return new Promise(function (resolve) {
      var img = new global.Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  async function renderWhatsappTeaserCard(inv) {
    var canvas = byId('admin-whatsapp-canvas');
    if (!canvas || !canvas.getContext) return;
    var honoree = formatHonoreeDisplayName(inv);
    if (lastWhatsappCanvasKey === honoree) return;
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (_) {}
    }

    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;

    ctx.fillStyle = '#f8f4ec';
    ctx.fillRect(0, 0, W, H);
    var grad = ctx.createRadialGradient(W / 2, H * 0.44, 80, W / 2, H * 0.5, W * 0.72);
    grad.addColorStop(0, '#fffdf9');
    grad.addColorStop(1, '#efe7d6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    var imgs = await Promise.all([
      loadAssetImage('./assets/art/floral-v4.webp'),
      loadAssetImage('./assets/art/wax-seal-gold.png')
    ]);
    var floral = imgs[0];
    var seal = imgs[1];

    if (floral) {
      ctx.save();
      ctx.globalAlpha = 0.52;
      ctx.drawImage(floral, -80, H - 440, 520, 520);
      ctx.save();
      ctx.translate(W + 80, 440);
      ctx.scale(-1, -1);
      ctx.drawImage(floral, 0, 0, 520, 520);
      ctx.restore();
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(166, 130, 60, 0.52)';
    ctx.lineWidth = 3;
    ctx.strokeRect(46, 46, W - 92, H - 92);
    ctx.strokeStyle = 'rgba(166, 130, 60, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(58, 58, W - 116, H - 116);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#a6823c';
    ctx.font = '600 22px "DM Sans", sans-serif';
    ctx.fillText('UM CONVITE ESPECIAL', W / 2, 166);

    if (seal) {
      ctx.save();
      ctx.shadowColor = 'rgba(64, 52, 24, 0.24)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 12;
      ctx.drawImage(seal, (W - 296) / 2, 206, 296, 296);
      ctx.restore();
    }

    ctx.fillStyle = '#405638';
    ctx.font = 'italic 400 30px "Bodoni Moda", Georgia, serif';
    ctx.fillText('Com carinho,', W / 2, 576);

    ctx.fillStyle = '#24321e';
    ctx.font = '400 54px "Bodoni Moda", Georgia, serif';
    ctx.fillText('Geovanna & Yuri', W / 2, 636);

    ctx.strokeStyle = '#c9b382';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 90, 688);
    ctx.lineTo(W / 2 + 90, 688);
    ctx.stroke();

    var fontPx = 62;
    ctx.font = 'italic 600 ' + fontPx + 'px "Bodoni Moda", Georgia, serif';
    while (ctx.measureText(honoree).width > W - 210 && fontPx > 34) {
      fontPx -= 2;
      ctx.font = 'italic 600 ' + fontPx + 'px "Bodoni Moda", Georgia, serif';
    }
    var nameWidth = ctx.measureText(honoree).width;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5f6e5d';
    ctx.font = '500 24px "DM Sans", sans-serif';
    ctx.fillText('Para', Math.max(140, (W - nameWidth) / 2 - 14), 754);
    ctx.restore();

    var goldGrad = ctx.createLinearGradient(W * 0.2, 775, W * 0.8, 845);
    goldGrad.addColorStop(0, '#8f6c28');
    goldGrad.addColorStop(0.5, '#c29944');
    goldGrad.addColorStop(1, '#8c6925');
    ctx.fillStyle = goldGrad;
    ctx.fillText(honoree, W / 2, 818);

    ctx.fillStyle = '#405638';
    ctx.font = '400 32px "Bodoni Moda", Georgia, serif';
    ctx.fillText('Temos algo especial para compartilhar', W / 2, 924);
    ctx.fillText('e este convite aguarda por vocês.', W / 2, 972);

    ctx.save();
    drawRoundedRectPath(ctx, (W - 560) / 2, 1038, 560, 66, 33);
    ctx.fillStyle = '#eef3e7';
    ctx.fill();
    ctx.strokeStyle = 'rgba(64, 86, 56, 0.28)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#24321e';
    ctx.font = '600 22px "DM Sans", sans-serif';
    ctx.fillText('Toque no link da mensagem para abrir', W / 2, 1079);

    ctx.fillStyle = '#a6823c';
    ctx.font = '600 18px "DM Sans", sans-serif';
    ctx.fillText('CONVITE PESSOAL E EXCLUSIVO', W / 2, 1212);

    lastWhatsappCanvasKey = honoree;
  }

  function getWhatsappCanvasBlob() {
    return new Promise(function (resolve) {
      var canvas = byId('admin-whatsapp-canvas');
      if (!canvas || !canvas.toBlob) { resolve(null); return; }
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  function triggerPngDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  function setWhatsappKitStatus(kind, msg) {
    var el = byId('whatsapp-kit-status');
    if (!el) return;
    el.className = 'form-status' + (kind ? ' is-' + kind : '');
    el.textContent = msg || '';
  }

  function syncWhatsappUrlBar() {
    var bar = byId('whatsapp-url-bar');
    var preview = byId('whatsapp-url-preview');
    var toggleBtn = byId('whatsapp-toggle-public-url');
    if (!bar || !preview || !toggleBtn || !currentWhatsappInvite) return;
    var showBar = isLocalOrigin() && Boolean(getConfiguredPublicUrl());
    bar.hidden = !showBar;
    if (showBar) {
      preview.textContent = buildInviteLink(currentWhatsappInvite, usePublicSiteUrl);
      toggleBtn.textContent = usePublicSiteUrl ? 'Usar URL local' : 'Usar URL publicada';
    }
  }

  function syncNativeShareAvailability() {
    var btn = byId('whatsapp-native-share-btn');
    if (!btn) return;
    var canFiles = false;
    try {
      if (global.navigator.share && typeof global.File === 'function' && global.navigator.canShare) {
        var testFile = new global.File([''], 'teste.png', { type: 'image/png' });
        canFiles = Boolean(global.navigator.canShare({ files: [testFile] }));
      }
    } catch (_) {
      canFiles = false;
    }
    btn.hidden = !canFiles;
  }

  async function openWhatsappInviteDialog(inv) {
    if (!inv) return;
    currentWhatsappInvite = inv;
    usePublicSiteUrl = false;
    var honoree = formatHonoreeDisplayName(inv);
    var max = Number(inv.maxGuests) || 1;
    byId('whatsapp-invite-meta').textContent =
      honoree + ' · ' + max + (max === 1 ? ' senha' : ' senhas') + ' · Chave ' + inv.token;
    byId('whatsapp-recipient-phone').value = inv.phone || '';
    byId('whatsapp-message-text').value = buildWhatsappMessage(inv, usePublicSiteUrl);
    setWhatsappKitStatus('', '');
    syncWhatsappUrlBar();
    syncNativeShareAvailability();
    byId('admin-whatsapp-dialog').showModal();
    await renderWhatsappTeaserCard(inv);
  }

  function formatDate(iso) {
    if (!iso) return 'Sem atualização';
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Manaus'
      }).format(new Date(iso));
    } catch (_) {
      return iso;
    }
  }

  function renderOverview(overview) {
    if (!overview) return;
    byId('metric-total-invites').textContent = String(overview.totalInvites || 0);
    byId('metric-invited-people').textContent = String(overview.totalInvitedPeople || 0);
    byId('metric-confirmed-people').textContent = String(overview.confirmedPeople || 0);
    byId('metric-pending-invites').textContent = String(overview.pendingInvites || 0);
    byId('metric-absent-people').textContent = String(overview.absentPeople || 0);
    byId('metric-pending-messages').textContent = String(overview.pendingMessages || 0);
  }

  async function toggleInviteActive(inv) {
    var confirmMsg = inv.active
      ? 'Desativar o link individual de "' + inv.familyName + '"?'
      : 'Reativar o link individual de "' + inv.familyName + '"?';
    if (!global.confirm(confirmMsg)) return;
    try {
      var res = await api('/api/admin/invites/' + inv.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !inv.active })
      });
      renderOverview(res.overview);
      await refreshDashboard();
      toast(inv.active ? 'Link desativado.' : 'Link reativado.');
    } catch (err) {
      toast(err.message);
    }
  }

  function formatInviteStatusShort(inv) {
    if (!inv.active) return 'Desativado';
    if (inv.status === 'yes') return 'Confirmado';
    if (inv.status === 'no') return 'Ausente';
    return 'Sem resposta';
  }

  function formatGuestAgeLabel(g) {
    if (!g || typeof g === 'string') return g || '';
    var tag = g.ageGroup === 'adulto'
      ? 'Adulto 13+'
      : g.ageGroup === 'crianca'
        ? 'Criança 6–12'
        : g.ageGroup === 'isento'
          ? '0–5 anos'
          : (g.age != null ? g.age + ' anos' : '');
    return tag ? g.name + ' (' + tag + ')' : g.name;
  }

  function renderInvitesSheet(sheetContainer, filtered, emptyMessage) {
    sheetContainer.innerHTML = '';
    if (!filtered.length) {
      var p = document.createElement('p');
      p.style.padding = '16px';
      p.textContent = emptyMessage;
      sheetContainer.appendChild(p);
      return;
    }

    var table = document.createElement('table');
    table.className = 'invites-table';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Família / Grupo', 'Chave', 'Senhas', 'Situação', 'Confirmados', 'WhatsApp', 'Ações'].forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    var tbody = document.createElement('tbody');
    var sumConfirmed = 0;
    var sumMax = 0;

    filtered.forEach(function (inv) {
      sumConfirmed += inv.status === 'yes' ? Number(inv.confirmedCount || 0) : 0;
      sumMax += Number(inv.maxGuests || 0);

      var tr = document.createElement('tr');
      if (!inv.active) tr.className = 'is-inactive';

      var tdFam = document.createElement('td');
      var famStrong = document.createElement('strong');
      famStrong.textContent = inv.familyName;
      tdFam.appendChild(famStrong);
      if (inv.expectedGuests && inv.expectedGuests.length) {
        var famListEl = document.createElement('div');
        famListEl.className = 'sheet-expected-sub';
        famListEl.style.fontSize = '12px';
        famListEl.style.color = 'var(--muted)';
        famListEl.textContent = inv.expectedGuests.join(', ');
        tdFam.appendChild(famListEl);
      }

      var tdKey = document.createElement('td');
      var codeEl = document.createElement('code');
      codeEl.className = 'key-chip';
      codeEl.textContent = inv.token;
      tdKey.appendChild(codeEl);

      var tdSeats = document.createElement('td');
      tdSeats.textContent = (inv.status === 'yes' ? inv.confirmedCount : 0) + ' / ' + inv.maxGuests;

      var tdStatus = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'status-pill is-' + inv.status;
      pill.textContent = formatInviteStatusShort(inv);
      tdStatus.appendChild(pill);

      var tdNames = document.createElement('td');
      tdNames.textContent =
        inv.status === 'yes' && inv.confirmedGuests && inv.confirmedGuests.length
          ? inv.confirmedGuests.map(formatGuestAgeLabel).join(', ')
          : inv.status === 'no' && inv.respondentName
            ? inv.respondentName + ' (ausente)'
            : '—';

      var tdPhone = document.createElement('td');
      tdPhone.textContent = inv.phone || '—';

      var tdAct = document.createElement('td');
      var actWrap = document.createElement('div');
      actWrap.className = 'sheet-actions';

      var whatsappBtn = document.createElement('button');
      whatsappBtn.type = 'button';
      whatsappBtn.className = 'button button-small';
      whatsappBtn.textContent = 'WhatsApp';
      whatsappBtn.title = 'Gerar imagem sem spoiler e enviar no WhatsApp';
      whatsappBtn.addEventListener('click', function () {
        openWhatsappInviteDialog(inv);
      });

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'button button-outline button-small';
      copyBtn.textContent = 'Copiar';
      copyBtn.title = 'Copiar link individual';
      copyBtn.addEventListener('click', async function () {
        var ok = await copyText(buildInviteLink(inv));
        toast(ok ? 'Link copiado para ' + inv.familyName + '.' : 'Não foi possível copiar automaticamente.');
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'button button-outline button-small';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', function () {
        openEditInviteDialog(inv);
      });

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'button button-danger button-small';
      toggleBtn.textContent = inv.active ? 'Desativar' : 'Reativar';
      toggleBtn.addEventListener('click', function () {
        toggleInviteActive(inv);
      });

      actWrap.append(whatsappBtn, copyBtn, editBtn, toggleBtn);
      tdAct.appendChild(actWrap);
      tr.append(tdFam, tdKey, tdSeats, tdStatus, tdNames, tdPhone, tdAct);
      tbody.appendChild(tr);
    });

    var tfoot = document.createElement('tfoot');
    var fr = document.createElement('tr');
    var ftd = document.createElement('td');
    ftd.colSpan = 7;
    ftd.textContent =
      'Exibindo ' + filtered.length + (filtered.length === 1 ? ' convite' : ' convites') +
      ' · ' + sumConfirmed + ' de ' + sumMax + ' senhas confirmadas';
    fr.appendChild(ftd);
    tfoot.appendChild(fr);

    table.append(thead, tbody, tfoot);
    sheetContainer.appendChild(table);
  }

  function renderInvites() {
    var container = byId('invites-list');
    var sheetContainer = byId('invites-sheet');
    container.innerHTML = '';

    var isSheet = currentInviteView === 'sheet';
    if (sheetContainer) sheetContainer.hidden = !isSheet;
    container.hidden = isSheet;

    if (!cachedInvites.length) {
      var emptyMsg = 'Nenhum convite cadastrado ainda. Crie o primeiro convite de família acima.';
      var empty = document.createElement('p');
      empty.textContent = emptyMsg;
      container.appendChild(empty);
      if (sheetContainer) renderInvitesSheet(sheetContainer, [], emptyMsg);
      return;
    }

    var q = inviteSearchQuery.trim().toLowerCase();
    var filtered = cachedInvites.filter(function (inv) {
      if (currentInviteFilter !== 'all' && inv.status !== currentInviteFilter) return false;
      if (!q) return true;
      var hay = [
        inv.familyName,
        inv.token,
        inv.respondentName,
        (inv.confirmedGuests || []).map(function (g) { return g.name; }).join(' ')
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    var noneMsg = 'Nenhum convite encontrado para esse filtro.';
    if (sheetContainer) renderInvitesSheet(sheetContainer, filtered, noneMsg);

    if (!filtered.length) {
      var none = document.createElement('p');
      none.textContent = noneMsg;
      container.appendChild(none);
      return;
    }

    filtered.forEach(function (inv) {
      var row = document.createElement('article');
      row.className = 'invite-item' + (inv.active ? '' : ' is-inactive');

      var info = document.createElement('div');
      info.className = 'invite-info';

      var titleRow = document.createElement('div');
      titleRow.className = 'invite-title-row';
      var title = document.createElement('strong');
      title.textContent = inv.familyName;
      var pill = document.createElement('span');
      var statusLabel = !inv.active
        ? 'Link desativado'
        : inv.status === 'yes'
          ? 'Presença confirmada (' + inv.confirmedCount + ' de ' + inv.maxGuests + (inv.maxGuests === 1 ? ' senha)' : ' senhas)')
          : inv.status === 'no'
            ? 'Ausência informada'
            : 'Sem resposta (' + inv.maxGuests + (inv.maxGuests === 1 ? ' senha disponível)' : ' senhas disponíveis)');
      pill.className = 'status-pill is-' + inv.status;
      pill.textContent = statusLabel;
      titleRow.append(title, pill);
      info.appendChild(titleRow);

      var linkLine = document.createElement('p');
      linkLine.className = 'invite-meta-line';
      linkLine.textContent = 'Chave: ' + inv.token + ' · Link: ' + buildInviteLink(inv);
      info.appendChild(linkLine);

      if (inv.status === 'yes' && inv.confirmedGuests && inv.confirmedGuests.length) {
        var namesLine = document.createElement('p');
        namesLine.className = 'invite-meta-line';
        namesLine.textContent =
          'Confirmados: ' +
          inv.confirmedGuests.map(formatGuestAgeLabel).join(', ') +
          (inv.phone ? ' · WhatsApp: ' + inv.phone : '');
        info.appendChild(namesLine);
      } else if (inv.status === 'no') {
        var noLine = document.createElement('p');
        noLine.className = 'invite-meta-line';
        noLine.textContent =
          'Responsável: ' +
          (inv.respondentName || 'Não informado') +
          (inv.phone ? ' · WhatsApp: ' + inv.phone : '') +
          (inv.absenceNote ? ' · Obs: “' + inv.absenceNote + '”' : '');
        info.appendChild(noLine);
      }

      var dateLine = document.createElement('p');
      dateLine.className = 'invite-meta-line';
      dateLine.textContent = 'Última atualização: ' + formatDate(inv.updatedAt || inv.createdAt);
      info.appendChild(dateLine);

      var actions = document.createElement('div');
      actions.className = 'invite-actions';

      var whatsappBtn = document.createElement('button');
      whatsappBtn.type = 'button';
      whatsappBtn.className = 'button button-small';
      whatsappBtn.textContent = 'Enviar no WhatsApp';
      whatsappBtn.addEventListener('click', function () {
        openWhatsappInviteDialog(inv);
      });

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'button button-outline button-small';
      copyBtn.textContent = 'Copiar link';
      copyBtn.addEventListener('click', async function () {
        var ok = await copyText(buildInviteLink(inv));
        toast(ok ? 'Link individual copiado para ' + inv.familyName + '.' : 'Não foi possível copiar automaticamente.');
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'button button-outline button-small';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', function () {
        openEditInviteDialog(inv);
      });

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'button button-danger button-small';
      toggleBtn.textContent = inv.active ? 'Desativar' : 'Reativar';
      toggleBtn.addEventListener('click', function () {
        toggleInviteActive(inv);
      });

      actions.append(whatsappBtn, copyBtn, editBtn, toggleBtn);
      row.append(info, actions);
      container.appendChild(row);
    });
  }

  function renderAdminMessages() {
    var container = byId('admin-messages-list');
    container.innerHTML = '';
    var list = cachedMessages.filter(function (m) {
      return currentFilter === 'all' ? true : m.status === currentFilter;
    });
    if (!list.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Nenhum recado nesta categoria.';
      container.appendChild(empty);
      return;
    }

    list.forEach(function (m) {
      var item = document.createElement('article');
      item.className = 'admin-msg-item';

      var info = document.createElement('div');
      info.className = 'invite-info';

      var head = document.createElement('div');
      head.className = 'invite-title-row';
      var author = document.createElement('strong');
      author.textContent = m.name;
      var pill = document.createElement('span');
      pill.className = 'status-pill ' + (m.status === 'approved' ? 'is-yes' : m.status === 'archived' ? 'is-no' : 'is-pending');
      pill.textContent = m.status === 'approved' ? 'Aprovado' : m.status === 'archived' ? 'Arquivado' : 'Pendente';
      head.append(author, pill);
      if (m.featured) {
        var featPill = document.createElement('span');
        featPill.className = 'status-pill is-featured';
        featPill.textContent = 'Em destaque';
        head.appendChild(featPill);
      }
      info.appendChild(head);

      var body = document.createElement('p');
      body.style.margin = '8px 0';
      body.style.whiteSpace = 'pre-line';
      body.textContent = m.message;
      info.appendChild(body);

      var meta = document.createElement('p');
      meta.className = 'invite-meta-line';
      meta.textContent = 'Enviado em ' + formatDate(m.createdAt);
      info.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'invite-actions';

      if (m.status !== 'approved') {
        var approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.className = 'button button-small';
        approveBtn.textContent = 'Aprovar no mural';
        approveBtn.addEventListener('click', async function () {
          try {
            var res = await api('/api/admin/messages/' + m.id + '/approve', { method: 'POST' });
            renderOverview(res.overview);
            await refreshDashboard();
            toast('Recado aprovado e publicado no mural.');
          } catch (err) {
            toast(err.message);
          }
        });
        actions.appendChild(approveBtn);
      }

      if (m.status === 'approved') {
        var featBtn = document.createElement('button');
        featBtn.type = 'button';
        featBtn.className = 'button button-outline button-small';
        featBtn.textContent = m.featured ? 'Tirar destaque' : 'Destacar primeiro';
        featBtn.addEventListener('click', async function () {
          try {
            var res = await api('/api/admin/messages/' + m.id + '/feature', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ featured: !m.featured })
            });
            renderOverview(res.overview);
            await refreshDashboard();
            toast(!m.featured ? 'Recado destacado no topo do mural.' : 'Destaque removido.');
          } catch (err) {
            toast(err.message);
          }
        });
        actions.appendChild(featBtn);
      }

      if (m.status !== 'archived') {
        var archiveBtn = document.createElement('button');
        archiveBtn.type = 'button';
        archiveBtn.className = 'button button-outline button-small';
        archiveBtn.textContent = 'Arquivar';
        archiveBtn.addEventListener('click', async function () {
          try {
            var res = await api('/api/admin/messages/' + m.id + '/archive', { method: 'POST' });
            renderOverview(res.overview);
            await refreshDashboard();
            toast('Recado arquivado.');
          } catch (err) {
            toast(err.message);
          }
        });
        actions.appendChild(archiveBtn);
      }

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'button button-danger button-small';
      deleteBtn.textContent = 'Remover';
      deleteBtn.addEventListener('click', async function () {
        if (!global.confirm('Remover definitivamente o recado de "' + m.name + '"?')) return;
        try {
          var res = await api('/api/admin/messages/' + m.id, { method: 'DELETE' });
          renderOverview(res.overview);
          await refreshDashboard();
          toast('Recado removido.');
        } catch (err) {
          toast(err.message);
        }
      });
      actions.appendChild(deleteBtn);

      item.append(info, actions);
      container.appendChild(item);
    });
  }

  async function openEditInviteDialog(inv) {
    currentEditingInvite = inv;
    byId('edit-invite-id').value = String(inv.id);
    byId('admin-edit-token-label').textContent = 'Link: ' + buildInviteLink(inv);
    byId('edit-family-name').value = inv.familyName;
    byId('edit-max-guests').value = String(inv.maxGuests);
    if (byId('edit-expected-guests')) {
      byId('edit-expected-guests').value = (inv.expectedGuests || []).join('\n');
    }
    byId('edit-invite-status').value = inv.status;
    byId('edit-respondent-name').value = inv.respondentName || '';
    byId('edit-respondent-phone').value = inv.phone || '';
    byId('edit-confirmed-guests').value = (inv.confirmedGuests || []).map(formatGuestAgeLabel).join('\n');
    byId('edit-absence-note').value = inv.absenceNote || '';
    byId('admin-edit-status').textContent = '';

    var histContainer = byId('admin-invite-history');
    histContainer.innerHTML = '<strong>Histórico de alterações</strong>';
    try {
      var res = await api('/api/admin/invites/' + inv.id + '/history');
      if (!res.history || !res.history.length) {
        var none = document.createElement('span');
        none.textContent = 'Nenhuma resposta registrada ainda.';
        histContainer.appendChild(none);
      } else {
        res.history.forEach(function (h) {
          var line = document.createElement('div');
          var st = h.status === 'yes' ? 'Confirmado (' + h.confirmedCount + ')' : h.status === 'no' ? 'Ausência' : 'Sem resposta';
          line.textContent = formatDate(h.createdAt) + ' · ' + st + ' · por ' + (h.source === 'admin' ? 'Noivos (painel)' : h.respondentName || 'Convidado');
          histContainer.appendChild(line);
        });
      }
    } catch (_) {}

    byId('admin-invite-dialog').showModal();
  }

  all('[data-close-admin-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      byId('admin-invite-dialog').close();
    });
  });

  if (byId('edit-open-whatsapp-btn')) {
    byId('edit-open-whatsapp-btn').addEventListener('click', function () {
      var inv = currentEditingInvite;
      byId('admin-invite-dialog').close();
      if (inv) openWhatsappInviteDialog(inv);
    });
  }

  all('[data-close-whatsapp-dialog]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      byId('admin-whatsapp-dialog').close();
    });
  });

  if (byId('whatsapp-toggle-public-url')) {
    byId('whatsapp-toggle-public-url').addEventListener('click', function () {
      if (!currentWhatsappInvite) return;
      usePublicSiteUrl = !usePublicSiteUrl;
      byId('whatsapp-message-text').value = buildWhatsappMessage(currentWhatsappInvite, usePublicSiteUrl);
      syncWhatsappUrlBar();
      setWhatsappKitStatus('success', usePublicSiteUrl ? 'Link atualizado para a URL publicada.' : 'Link atualizado para este servidor local.');
    });
  }

  if (byId('whatsapp-reset-text')) {
    byId('whatsapp-reset-text').addEventListener('click', function () {
      if (!currentWhatsappInvite) return;
      byId('whatsapp-message-text').value = buildWhatsappMessage(currentWhatsappInvite, usePublicSiteUrl);
      setWhatsappKitStatus('success', 'Texto padrão restaurado.');
    });
  }

  if (byId('whatsapp-copy-text-btn')) {
    byId('whatsapp-copy-text-btn').addEventListener('click', async function () {
      var text = byId('whatsapp-message-text').value;
      var ok = await copyText(text);
      setWhatsappKitStatus(ok ? 'success' : 'error', ok ? 'Texto e instruções copiados! Agora cole no WhatsApp.' : 'Não foi possível copiar automaticamente.');
      if (ok) toast('Texto copiado para colar no WhatsApp.');
    });
  }

  if (byId('whatsapp-copy-image-btn')) {
    byId('whatsapp-copy-image-btn').addEventListener('click', async function () {
      if (!currentWhatsappInvite) return;
      await renderWhatsappTeaserCard(currentWhatsappInvite);
      var blob = await getWhatsappCanvasBlob();
      if (!blob) return;
      if (global.navigator.clipboard && global.navigator.clipboard.write && typeof global.ClipboardItem === 'function') {
        try {
          await global.navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]);
          setWhatsappKitStatus('success', 'Imagem copiada! No WhatsApp Web, basta apertar Ctrl+V para colar e enviar.');
          toast('Imagem copiada para a área de transferência.');
          return;
        } catch (_) {}
      }
      var fileName = 'convite-' + slugifyFileName(currentWhatsappInvite.familyName) + '.png';
      triggerPngDownload(blob, fileName);
      setWhatsappKitStatus('success', 'Imagem baixada (' + fileName + ') para anexar no WhatsApp.');
    });
  }

  if (byId('whatsapp-download-image-btn')) {
    byId('whatsapp-download-image-btn').addEventListener('click', async function () {
      if (!currentWhatsappInvite) return;
      await renderWhatsappTeaserCard(currentWhatsappInvite);
      var blob = await getWhatsappCanvasBlob();
      if (!blob) return;
      var fileName = 'convite-' + slugifyFileName(currentWhatsappInvite.familyName) + '.png';
      triggerPngDownload(blob, fileName);
      setWhatsappKitStatus('success', 'Imagem salva: ' + fileName + '.');
      toast('Imagem salva no aparelho.');
    });
  }

  if (byId('whatsapp-open-btn')) {
    byId('whatsapp-open-btn').addEventListener('click', async function () {
      var text = byId('whatsapp-message-text').value;
      var phone = byId('whatsapp-recipient-phone').value;
      await copyText(text);
      var url = buildWhatsappUrl(phone, text);
      global.open(url, '_blank', 'noopener');
      setWhatsappKitStatus('success', 'WhatsApp aberto com o texto pronto! Se quiser enviar a arte junto, clique em "Copiar imagem" e cole antes de enviar.');
    });
  }

  if (byId('whatsapp-native-share-btn')) {
    byId('whatsapp-native-share-btn').addEventListener('click', async function () {
      if (!currentWhatsappInvite) return;
      await renderWhatsappTeaserCard(currentWhatsappInvite);
      var blob = await getWhatsappCanvasBlob();
      if (!blob) return;
      var text = byId('whatsapp-message-text').value;
      var fileName = 'convite-' + slugifyFileName(currentWhatsappInvite.familyName) + '.png';
      var file = typeof global.File === 'function'
        ? new global.File([blob], fileName, { type: 'image/png' })
        : null;
      if (file && global.navigator.share && (!global.navigator.canShare || global.navigator.canShare({ files: [file] }))) {
        try {
          await global.navigator.share({
            files: [file],
            title: 'Convite · Geovanna & Yuri',
            text: text
          });
          setWhatsappKitStatus('success', 'Compartilhado com sucesso.');
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      triggerPngDownload(blob, fileName);
      await copyText(text);
      setWhatsappKitStatus('success', 'Imagem salva e texto copiado para enviar no WhatsApp.');
    });
  }

  byId('admin-edit-invite-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = byId('edit-invite-id').value;
    var statusEl = byId('admin-edit-status');
    var guestsLines = byId('edit-confirmed-guests')
      .value.split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var m = line.match(/^(.*?)\s*\((Adulto[^)]*|Crian[çc]a[^)]*|0[–-]5[^)]*)\)\s*$/i);
        if (!m) return { name: line };
        var tag = m[2].toLowerCase();
        var ag = tag.indexOf('adulto') !== -1 ? 'adulto' : tag.indexOf('0') !== -1 ? 'isento' : 'crianca';
        return { name: m[1].trim(), ageGroup: ag };
      });
    var expectedLines = byId('edit-expected-guests')
      ? byId('edit-expected-guests').value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)
      : undefined;
    try {
      var patchBody = {
        familyName: byId('edit-family-name').value,
        maxGuests: Number(byId('edit-max-guests').value),
        status: byId('edit-invite-status').value,
        respondentName: byId('edit-respondent-name').value,
        phone: byId('edit-respondent-phone').value,
        confirmedGuests: guestsLines,
        absenceNote: byId('edit-absence-note').value
      };
      if (expectedLines !== undefined) patchBody.expectedGuests = expectedLines;
      var res = await api('/api/admin/invites/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody)
      });
      renderOverview(res.overview);
      await refreshDashboard();
      byId('admin-invite-dialog').close();
      toast('Convite atualizado com sucesso.');
    } catch (err) {
      statusEl.className = 'form-status is-error';
      statusEl.textContent = err.message;
    }
  });

  byId('create-invite-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var statusEl = byId('create-invite-status');
    statusEl.textContent = '';
    try {
      var res = await api('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyName: byId('new-family-name').value,
          maxGuests: Number(byId('new-max-guests').value)
        })
      });
      byId('new-family-name').value = '';
      byId('new-max-guests').value = '2';
      renderOverview(res.overview);
      await refreshDashboard();
      var link = buildInviteLink(res.invite.token);
      await copyText(link);
      toast('Convite criado e link copiado: ' + res.invite.familyName);
      openWhatsappInviteDialog(res.invite);
    } catch (err) {
      statusEl.className = 'form-status is-error';
      statusEl.textContent = err.message;
    }
  });

  all('[data-invite-filter]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      currentInviteFilter = tab.getAttribute('data-invite-filter') || 'all';
      all('[data-invite-filter]').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      renderInvites();
    });
  });

  all('[data-invite-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentInviteView = btn.getAttribute('data-invite-view') || 'sheet';
      all('[data-invite-view]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });
      renderInvites();
    });
  });

  if (byId('invite-search-input')) {
    byId('invite-search-input').addEventListener('input', function () {
      inviteSearchQuery = this.value || '';
      renderInvites();
    });
  }

  all('[data-msg-filter]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      currentFilter = tab.getAttribute('data-msg-filter');
      all('[data-msg-filter]').forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
      });
      renderAdminMessages();
    });
  });

  async function refreshDashboard() {
    var data = await api('/api/admin/overview');
    cachedInvites = data.invites || [];
    cachedMessages = data.messages || [];
    renderOverview(data.overview);
    renderInvites();
    renderAdminMessages();
    byId('admin-login-section').hidden = true;
    byId('admin-dashboard').hidden = false;
    byId('admin-top-actions').hidden = false;
  }

  byId('admin-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var status = byId('admin-login-status');
    status.textContent = '';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: byId('admin-password').value })
      });
      byId('admin-password').value = '';
      await refreshDashboard();
      toast('Bem-vindos ao painel dos noivos.');
    } catch (err) {
      status.className = 'form-status is-error';
      status.textContent = err.message;
    }
  });

  byId('admin-logout-btn').addEventListener('click', async function () {
    await api('/api/admin/logout', { method: 'POST' }).catch(function () {});
    byId('admin-dashboard').hidden = true;
    byId('admin-top-actions').hidden = true;
    byId('admin-login-section').hidden = false;
  });

  refreshDashboard().catch(function () {
    byId('admin-login-section').hidden = false;
  });
})(window);
