'use strict';

(function () {
    var searchInput = document.getElementById('searchInput');
    var searchRow = document.getElementById('searchRow');
    var resultsEl = document.getElementById('results');
    var shortcutHint = document.getElementById('shortcutHint');
    var settingsBtn = document.getElementById('settingsBtn');

    settingsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        window.prisma.openSettings();
    });

    var CFG = null; // { serverUrl, uid, apiKey }
    var indexCache = null;
    var indexPromise = null;
    var localFilesCache = [];
    var currentItems = [];
    var activeIndex = -1;

    var ICON_LINK = '<svg viewBox="0 0 24 24"><path d="M3.9 12a5 5 0 0 1 5-5H13v2H8.9a3 3 0 0 0 0 6H13v2H8.9a5 5 0 0 1-5-5zm6.1 1h4v-2h-4v2zm5.1-6H11v2h4.1a3 3 0 0 1 0 6H11v2h4.1a5 5 0 0 0 0-10z"/></svg>';
    var ICON_QR = '<svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm10 0h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2zm-2-4h2v2h-2z"/></svg>';
    var ICON_SCISSORS = '<svg viewBox="0 0 24 24"><path d="M9.64 7.64a3 3 0 1 0-1.09 1.41L10 10.5l-1.45 1.45a3 3 0 1 0 1.09 1.41L12 11l4.5 4.5A2.5 2.5 0 1 0 18 14l-6-6 6-6a2.5 2.5 0 1 0-1.5-1.5L12 5 9.64 7.64zM6 5.5A1.5 1.5 0 1 1 6 8.5a1.5 1.5 0 0 1 0-3zm0 10A1.5 1.5 0 1 1 6 18.5a1.5 1.5 0 0 1 0-3z"/></svg>';
    var ICON_FILE = '<svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7zm0 7V3.5L18.5 9H13z"/></svg>';
    var URL_RE = /^https?:\/\/\S+$/i;

    // ── Bitap fuzzy search (máx. 1 erro) — mesmo algoritmo do launcher-widget.js ──
    function bitapExact(text, pattern) {
        var m = pattern.length;
        if (m === 0 || m > 31) return text.indexOf(pattern) !== -1;

        var mask = {};
        for (var i = 0; i < m; i++) {
            var c = pattern[i];
            mask[c] = (mask[c] === undefined ? ~0 : mask[c]) & ~(1 << i);
        }

        var R = ~1;
        var matchBit = 1 << (m - 1);

        for (var j = 0; j < text.length; j++) {
            var cm = mask[text[j]];
            if (cm === undefined) cm = ~0;
            R = (R | cm) << 1;
            if ((R & matchBit) === 0) return true;
        }
        return false;
    }

    function editDistance(a, b, cutoff) {
        var al = a.length, bl = b.length;
        if (Math.abs(al - bl) > cutoff) return cutoff + 1;

        var prev = [];
        for (var j = 0; j <= bl; j++) prev[j] = j;

        for (var i = 1; i <= al; i++) {
            var cur = [i];
            for (var jj = 1; jj <= bl; jj++) {
                var cost = a[i - 1] === b[jj - 1] ? 0 : 1;
                cur[jj] = Math.min(prev[jj] + 1, cur[jj - 1] + 1, prev[jj - 1] + cost);
            }
            prev = cur;
        }
        return prev[bl];
    }

    function bitapSearch(text, pattern, maxErrors) {
        maxErrors = maxErrors === undefined ? 1 : maxErrors;
        text = text.toLowerCase();
        pattern = pattern.toLowerCase();

        if (pattern.length === 0) return { matched: true, score: 0.05 };

        if (bitapExact(text, pattern)) {
            var idx = text.indexOf(pattern);
            var prefixBonus = idx === 0 ? 0.15 : 0;
            return { matched: true, score: Math.min(1, 0.8 + prefixBonus) };
        }

        if (maxErrors <= 0 || pattern.length < 3) return { matched: false, score: 0 };

        var n = text.length, m = pattern.length, best = maxErrors + 1;
        var minLen = Math.max(1, m - maxErrors);
        var maxLen = m + maxErrors;

        for (var start = 0; start <= n - minLen && best > 0; start++) {
            for (var len = minLen; len <= maxLen && start + len <= n; len++) {
                var d = editDistance(text.substr(start, len), pattern, best);
                if (d < best) best = d;
                if (best === 0) break;
            }
        }

        if (best <= maxErrors) {
            return { matched: true, score: Math.max(0.15, 0.6 - best * 0.2) };
        }
        return { matched: false, score: 0 };
    }

    function rankResults(items, query) {
        if (!query) {
            return items.slice().sort(function (a, b) { return b.use_count - a.use_count; }).slice(0, 8);
        }

        var scored = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var titleMatch = bitapSearch(item.title || '', query, 1);
            var urlMatch = bitapSearch(item.url || '', query, 1);
            var tagMatch = { matched: false, score: 0 };
            if (item.tags && item.tags.length) {
                for (var t = 0; t < item.tags.length; t++) {
                    var m = bitapSearch(String(item.tags[t]), query, 1);
                    if (m.score > tagMatch.score) tagMatch = m;
                }
            }

            var best = Math.max(titleMatch.score, urlMatch.score * 0.6, tagMatch.score * 0.8);
            if (best <= 0) continue;

            var recencyBoost = 0;
            if (item.last_used_at) {
                var hoursAgo = (Date.now() - new Date(item.last_used_at).getTime()) / 3600000;
                if (hoursAgo >= 0 && hoursAgo <= 2) recencyBoost = 0.1;
            }
            var useBoost = Math.min(0.2, (item.use_count || 0) * 0.01);

            scored.push({ item: item, rank: best + recencyBoost + useBoost });
        }

        scored.sort(function (a, b) { return b.rank - a.rank; });
        return scored.slice(0, 8).map(function (s) { return s.item; });
    }

    // ── Rede ────────────────────────────────────────────────────────────
    function loadIndex(force) {
        if (indexPromise && !force) return indexPromise;
        if (!CFG || !CFG.serverUrl) return Promise.reject(new Error('não configurado'));

        var url = CFG.serverUrl + '/launcher/index?uid=' + encodeURIComponent(CFG.uid) + '&key=' + encodeURIComponent(CFG.apiKey);
        indexPromise = fetch(url)
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
            .then(function (data) { indexCache = data; return data; })
            .catch(function (err) { indexPromise = null; throw err; });
        return indexPromise;
    }

    // Arquivos locais (Downloads/Documentos/Área de Trabalho) — opt-in, nunca sai da máquina.
    function loadLocalFiles() {
        return window.prisma.getLocalFiles().then(function (files) {
            localFilesCache = (files || []).map(function (f) {
                return {
                    title: f.title,
                    url: f.path,
                    path: f.path,
                    source: 'local-file',
                    icon: 'local-file',
                    tags: [],
                    use_count: 0,
                    last_used_at: null,
                };
            });
            return localFilesCache;
        }).catch(function () { return []; });
    }

    function track(item) {
        if (!CFG) return;
        var body = new URLSearchParams({
            uid: CFG.uid,
            key: CFG.apiKey,
            source: item.source || 'manual',
            source_id: item.source_id != null ? String(item.source_id) : '',
            title: item.title || '',
            url: item.url || '',
            icon: item.icon || '',
        });
        fetch(CFG.serverUrl + '/launcher/track', { method: 'POST', body: body }).catch(function () {});
    }

    // ── Ações rápidas (URL colada → gerar QR ou encurtar) ─────────────────
    function quickApiCall(path, params) {
        var body = new URLSearchParams(params);
        return fetch(CFG.serverUrl + path, { method: 'POST', body: body })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); });
    }

    function renderQuickActions(url) {
        searchRow.classList.add('has-results');
        resultsEl.innerHTML =
            '<div class="quick-actions">' +
            '<div class="qa-url">' + escapeHtml(url) + '</div>' +
            '<div class="qa-buttons">' +
            '<button class="qa-btn" id="qaQr" type="button">' + ICON_QR + ' Gerar QR Code</button>' +
            '<button class="qa-btn" id="qaLink" type="button">' + ICON_SCISSORS + ' Encurtar link</button>' +
            '</div>' +
            '<div class="qa-feedback" id="qaFeedback"></div>' +
            '<div id="qaResult"></div>' +
            '</div>';

        var qaFeedback = document.getElementById('qaFeedback');
        var qaResult = document.getElementById('qaResult');
        var qaQrBtn = document.getElementById('qaQr');
        var qaLinkBtn = document.getElementById('qaLink');

        function setFeedback(msg, isError) {
            qaFeedback.textContent = msg || '';
            qaFeedback.classList.toggle('error', !!isError);
        }

        qaQrBtn.addEventListener('click', function () {
            if (!CFG || !CFG.uid) { setFeedback('Configure o agente primeiro.', true); return; }
            qaQrBtn.disabled = true;
            qaLinkBtn.disabled = true;
            setFeedback('Gerando QR Code…');
            quickApiCall('/agent/qr', { uid: CFG.uid, key: CFG.apiKey, url: url })
                .then(function (res) {
                    qaQrBtn.disabled = false;
                    qaLinkBtn.disabled = false;
                    if (!res.ok || !res.data.success) { setFeedback('Não foi possível gerar o QR Code.', true); return; }
                    setFeedback('QR Code gerado.');
                    qaResult.innerHTML = '<div class="qa-result"><img src="' + res.data.png_base64 + '" alt="QR Code"></div>';
                    resize();
                })
                .catch(function () {
                    qaQrBtn.disabled = false;
                    qaLinkBtn.disabled = false;
                    setFeedback('Erro de conexão com o servidor.', true);
                });
        });

        qaLinkBtn.addEventListener('click', function () {
            if (!CFG || !CFG.uid) { setFeedback('Configure o agente primeiro.', true); return; }
            qaQrBtn.disabled = true;
            qaLinkBtn.disabled = true;
            setFeedback('Encurtando link…');
            quickApiCall('/agent/link', { uid: CFG.uid, key: CFG.apiKey, destination: url })
                .then(function (res) {
                    qaQrBtn.disabled = false;
                    qaLinkBtn.disabled = false;
                    if (!res.ok || !res.data.success) { setFeedback('Não foi possível encurtar o link.', true); return; }
                    setFeedback('Link encurtado.');
                    qaResult.innerHTML =
                        '<div class="qa-result"><div class="qa-link-row">' +
                        '<input type="text" readonly id="qaShortUrl" value="' + escapeHtml(res.data.short_url) + '">' +
                        '<button class="qa-copy" id="qaCopy" type="button">Copiar</button>' +
                        '</div></div>';
                    resize();
                    document.getElementById('qaCopy').addEventListener('click', function () {
                        window.prisma.copyToClipboard(res.data.short_url);
                        setFeedback('Copiado para a área de transferência.');
                    });
                })
                .catch(function () {
                    qaQrBtn.disabled = false;
                    qaLinkBtn.disabled = false;
                    setFeedback('Erro de conexão com o servidor.', true);
                });
        });

        resize();
    }

    // ── UI ────────────────────────────────────────────────────────────────
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function resize() {
        var height = searchRow.offsetHeight + resultsEl.scrollHeight;
        window.prisma.resizeSearchWindow(height + 12);
    }

    function renderEmpty(message) {
        resultsEl.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
        searchRow.classList.add('has-results');
        resize();
    }

    function renderResults(items) {
        activeIndex = items.length ? 0 : -1;

        if (!items.length) {
            renderEmpty('Nenhum resultado encontrado.');
            return;
        }

        searchRow.classList.add('has-results');
        resultsEl.innerHTML = items.map(function (item, i) {
            var icon = item.source === 'local-file' ? ICON_FILE : ICON_LINK;
            return '<a class="item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" href="#">' +
                '<span class="item-icon">' + icon + '</span>' +
                '<span class="item-body">' +
                '<span class="item-title">' + escapeHtml(item.title) + '</span><br>' +
                '<span class="item-url">' + escapeHtml(item.url) + '</span>' +
                '</span></a>';
        }).join('');

        Array.prototype.forEach.call(resultsEl.querySelectorAll('.item'), function (el) {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                var idx = parseInt(el.getAttribute('data-idx'), 10);
                selectItem(currentItems[idx]);
            });
        });

        resize();
    }

    function selectItem(item) {
        if (!item) return;
        if (item.source === 'local-file') {
            // Arquivo local: abre direto, nunca passa pelo servidor (nem pra "track").
            window.prisma.openLocalFile(item.path);
            closeWindow();
            return;
        }
        track(item);
        window.prisma.openExternal(item.url);
        closeWindow();
    }

    function closeWindow() {
        searchInput.value = '';
        searchRow.classList.remove('has-results');
        resultsEl.innerHTML = '';
        resize();
        window.prisma.hideSearchWindow();
    }

    var debounceTimer = null;
    searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        var query = searchInput.value.trim();

        if (URL_RE.test(query)) {
            currentItems = [];
            activeIndex = -1;
            renderQuickActions(query);
            return;
        }

        debounceTimer = setTimeout(function () {
            var source = ((indexCache && indexCache.links) || []).concat(localFilesCache);
            currentItems = rankResults(source, query);
            renderResults(currentItems);
        }, 100);
    });

    searchInput.addEventListener('keydown', function (e) {
        var items = resultsEl.querySelectorAll('.item');

        if (e.key === 'Escape') {
            e.preventDefault();
            closeWindow();
            return;
        }

        if (!items.length) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            items[activeIndex] && items[activeIndex].classList.remove('active');
            activeIndex = e.key === 'ArrowDown'
                ? Math.min(items.length - 1, activeIndex + 1)
                : Math.max(0, activeIndex - 1);
            items[activeIndex].classList.add('active');
            items[activeIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0) selectItem(currentItems[activeIndex]);
        }
    });

    function bootstrap() {
        window.prisma.getConfig().then(function (cfg) {
            CFG = cfg;
        });
    }

    function onWindowShown() {
        searchInput.value = '';
        searchInput.focus();
        searchRow.classList.remove('has-results');

        if (!CFG || !CFG.serverUrl) {
            window.prisma.getConfig().then(function (cfg) {
                CFG = cfg;
                if (!CFG.serverUrl) {
                    renderEmpty('Configure o servidor PRISMA primeiro.');
                    return;
                }
                fetchAndShowDefault();
            });
            return;
        }

        fetchAndShowDefault();
    }

    function fetchAndShowDefault() {
        renderEmpty('Carregando…');
        loadLocalFiles(); // dispara em paralelo, não bloqueia a exibição da conta
        loadIndex(true).then(function (data) {
            var source = (data.links || []).concat(localFilesCache);
            currentItems = rankResults(source, '');
            renderResults(currentItems);
        }).catch(function () {
            renderEmpty('Não foi possível conectar ao servidor PRISMA.');
        });
    }

    window.prisma.onWindowShown(onWindowShown);
    bootstrap();
})();
