(function () {
  'use strict';

  const PROJECTS_KEY = 'ra_projects_v2';
  const CURRENT_PROJECT_KEY = 'ra_current_project_v2';
  const DB_NAME = 'rentmeester_assistent_v2';
  const DB_STORE = 'tool_states';

  const TOOL_LABELS = {
    situatietekening: 'Situatietekening / Factsheet',
    offerte: 'Offerte',
    georefereren: 'Georefereren'
  };

  const TOOL_URLS = {
    situatietekening: 'index.html',
    offerte: 'offerte.html',
    georefereren: 'georefereren.html'
  };

  let activeContext = null;
  let toastRoot = null;
  let modalBackdrop = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function cloneState(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (err) {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function stableStringify(value) {
    const seen = new WeakSet();
    const sorter = input => {
      if (input === null || typeof input !== 'object') return input;
      if (seen.has(input)) return '[Circular]';
      seen.add(input);
      if (Array.isArray(input)) return input.map(sorter);
      return Object.keys(input).sort().reduce((result, key) => {
        const item = input[key];
        if (typeof item !== 'function' && typeof item !== 'undefined') result[key] = sorter(item);
        return result;
      }, {});
    };
    return JSON.stringify(sorter(value));
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function readProjects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function writeProjects(projects) {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.slice(0, 25)));
    } catch (err) {
      console.error('Projectoverzicht kon niet worden bewaard.', err);
    }
  }

  function createProject(input) {
    const createdAt = nowIso();
    const toolKey = (input && input.toolKey) || 'situatietekening';
    const project = {
      id: uid(),
      title: toolKey === 'georefereren' ? 'Georefereren' : 'Nog geen perceel geselecteerd',
      itemCount: 0,
      lastTool: toolKey,
      createdAt,
      modifiedAt: createdAt,
      lastRunAt: null
    };
    const projects = readProjects().filter(item => item.id !== project.id);
    projects.unshift(project);
    writeProjects(projects);
    localStorage.setItem(CURRENT_PROJECT_KEY, project.id);
    return project;
  }

  function getCurrentProject(toolKey) {
    const projects = readProjects();
    const currentId = localStorage.getItem(CURRENT_PROJECT_KEY);
    const project = projects.find(item => item.id === currentId) || null;

    // Een project hoort bij één tool. Een gewone toolwissel start daarom leeg.
    if (project && toolKey && project.lastTool !== toolKey) {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
      return null;
    }

    return project;
  }

  function clearCurrentProject() {
    localStorage.removeItem(CURRENT_PROJECT_KEY);
  }

  function updateProject(projectId, patch) {
    const projects = readProjects();
    const index = projects.findIndex(item => item.id === projectId);
    if (index === -1) return null;

    const next = {
      ...projects[index],
      ...(patch || {}),
      modifiedAt: patch && patch.modifiedAt ? patch.modifiedAt : nowIso()
    };

    projects.splice(index, 1);
    projects.unshift(next);
    writeProjects(projects);
    return next;
  }

  function setCurrentProject(projectId) {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  }

  function formatDateTime(value) {
    if (!value) return 'Datum onbekend';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch (err) {
      return String(value);
    }
  }

  function formatProjectDate(value) {
    if (!value) return 'Datum onbekend';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch (err) {
      return formatDateTime(value);
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB wordt niet ondersteund.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Lokale opslag kon niet worden geopend.'));
    });
  }

  async function dbGet(key) {
    try {
      const db = await openDatabase();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readonly');
        const request = transaction.objectStore(DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      });
    } catch (err) {
      try {
        return JSON.parse(localStorage.getItem(`ra_state_${key}`) || 'null');
      } catch (fallbackError) {
        return null;
      }
    }
  }

  async function dbSet(key, value) {
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        transaction.objectStore(DB_STORE).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    } catch (err) {
      localStorage.setItem(`ra_state_${key}`, JSON.stringify(value));
    }
  }

  async function dbDelete(key) {
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        transaction.objectStore(DB_STORE).delete(key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    } catch (err) {
      // De fallback-opslag kan ook bestaan wanneer IndexedDB eerder niet beschikbaar was.
    }

    try {
      localStorage.removeItem(`ra_state_${key}`);
    } catch (err) {}
  }

  async function deleteProject(projectId) {
    if (!projectId) return false;

    const projects = readProjects();
    const project = projects.find(item => item.id === projectId);
    if (!project) return false;

    const remaining = projects.filter(item => item.id !== projectId);
    writeProjects(remaining);

    if (localStorage.getItem(CURRENT_PROJECT_KEY) === projectId) {
      localStorage.removeItem(CURRENT_PROJECT_KEY);
    }

    await Promise.all(
      Object.keys(TOOL_URLS).map(toolKey => dbDelete(`${projectId}:${toolKey}`))
    );

    return true;
  }

  function stateHasProjectContent(project, state) {
    if (!project || !state) return false;

    if (project.lastTool === 'situatietekening' || project.lastTool === 'offerte') {
      return !!(
        state.geojson &&
        Array.isArray(state.geojson.features) &&
        state.geojson.features.length
      );
    }

    if (project.lastTool === 'georefereren') {
      const drawings = state.drawings && Array.isArray(state.drawings.features)
        ? state.drawings.features.length
        : 0;
      const overlays = Array.isArray(state.overlays) ? state.overlays.length : 0;
      const imageUrl = state.currentImage && state.currentImage.url;
      return drawings > 0 || overlays > 0 || !!imageUrl;
    }

    return Number(project.itemCount || 0) > 0;
  }

  function ensureProjectForContext(context) {
    if (context.project) return context.project;

    const project = createProject({ toolKey: context.config.toolKey });
    context.project = project;
    context.storageKey = `${project.id}:${context.config.toolKey}`;
    return project;
  }

  async function discardEmptyContextProject(context) {
    if (!context || !context.project) return;
    const projectId = context.project.id;
    await deleteProject(projectId);
    context.project = null;
    context.storageKey = null;
    context.lastHash = '';
  }

  function ensureToastRoot() {
    if (toastRoot) return toastRoot;
    toastRoot = document.createElement('div');
    toastRoot.className = 'ux-toast-root';
    toastRoot.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRoot);
    return toastRoot;
  }

  function inferToastType(message) {
    const text = String(message || '').toLowerCase();
    if (/mislukt|fout|geen geldig|selecteer|vul|kon niet|ontbreekt/.test(text)) return 'error';
    if (/waarschuwing|let op/.test(text)) return 'warning';
    if (/gereed|hersteld|gedownload|succes/.test(text)) return 'success';
    return 'info';
  }

  function notify(message, type, duration) {
    const root = ensureToastRoot();
    const toast = document.createElement('div');
    toast.className = `ux-toast is-${type || inferToastType(message)}`;
    toast.innerHTML = `
      <span class="ux-toast-marker" aria-hidden="true"></span>
      <div>${escapeHtml(message)}</div>
      <button type="button" class="ux-toast-close" aria-label="Melding sluiten">×</button>
    `;

    const remove = () => {
      if (!toast.isConnected) return;
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-5px)';
      setTimeout(() => toast.remove(), 160);
    };

    toast.querySelector('.ux-toast-close').addEventListener('click', remove);
    root.appendChild(toast);
    setTimeout(remove, duration || 4800);
  }

  function closeModal() {
    if (modalBackdrop && modalBackdrop.isConnected) modalBackdrop.remove();
    modalBackdrop = null;
    if (activeContext) {
      activeContext.reviewOpen = false;
      updateStepper(activeContext);
    }
  }

  function showModal(options) {
    closeModal();
    modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'ux-modal-backdrop';
    modalBackdrop.innerHTML = `
      <section class="ux-modal" role="dialog" aria-modal="true" aria-labelledby="uxModalTitle">
        <div class="ux-modal-head">
          <div>
            <h2 class="ux-modal-title" id="uxModalTitle">${escapeHtml(options.title || '')}</h2>
            ${options.subtitle ? `<p class="ux-modal-subtitle">${escapeHtml(options.subtitle)}</p>` : ''}
          </div>
          <button type="button" class="ux-modal-close" aria-label="Venster sluiten">×</button>
        </div>
        <div class="ux-modal-body"></div>
        <div class="ux-modal-actions"></div>
      </section>
    `;

    const body = modalBackdrop.querySelector('.ux-modal-body');
    if (typeof options.body === 'string') body.innerHTML = options.body;
    else if (options.body instanceof Node) body.appendChild(options.body);

    const actions = modalBackdrop.querySelector('.ux-modal-actions');
    (options.actions || []).forEach(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.className || 'ux-secondary-btn';
      button.textContent = action.label;
      button.addEventListener('click', async () => {
        if (action.close !== false) closeModal();
        if (typeof action.onClick === 'function') await action.onClick();
      });
      actions.appendChild(button);
    });

    modalBackdrop.querySelector('.ux-modal-close').addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', event => {
      if (event.target === modalBackdrop) closeModal();
    });
    document.body.appendChild(modalBackdrop);

    setTimeout(() => {
      const focusTarget = modalBackdrop.querySelector('input, select, button');
      if (focusTarget) focusTarget.focus();
    }, 0);

    return modalBackdrop;
  }

  function buildWorkspace(config) {
    const header = document.querySelector('header');
    const shell = document.createElement('section');
    shell.className = 'ux-workspace-shell';
    shell.innerHTML = `
      <nav class="ux-stepper" aria-label="Voortgang">
        ${(config.steps || []).map((step, index) => `
          <div class="ux-step" data-ux-step="${index}">
            <span class="ux-step-number">${index + 1}</span>
            <span class="ux-step-label">${escapeHtml(step)}</span>
          </div>
        `).join('')}
      </nav>
    `;

    if (header) header.insertAdjacentElement('afterend', shell);
    else document.body.insertAdjacentElement('afterbegin', shell);
    return shell;
  }

  function updateStepper(context) {
    if (!context || !context.shell) return;
    let checks = [];
    try {
      checks = context.config.adapter.getProgress ? context.config.adapter.getProgress() : [];
    } catch (err) {
      checks = [];
    }

    checks = Array.isArray(checks) ? checks.slice() : [];
    checks.push(!!(context.reviewOpen || context.runComplete));

    let activeIndex = checks.findIndex(value => !value);
    if (activeIndex === -1) activeIndex = Math.max(0, context.config.steps.length - 1);
    activeIndex = Math.min(activeIndex, context.config.steps.length - 1);

    context.shell.querySelectorAll('.ux-step').forEach((step, index) => {
      step.classList.toggle('is-complete', index < activeIndex || (context.runComplete && index < context.config.steps.length - 1));
      step.classList.toggle('is-active', index === activeIndex || (context.runComplete && index === context.config.steps.length - 1));
      const number = step.querySelector('.ux-step-number');
      if (number) number.textContent = step.classList.contains('is-complete') ? '✓' : String(index + 1);
    });
  }

  function createValidationPanel(runButton) {
    const panel = document.createElement('div');
    panel.className = 'ux-validation-panel';
    panel.setAttribute('role', 'alert');
    const parent = runButton && (runButton.closest('.button-stack') || runButton.closest('.action-buttons') || runButton.parentElement);
    if (parent) {
      const preferred = runButton.closest('.run-row') || runButton.closest('.button-row') || runButton;
      const target = preferred && preferred.parentElement === parent ? preferred : null;
      if (target) parent.insertBefore(panel, target);
      else parent.appendChild(panel);
    }
    return panel;
  }

  function clearValidation(context) {
    if (!context.validationPanel) return;
    context.validationPanel.classList.remove('is-visible');
    context.validationPanel.innerHTML = '';
    document.querySelectorAll('.ux-invalid').forEach(element => element.classList.remove('ux-invalid'));
  }

  function showValidation(context, errors) {
    clearValidation(context);
    const normalized = (errors || []).map(item => typeof item === 'string' ? { message: item } : item);
    context.validationPanel.innerHTML = `
      <div class="ux-validation-title">Controleer eerst het volgende:</div>
      <ul class="ux-validation-list">${normalized.map(item => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>
    `;
    context.validationPanel.classList.add('is-visible');

    normalized.forEach(item => {
      if (!item.selector) return;
      const target = document.querySelector(item.selector);
      if (target) target.classList.add('ux-invalid');
    });

    const first = normalized.find(item => item.selector && document.querySelector(item.selector));
    if (first) {
      const target = document.querySelector(first.selector);
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
      if (typeof target.focus === 'function') setTimeout(() => target.focus(), 300);
    }
  }

  function summaryHtml(summary) {
    const rows = (summary && summary.rows) || [];
    const notes = (summary && summary.notes) || [];
    return `
      <div class="ux-summary-grid">
        ${rows.map(row => `
          <div class="ux-summary-item">
            <div class="ux-summary-label">${escapeHtml(row.label)}</div>
            <div class="ux-summary-value">${escapeHtml(row.value)}</div>
          </div>
        `).join('')}
      </div>
      ${notes.map(note => `<div class="ux-summary-note">${escapeHtml(note)}</div>`).join('')}
    `;
  }

  async function captureState(context, force) {
    if (!context || context.applyingState) return;

    if (context.captureBusy) {
      if (context.capturePromise) await context.capturePromise;
      if (force) return captureState(context, true);
      return;
    }

    context.captureBusy = true;
    context.capturePromise = (async () => {
      try {
        let itemCount = 0;
        if (typeof context.config.adapter.getProjectItemCount === 'function') {
          itemCount = Number(context.config.adapter.getProjectItemCount()) || 0;
        }

        const hasProjectContent = typeof context.config.adapter.hasProjectContent === 'function'
          ? !!context.config.adapter.hasProjectContent()
          : itemCount > 0;

        // Zolang er niets is geselecteerd of gemaakt, ontstaat er geen recent project.
        if (!hasProjectContent) {
          if (context.project) await discardEmptyContextProject(context);
          updateStepper(context);
          return;
        }

        ensureProjectForContext(context);

        const hashSource = context.config.adapter.getStateHash
          ? context.config.adapter.getStateHash()
          : context.config.adapter.getState();
        const hash = stableStringify(hashSource);

        if (!force && hash === context.lastHash) {
          updateStepper(context);
          return;
        }

        const state = cloneState(await context.config.adapter.getState());
        await dbSet(context.storageKey, state);
        context.lastHash = hash;

        let title = context.project.title;
        if (typeof context.config.adapter.getProjectTitle === 'function') {
          title = context.config.adapter.getProjectTitle() || title;
        }

        context.project = updateProject(context.project.id, {
          title,
          itemCount,
          lastTool: context.config.toolKey
        }) || context.project;

        updateStepper(context);
      } catch (err) {
        console.error('Projectgegevens konden niet worden bewaard.', err);
        if (!context.storageErrorShown) {
          context.storageErrorShown = true;
          notify('Projectgegevens konden niet worden bewaard in deze browser.', 'error');
        }
      }
    })();

    try {
      await context.capturePromise;
    } finally {
      context.captureBusy = false;
      context.capturePromise = null;
    }
  }

  async function showReview(context) {
    clearValidation(context);
    let errors = [];

    try {
      errors = context.config.adapter.validate ? context.config.adapter.validate() : [];
    } catch (err) {
      errors = [{ message: err.message || 'De invoer kon niet worden gecontroleerd.' }];
    }

    if (errors && errors.length) {
      showValidation(context, errors);
      notify('Er ontbreken nog gegevens. Controleer de gemarkeerde onderdelen.', 'error');
      return;
    }

    await captureState(context, true);
    context.reviewOpen = true;
    updateStepper(context);

    const summary = context.config.adapter.getSummary
      ? context.config.adapter.getSummary(context.project)
      : { rows: [] };

    showModal({
      title: context.config.reviewTitle || 'Controleer uw invoer',
      subtitle: 'Bekijk de gegevens voordat het bestand wordt gemaakt.',
      body: summaryHtml(summary),
      actions: [
        { label: 'Terug', className: 'ux-secondary-btn' },
        {
          label: context.config.confirmLabel || 'Bevestigen en exporteren',
          className: 'ux-primary-btn',
          close: false,
          onClick: async () => {
            const primary = modalBackdrop && modalBackdrop.querySelector('.ux-primary-btn');
            if (primary) {
              primary.disabled = true;
              primary.textContent = 'Bezig…';
            }

            try {
              await context.config.adapter.run();
              context.runComplete = true;
              context.project = updateProject(context.project.id, {
                lastTool: context.config.toolKey,
                lastRunAt: nowIso()
              }) || context.project;
              await captureState(context, true);
              closeModal();
              updateStepper(context);
              notify(context.config.successMessage || 'Het bestand is gemaakt en wordt gedownload.', 'success');
            } catch (err) {
              if (primary) {
                primary.disabled = false;
                primary.textContent = context.config.confirmLabel || 'Bevestigen en exporteren';
              }
              notify(err.message || 'De actie is mislukt.', 'error');
            }
          }
        }
      ]
    });
  }

  function isInternalHtmlLink(link) {
    if (!link || !link.href || link.target === '_blank' || link.hasAttribute('download')) return false;
    if (link.getAttribute('href').startsWith('#')) return false;

    try {
      const url = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      return url.protocol === current.protocol &&
        url.host === current.host &&
        /\.html(?:$|[?#])/i.test(url.href);
    } catch (err) {
      return false;
    }
  }

  function toolKeyFromUrl(href) {
    try {
      const path = new URL(href, window.location.href).pathname.toLowerCase();
      if (path.endsWith('/index.html') || path.endsWith('index.html')) return 'situatietekening';
      if (path.endsWith('/offerte.html') || path.endsWith('offerte.html')) return 'offerte';
      if (path.endsWith('/georefereren.html') || path.endsWith('georefereren.html')) return 'georefereren';
    } catch (err) {}
    return null;
  }

  function bindInternalNavigation(context) {
    document.addEventListener('click', async event => {
      if (context.navigating || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest && event.target.closest('a[href]');
      if (!isInternalHtmlLink(link)) return;

      event.preventDefault();
      context.navigating = true;
      await captureState(context, true);

      const destinationTool = toolKeyFromUrl(link.href);
      if (!destinationTool || destinationTool !== context.config.toolKey) {
        clearCurrentProject();
      }

      window.location.href = link.href;
    }, true);
  }

  async function initTool(config) {
    const project = getCurrentProject(config.toolKey);
    const shell = buildWorkspace(config);
    const runButton = document.querySelector(config.runButtonSelector || '#runBtn');
    if (runButton && config.runButtonLabel) runButton.textContent = config.runButtonLabel;

    const context = {
      config,
      project,
      shell,
      runButton,
      validationPanel: createValidationPanel(runButton),
      storageKey: project ? `${project.id}:${config.toolKey}` : null,
      lastHash: '',
      applyingState: false,
      captureBusy: false,
      capturePromise: null,
      reviewOpen: false,
      runComplete: false,
      storageErrorShown: false,
      navigating: false,
      timer: null,
      debounceTimer: null
    };
    activeContext = context;

    window.alert = function (message) {
      notify(String(message || ''), inferToastType(message));
    };

    if (runButton) {
      runButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        showReview(context);
      }, true);
    }

    const saved = context.storageKey ? await dbGet(context.storageKey) : null;
    if (saved) {
      try {
        context.applyingState = true;
        await config.adapter.restoreState(cloneState(saved));
      } catch (err) {
        console.error('Project kon niet volledig worden hersteld.', err);
        notify('Niet alle gegevens van dit project konden worden hersteld.', 'warning');
      } finally {
        context.applyingState = false;
      }
    }

    const initialHashSource = config.adapter.getStateHash
      ? config.adapter.getStateHash()
      : await config.adapter.getState();
    context.lastHash = stableStringify(initialHashSource);
    updateStepper(context);

    // Een leeg geopende tool wordt niet als project opgeslagen.

    const scheduleCapture = () => {
      clearTimeout(context.debounceTimer);
      context.debounceTimer = setTimeout(() => captureState(context, false), 350);
    };

    document.addEventListener('input', scheduleCapture, true);
    document.addEventListener('change', scheduleCapture, true);
    document.addEventListener('pointerup', scheduleCapture, true);

    context.timer = setInterval(() => captureState(context, false), config.pollInterval || 700);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') captureState(context, true);
    });
    window.addEventListener('pagehide', () => captureState(context, true));
    window.addEventListener('beforeunload', () => captureState(context, true));

    bindInternalNavigation(context);
    return context;
  }

  function parcelLabelFromStateFeature(feature) {
    const props = feature && feature.properties ? feature.properties : {};
    const gemeente =
      props.kadastralegemeentenaam ||
      props.kadastraleGemeenteNaam ||
      props.kadastraleGemeenteWaarde ||
      props.gemeentenaam ||
      props.gemeente ||
      props.kadastralegemeente ||
      '';
    const sectie =
      props.sectie ||
      props.kadastralesectie ||
      props.kadastraleSectie ||
      props.kadas_sectie ||
      '';
    const nummer =
      props.perceelnummer ||
      props.kadastraalperceelnummer ||
      props.kadastraalPerceelnummer ||
      props.kadas_perceelnummer ||
      props.perceelNummer ||
      '';

    if (gemeente && sectie && nummer) return `${gemeente} ${sectie} ${nummer}`;

    return String(
      props.kadastraleAanduiding ||
      props.kadastraleaanduiding ||
      props.label ||
      nummer ||
      'Onbekend perceel'
    );
  }

  function deriveProjectTitle(project, state) {
    if (project.lastTool === 'situatietekening' || project.lastTool === 'offerte') {
      const features = state && state.geojson && Array.isArray(state.geojson.features)
        ? state.geojson.features
        : [];
      if (features.length > 1) return `Cluster (${features.length})`;
      if (features.length === 1) return parcelLabelFromStateFeature(features[0]);
      return 'Nog geen perceel geselecteerd';
    }

    if (project.lastTool === 'georefereren') {
      const searched = state && typeof state.searchText === 'string' ? state.searchText.trim() : '';
      if (searched) return searched;
      const imageName = state && state.currentImage && state.currentImage.name
        ? String(state.currentImage.name).trim()
        : '';
      if (imageName && imageName !== 'georefereren') return imageName.replace(/\.[^.]+$/, '');
      return 'Georefereren';
    }

    return project.title || 'Recent project';
  }

  async function renderRecentProjects() {
    const container = document.getElementById('uxRecentProjects');
    if (!container) return;

    const projects = readProjects();
    if (!projects.length) {
      container.innerHTML = '<div class="ux-empty-recent">Nog geen recente projecten. Open een tool en maak een selectie.</div>';
      return;
    }

    container.innerHTML = '<div class="ux-empty-recent">Recente projecten laden…</div>';

    const loadedProjects = await Promise.all(projects.map(async project => {
      const state = await dbGet(`${project.id}:${project.lastTool}`);
      return {
        ...project,
        state,
        displayTitle: deriveProjectTitle(project, state)
      };
    }));

    const emptyProjects = loadedProjects.filter(project => !stateHasProjectContent(project, project.state));
    if (emptyProjects.length) {
      await Promise.all(emptyProjects.map(project => deleteProject(project.id)));
    }

    const displayProjects = loadedProjects
      .filter(project => stateHasProjectContent(project, project.state))
      .slice(0, 6);

    if (!displayProjects.length) {
      container.innerHTML = '<div class="ux-empty-recent">Nog geen recente projecten. Open een tool en maak een selectie.</div>';
      return;
    }

    const allProjects = readProjects();
    let metadataChanged = false;
    displayProjects.forEach(displayProject => {
      const original = allProjects.find(item => item.id === displayProject.id);
      if (original && original.title !== displayProject.displayTitle) {
        original.title = displayProject.displayTitle;
        metadataChanged = true;
      }
    });
    if (metadataChanged) writeProjects(allProjects);

    container.innerHTML = displayProjects.map(project => `
      <article class="ux-recent-card">
        <div>
          <h3 class="ux-recent-title">${escapeHtml(project.displayTitle)}</h3>
          <div class="ux-recent-meta">
            <span>Laatst gewijzigd: ${escapeHtml(formatDateTime(project.modifiedAt || project.createdAt))}</span>
          </div>
        </div>
        <div class="ux-recent-actions">
          <span class="ux-tool-badge">${escapeHtml(TOOL_LABELS[project.lastTool] || 'Project')}</span>
          <div class="ux-recent-button-group">
            <button type="button" class="ux-delete-btn" data-delete-project="${escapeHtml(project.id)}" data-project-title="${escapeHtml(project.displayTitle)}">Verwijder</button>
            <button type="button" class="ux-primary-btn" data-open-project="${escapeHtml(project.id)}" data-tool="${escapeHtml(project.lastTool || 'situatietekening')}">Open</button>
          </div>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('[data-open-project]').forEach(button => {
      button.addEventListener('click', () => {
        setCurrentProject(button.dataset.openProject);
        window.location.href = TOOL_URLS[button.dataset.tool] || 'index.html';
      });
    });

    container.querySelectorAll('[data-delete-project]').forEach(button => {
      button.addEventListener('click', async () => {
        const projectId = button.dataset.deleteProject;
        const projectTitle = button.dataset.projectTitle || 'dit project';
        const confirmed = window.confirm(`Weet je zeker dat je “${projectTitle}” wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`);
        if (!confirmed) return;

        button.disabled = true;
        button.textContent = 'Verwijderen…';

        try {
          await deleteProject(projectId);
          await renderRecentProjects();
        } catch (err) {
          console.error('Recent project kon niet worden verwijderd.', err);
          notify('Het recente project kon niet worden verwijderd.', 'error');
          button.disabled = false;
          button.textContent = 'Verwijder';
        }
      });
    });
  }

  function initLanding() {
    ensureToastRoot();
    clearCurrentProject();

    window.alert = function (message) {
      notify(String(message || ''), inferToastType(message));
    };

    renderRecentProjects();
  }

  window.RAUX = {
    initTool,
    initLanding,
    notify,
    getCurrentProject,
    createProject,
    updateProject,
    setCurrentProject,
    clearCurrentProject,
    deleteProject,
    renderRecentProjects,
    escapeHtml,
    formatDateTime,
    formatProjectDate,
    TOOL_LABELS,
    TOOL_URLS
  };
})();
