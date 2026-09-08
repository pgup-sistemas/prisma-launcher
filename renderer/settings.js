'use strict';

(function () {
    var serverUrlEl = document.getElementById('serverUrl');
    var uidEl = document.getElementById('uid');
    var apiKeyEl = document.getElementById('apiKey');
    var shortcutEl = document.getElementById('shortcut');
    var launchAtStartupEl = document.getElementById('launchAtStartup');
    var syncBookmarksEl = document.getElementById('syncBookmarks');
    var syncFilesEl = document.getElementById('syncFiles');
    var saveBtn = document.getElementById('saveBtn');
    var feedbackEl = document.getElementById('feedback');

    var DEFAULT_SHORTCUT_DISPLAY = 'Ctrl+Alt+K';
    var DEFAULT_SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+K';
    var currentAccelerator = DEFAULT_SHORTCUT_ACCELERATOR;

    // Carrega config salva
    window.prisma.getConfig().then(function (cfg) {
        serverUrlEl.value = cfg.serverUrl || '';
        uidEl.value = cfg.uid || '';
        apiKeyEl.value = cfg.apiKey || '';
        launchAtStartupEl.checked = cfg.launchAtStartup !== false;
        syncBookmarksEl.checked = !!cfg.syncBookmarks;
        syncFilesEl.checked = !!cfg.syncFiles;

        currentAccelerator = cfg.shortcut || DEFAULT_SHORTCUT_ACCELERATOR;
        shortcutEl.value = acceleratorToDisplay(currentAccelerator);
    });

    function acceleratorToDisplay(accelerator) {
        return String(accelerator)
            .replace(/CommandOrControl/gi, 'Ctrl')
            .replace(/Command/gi, 'Cmd')
            .replace(/\+/g, ' + ');
    }

    function keyEventToAccelerator(e) {
        var parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');

        var key = e.key;
        // Ignora teclas modificadoras sozinhas — precisa de uma tecla "principal" junto.
        if (['Control', 'Alt', 'Shift', 'Meta'].indexOf(key) !== -1) return null;

        if (key.length === 1) key = key.toUpperCase();
        else if (key === ' ') key = 'Space';

        if (!parts.length) return null; // exige ao menos um modificador, pra não capturar teclas comuns

        parts.push(key);
        return parts.join('+');
    }

    // Captura de atalho: clique no campo entra em modo "escutando"
    shortcutEl.addEventListener('click', function () {
        shortcutEl.classList.add('listening');
        shortcutEl.value = 'Pressione as teclas...';
        feedbackEl.textContent = '';
        feedbackEl.className = '';
    });

    shortcutEl.addEventListener('keydown', function (e) {
        e.preventDefault();
        var accelerator = keyEventToAccelerator(e);
        if (!accelerator) return;

        shortcutEl.classList.remove('listening');
        shortcutEl.blur();

        window.prisma.testShortcut(accelerator).then(function (result) {
            if (result.available) {
                currentAccelerator = accelerator;
                shortcutEl.value = acceleratorToDisplay(accelerator);
                feedbackEl.textContent = 'Atalho disponível.';
                feedbackEl.className = 'ok';
            } else {
                shortcutEl.value = acceleratorToDisplay(currentAccelerator);
                feedbackEl.textContent = 'Essa combinação já está em uso por outro programa. Tente outra.';
                feedbackEl.className = 'error';
            }
        });
    });

    saveBtn.addEventListener('click', function () {
        var serverUrl = serverUrlEl.value.trim();
        var uid = uidEl.value.trim();
        var apiKey = apiKeyEl.value.trim();

        if (!serverUrl || !uid || !apiKey) {
            feedbackEl.textContent = 'Preencha URL do servidor, UUID e chave de API.';
            feedbackEl.className = 'error';
            return;
        }
        if (!/^https?:\/\//i.test(serverUrl)) {
            feedbackEl.textContent = 'A URL do servidor deve começar com http:// ou https://';
            feedbackEl.className = 'error';
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';

        window.prisma.saveConfig({
            serverUrl: serverUrl,
            uid: uid,
            apiKey: apiKey,
            shortcut: currentAccelerator,
            launchAtStartup: launchAtStartupEl.checked,
            syncBookmarks: syncBookmarksEl.checked,
            syncFiles: syncFilesEl.checked,
        }).then(function (result) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar';
            feedbackEl.className = 'ok';
            feedbackEl.textContent = 'Salvo! Atalho ativo: ' + acceleratorToDisplay(result.shortcutApplied || DEFAULT_SHORTCUT_ACCELERATOR);
            currentAccelerator = result.shortcutApplied || currentAccelerator;
            shortcutEl.value = acceleratorToDisplay(currentAccelerator);

            setTimeout(function () { window.prisma.closeSettings(); }, 900);
        });
    });
})();
