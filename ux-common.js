(function () {
  'use strict';

  const PROJECTS_KEY = 'ra_projects_v2';
  const CURRENT_PROJECT_KEY = 'ra_current_project_v2';

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
    const sorter = (input) => {
      if (input === null || typeof input !== 'object') return input;
      if (seen.has(input)) return '[Circular]';
      seen.add(input);
      if (Array.isArray(input)) return input.map(sorter);
      return Object.keys(input).sort().reduce((acc, key) => {
        const v = input[key];
        if (typeof v !== 'function' && typeof v !== 'undefined') acc[key] = sorter(v);
        return acc;
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
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.slice(0, 25)));
  }

  function createProject(input) {
    const createdAt = nowIso();
    const project = {
      id: uid(),
      lastTool: (input && input.toolKey) || 'situatietekening',
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
    let project = projects.find(item => item.id === currentId);

    if (!project) {
      project = createProject({ toolKey: toolKey || 'situatietekening' });
      return project;
    }

    if (toolKey && project.lastTool !== toolKey) {
      project.lastTool = toolKey;
      project.modifiedAt = nowIso();
      writeProjects([project, ...projects.filter(item => item.id !== project.id)]);
    }
    return project;
  }

  function updateProject(projectId, patch) {
    const projects = readProjects();
    const index = projects.findIndex(item => item.id === projectId);
    if (index === -1) return null;
    const next = {
      ...projects[index],
      ...patch,
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
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch (err) {
      return value;
    }
  }

  function formatProjectDate(value) {
    if (!value) return 'Datum onbekend';
    try {
      return new Intl.DateTimeFormat('nl-NL', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch (err) {
      return formatDateTime(value);
    }
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
    if (/gereed|gedownload|succes|ongedaan|opnieuw/.test(text)) return 'success';
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
    document.querySelectorAll('.ux-invalid').forEach(el => el.classList.remove('ux-invalid'));
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
      reviewOpen: false,
      runComplete: false,
      timer: null
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

    updateStepper(context);

    // Houd alleen het voortgangsstappenplan actueel. Er wordt niets opgeslagen.
    context.timer = setInterval(() => updateStepper(context), config.pollInterval || 900);

    return context;
  }

  function renderRecentProjects() {
    const container = document.getElementById('uxRecentProjects');
    if (!container) return;
    const projects = readProjects().slice(0, 6);
    if (!projects.length) {
      container.innerHTML = '<div class="ux-empty-recent">Nog geen recente projecten. Open een tool om uw gebruiksgeschiedenis hier te zien.</div>';
      return;
    }
    container.innerHTML = projects.map(project => `
      <article class="ux-recent-card">
        <div>
          <h3 class="ux-recent-title">${escapeHtml(formatProjectDate(project.createdAt || project.modifiedAt))}</h3>
          <div class="ux-recent-meta">
            <span>Gebruikt op: ${escapeHtml(formatDateTime(project.modifiedAt || project.createdAt))}</span>
          </div>
        </div>
        <div class="ux-recent-actions">
          <span class="ux-tool-badge">${escapeHtml(TOOL_LABELS[project.lastTool] || 'Project')}</span>
          <button type="button" class="ux-primary-btn" data-open-tool="${escapeHtml(project.lastTool || 'situatietekening')}">Open tool</button>
        </div>
      </article>
    `).join('');
    container.querySelectorAll('[data-open-tool]').forEach(button => {
      button.addEventListener('click', () => {
        const toolKey = button.dataset.openTool || 'situatietekening';
        createProject({ toolKey });
        window.location.href = TOOL_URLS[toolKey] || 'index.html';
      });
    });
  }

  function initLanding() {
    ensureToastRoot();
    window.alert = function (message) { notify(String(message || ''), inferToastType(message)); };
    renderRecentProjects();

    document.querySelectorAll('a.tool[data-tool-key]').forEach(link => {
      link.addEventListener('click', () => {
        createProject({ toolKey: link.dataset.toolKey });
      });
    });
  }

  window.RAUX = {
    initTool,
    initLanding,
    notify,
    getCurrentProject,
    createProject,
    updateProject,
    setCurrentProject,
    renderRecentProjects,
    escapeHtml,
    formatDateTime,
    formatProjectDate,
    TOOL_LABELS,
    TOOL_URLS
  };
})();
