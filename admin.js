(function (global) {
  'use strict';

  var document = global.document;
  var byId = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.from(document.querySelectorAll(sel)); };
  var toastTimer;
  var currentFilter = 'pending';
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

  function encodeInviteKey(inv) {
    var payload = {
      t: inv.token || '',
      f: inv.familyName || '',
      n: Math.max(1, Math.min(20, Number(inv.maxGuests) || 1))
    };
    var bytes = new TextEncoder().encode(JSON.stringify(payload));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function buildInviteLink(inviteOrToken) {
    var base = global.location.origin + '/';
    if (inviteOrToken && typeof inviteOrToken === 'object') {
      return base + '?c=' + encodeURIComponent(inviteOrToken.token) + '&k=' + encodeInviteKey(inviteOrToken);
    }
    return base + '?c=' + encodeURIComponent(inviteOrToken);
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

  function renderInvites() {
    var container = byId('invites-list');
    container.innerHTML = '';
    if (!cachedInvites.length) {
      var empty = document.createElement('p');
      empty.textContent = 'Nenhum convite cadastrado ainda. Crie o primeiro convite de família acima.';
      container.appendChild(empty);
      return;
    }

    cachedInvites.forEach(function (inv) {
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
          ? 'Presença confirmada (' + inv.confirmedCount + ' de ' + inv.maxGuests + ')'
          : inv.status === 'no'
            ? 'Ausência informada'
            : 'Sem resposta (até ' + inv.maxGuests + ')';
      pill.className = 'status-pill is-' + inv.status;
      pill.textContent = statusLabel;
      titleRow.append(title, pill);
      info.appendChild(titleRow);

      var linkLine = document.createElement('p');
      linkLine.className = 'invite-meta-line';
      linkLine.textContent = 'Link individual: ' + buildInviteLink(inv);
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
      copyBtn.textContent = 'Copiar link individual';
      copyBtn.addEventListener('click', async function () {
        var ok = await copyText(buildInviteLink(inv));
        toast(ok ? 'Link individual copiado para ' + inv.familyName + '.' : 'Não foi possível copiar automaticamente.');
      });

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'button button-outline button-small';
      editBtn.textContent = 'Consultar / Editar';
      editBtn.addEventListener('click', function () {
        openEditInviteDialog(inv);
      });

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'button button-danger button-small';
      toggleBtn.textContent = inv.active ? 'Desativar link' : 'Reativar link';
      toggleBtn.addEventListener('click', async function () {
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
