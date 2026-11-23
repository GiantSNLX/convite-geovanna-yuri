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

  function buildInviteLink(inviteOrToken) {
    var token = inviteOrToken && typeof inviteOrToken === 'object' ? inviteOrToken.token : inviteOrToken;
    var base = global.location.origin + '/';
    return base + '?c=' + encodeURIComponent(token || '');
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
    ['Família / Grupo', 'Chave', 'Senhas', 'Situação', 'Confirmados', 'Telefone', 'Ações'].forEach(function (label) {
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
          ? inv.confirmedGuests.map(function (g) { return g.name; }).join(', ')
          : inv.status === 'no' && inv.respondentName
            ? inv.respondentName + ' (ausente)'
            : '—';

      var tdPhone = document.createElement('td');
      tdPhone.textContent = inv.phone || '—';

      var tdAct = document.createElement('td');
      var actWrap = document.createElement('div');
      actWrap.className = 'sheet-actions';

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'button button-small';
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

      actWrap.append(copyBtn, editBtn, toggleBtn);
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
          inv.confirmedGuests.map(function (g) { return g.name; }).join(', ') +
          (inv.phone ? ' · Tel: ' + inv.phone : '');
        info.appendChild(namesLine);
      } else if (inv.status === 'no') {
        var noLine = document.createElement('p');
        noLine.className = 'invite-meta-line';
        noLine.textContent =
          'Responsável: ' +
          (inv.respondentName || 'Não informado') +
          (inv.phone ? ' · Tel: ' + inv.phone : '') +
          (inv.absenceNote ? ' · Obs: “' + inv.absenceNote + '”' : '');
        info.appendChild(noLine);
      }

      var dateLine = document.createElement('p');
      dateLine.className = 'invite-meta-line';
      dateLine.textContent = 'Última atualização: ' + formatDate(inv.updatedAt || inv.createdAt);
      info.appendChild(dateLine);

      var actions = document.createElement('div');
      actions.className = 'invite-actions';

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'button button-small';
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

      actions.append(copyBtn, editBtn, toggleBtn);
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
    byId('edit-invite-id').value = String(inv.id);
    byId('admin-edit-token-label').textContent = 'Link: ' + buildInviteLink(inv);
    byId('edit-family-name').value = inv.familyName;
    byId('edit-max-guests').value = String(inv.maxGuests);
    byId('edit-invite-status').value = inv.status;
    byId('edit-respondent-name').value = inv.respondentName || '';
    byId('edit-respondent-phone').value = inv.phone || '';
    byId('edit-confirmed-guests').value = (inv.confirmedGuests || []).map(function (g) { return g.name; }).join('\n');
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

  byId('admin-edit-invite-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = byId('edit-invite-id').value;
    var statusEl = byId('admin-edit-status');
    var guestsLines = byId('edit-confirmed-guests')
      .value.split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    try {
      var res = await api('/api/admin/invites/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyName: byId('edit-family-name').value,
          maxGuests: Number(byId('edit-max-guests').value),
          status: byId('edit-invite-status').value,
          respondentName: byId('edit-respondent-name').value,
          phone: byId('edit-respondent-phone').value,
          confirmedGuests: guestsLines,
          absenceNote: byId('edit-absence-note').value
        })
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
