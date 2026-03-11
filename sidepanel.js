'use strict';

// Sidepanel script for SideBarny LLM Extension

const DEBUG = false;
const TRIM_SUFFIX = '\n...[обрізано]';
const PROVIDERS = Object.freeze([
  {id: 'chatgpt', name: 'OpenAI ChatGPT', url: 'https://chatgpt.com/'},
  {id: 'claude', name: 'Anthropic Claude', url: 'https://claude.ai/'},
  {id: 'gemini', name: 'Google Gemini', url: 'https://gemini.google.com/'},
  {id: 'rovo', name: 'Atlassian Rovo', url: 'https://rovo-extension-web.atlassian.com/extension/rovo-chat'},
  {id: 'copilot', name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/'},
  {id: 'grok', name: 'xAI Grok', url: 'https://grok.com/'},

  {id: 'poe', name: 'Poe', url: 'https://poe.com/'},
  {id: 'huggingchat', name: 'HuggingChat', url: 'https://huggingface.co/chat'}
]);
const PROVIDER_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));
const SELECTED_PROVIDER_KEY = 'selectedProviderId';
const COPY_MAX_LENGTH = 100000;
const PASTE_ACTION = 'sidebarny:pasteToChat';
const PASTE_RESULT_ACTION = 'sidebarny:pasteToChatResult';
const GET_URL_ACTION = 'sidebarny:getCurrentUrl';
const GET_URL_RESULT_ACTION = 'sidebarny:getCurrentUrlResult';
const PASTE_TIMEOUT_MS = 2000;
const GET_URL_TIMEOUT_MS = 500;
const AUTO_PASTE_PROVIDERS = new Set(PROVIDERS.map((p) => p.id));

let providerSelect = null;
let providerFrame = null;
let openExternalLink = null;
let pickTextBtn = null;
let pickHtmlBtn = null;
let cancelPickerBtn = null;
let copyTooltip = null;
let statusText = null;

let isCaptureInProgress = false;
let isElementPickerActive = false;
let pickerTabId = null;
let latestCapturedContent = '';
let copyTooltipTimer = null;
let statusTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  try {
    init();
    debugLog('ініціалізовано');
  } catch (error) {
    console.error('Помилка ініціалізації SideBarny:', error);
  }
});

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }
  console.debug('[SideBarny]', ...args);
}

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Обов'язковий елемент #${id} не знайдено.`);
  }
  return element;
}

function init() {
  providerSelect = requireElement('providerSelect');
  providerFrame = requireElement('providerFrame');
  openExternalLink = requireElement('openExternalLink');
  pickTextBtn = requireElement('pickTextBtn');
  pickHtmlBtn = requireElement('pickHtmlBtn');
  cancelPickerBtn = requireElement('cancelPickerBtn');
  copyTooltip = requireElement('copyTooltip');
  statusText = requireElement('statusText');

  renderProviderOptions();

  chrome.storage.local.get(SELECTED_PROVIDER_KEY, (result) => {
    const savedProviderId = result[SELECTED_PROVIDER_KEY];
    const defaultProvider = getProviderById(savedProviderId) || PROVIDERS[0];
    providerSelect.value = defaultProvider.id;
    loadProvider(defaultProvider.id);
  });

  providerSelect.addEventListener('change', () => {
    loadProvider(providerSelect.value);
  });

  pickTextBtn.addEventListener('click', () => {
    void startCapture('text');
  });

  pickHtmlBtn.addEventListener('click', () => {
    void startCapture('html');
  });

  cancelPickerBtn.addEventListener('click', () => {
    void cancelElementPicker();
  });

  openExternalLink.addEventListener('click', (event) => {
    event.preventDefault();
    void openProviderInTab();
  });
}

function renderProviderOptions() {
  providerSelect.innerHTML = '';
  for (const provider of PROVIDERS) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    providerSelect.appendChild(option);
  }
}

function loadProvider(providerId) {
  const provider = getProviderById(providerId);
  if (!provider) {
    setStatus('Обрано невідомого провайдера.', true);
    return;
  }

  chrome.storage.local.set({[SELECTED_PROVIDER_KEY]: provider.id});
  applyProviderTheme(provider.id);
  providerFrame.src = provider.url;
  providerFrame.title = `Чат — ${provider.name}`;
  openExternalLink.href = provider.url;

  setStatus('');
}

function applyProviderTheme(providerId) {
  const provider = getProviderById(providerId);
  const themeId = provider?.id || '';
  document.documentElement.setAttribute('data-provider', themeId);
  document.body?.setAttribute('data-provider', themeId);
}

function setPickerState(isActive, tabId = null) {
  isElementPickerActive = isActive;
  pickerTabId = isActive ? tabId : null;
  cancelPickerBtn.hidden = !isActive;
}

async function startCapture(outputType) {
  if (isCaptureInProgress) {
    return;
  }

  isCaptureInProgress = true;
  setCaptureButtonsDisabled(true);

  try {
    const activeTab = await getActiveTab();
    if (!activeTab?.id) {
      throw new Error('Не знайдено активну вкладку.');
    }

    await ensureContextScript(activeTab.id);
    await startElementPicker(activeTab.id, outputType);
  } catch (error) {
    setStatus(error?.message || 'Помилка захоплення.', true);
  } finally {
    isCaptureInProgress = false;
    setCaptureButtonsDisabled(false);

    if (!isElementPickerActive) {
      setPickerState(false);
    }
  }
}

async function startElementPicker(tabId, outputType) {
  setPickerState(true, tabId);
  setStatus(
    outputType === 'html'
      ? 'Наведи на елемент і клікни, щоб скопіювати HTML. Esc - скасувати.'
      : 'Наведи на елемент і клікни, щоб скопіювати текст. Esc - скасувати.'
  );

  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, {
      action: 'startElementPicker',
      outputType
    });
  } catch (error) {
    throw new Error(error?.message || 'Не вдалося запустити вибір елемента на цій сторінці.');
  } finally {
    setPickerState(false);
  }

  if (!response?.success) {
    if (response?.cancelled) {
      setStatus('Вибір елемента скасовано.');
      return;
    }

    throw new Error(response?.error || 'Помилка захоплення елемента.');
  }

  latestCapturedContent = trimToLimit(
    outputType === 'html' ? response?.payload?.html || '' : response?.payload?.text || '',
    COPY_MAX_LENGTH
  );

  if (!latestCapturedContent.trim()) {
    throw new Error(outputType === 'html' ? 'У вибраному елементі немає HTML.' : 'У вибраному елементі немає видимого тексту.');
  }

  const pasted = await pasteToProviderChat(latestCapturedContent);
  if (pasted) {
    showCopyTooltip(outputType === 'html' ? 'Вставлено HTML в чат' : 'Вставлено в чат');
    setStatus(outputType === 'html' ? 'HTML вставлено в чат провайдера.' : 'Контент вставлено в чат провайдера.');
    return;
  }

  const copiedInPage = Boolean(response?.payload?.copied);
  const copiedInPanel = await copyContentToClipboard(latestCapturedContent, {
    tooltipMessage: outputType === 'html' ? 'Скопійовано HTML' : 'Скопійовано контекст',
    silent: true
  });
  const copied = copiedInPanel || copiedInPage;

  if (!copied) {
    const copyError = response?.payload?.copyError;
    const fallbackMessage = copyError
      ? `Контент захоплено, але не вдалося записати в буфер обміну (${copyError}).`
      : 'Контент захоплено, але не вдалося записати в буфер обміну.';
    setStatus(fallbackMessage, true);
    return;
  }

  setStatus(outputType === 'html'
    ? 'HTML скопійовано в буфер обміну. Натисни Ctrl+V для вставки.'
    : 'Контент скопійовано в буфер обміну. Натисни Ctrl+V для вставки.');
}

async function cancelElementPicker() {
  if (!isElementPickerActive || !pickerTabId) {
    return;
  }

  const currentPickerTabId = pickerTabId;
  try {
    const response = await chrome.tabs.sendMessage(currentPickerTabId, {action: 'cancelElementPicker'});
    if (!response?.success) {
      throw new Error(response?.error || 'Запит на скасування відхилено.');
    }
    setStatus('Запит на скасування надіслано.');
  } catch (error) {
    setStatus('Не вдалося скасувати вибір елемента на сторінці.', true);
  } finally {
    setPickerState(false);
  }
}

async function ensureScriptingPermission() {
  const granted = await chrome.permissions.contains({
    permissions: ['scripting'],
    origins: ['<all_urls>']
  });
  if (granted) {
    return;
  }

  const accepted = await chrome.permissions.request({
    permissions: ['scripting'],
    origins: ['<all_urls>']
  });
  if (!accepted) {
    throw new Error('Для захоплення контенту потрібен дозвіл на доступ до сторінки.');
  }
}

async function ensureContextScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {action: 'ping'});
    return;
  } catch (error) {
    debugLog('ping content script не вдався, виконується інʼєкція', error?.message || error);
  }

  await ensureScriptingPermission();

  try {
    await chrome.scripting.executeScript({
      target: {tabId},
      files: ['content.js']
    });
  } catch (error) {
    const message = error?.message || '';
    if (message.includes('Cannot access a chrome://') || message.includes('Cannot access a chrome-')) {
      throw new Error('Неможливо захопити контент із внутрішніх сторінок браузера.');
    }
    if (message.includes('Cannot access contents of the page')) {
      throw new Error('Ця сторінка не дозволяє захоплення контенту. Спробуй іншу сторінку.');
    }
    throw new Error(message || 'Не вдалося підʼєднати content script на цій сторінці.');
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({active: true, currentWindow: true});
  return tabs[0] || null;
}

function trimToLimit(value, maxLength) {
  const normalized = `${value || ''}`;
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliceLength = Math.max(maxLength - TRIM_SUFFIX.length, 0);
  return `${normalized.slice(0, sliceLength)}${TRIM_SUFFIX}`;
}

async function copyContentToClipboard(content, options = {}) {
  const {silent = false, tooltipMessage = 'Скопійовано контекст'} = options;
  const valueToCopy = `${content || ''}`;

  if (!valueToCopy) {
    if (!silent) {
      setStatus('Немає контенту для копіювання.', true);
    }
    return false;
  }

  try {
    await navigator.clipboard.writeText(valueToCopy);
    showCopyTooltip(tooltipMessage);

    if (!silent) {
      setStatus('Скопійовано в буфер обміну.');
    }
    return true;
  } catch (error) {
    const fallbackCopied = copyWithExecCommand(valueToCopy);
    if (fallbackCopied) {
      showCopyTooltip(tooltipMessage);
      if (!silent) {
        setStatus('Скопійовано в буфер обміну.');
      }
      return true;
    }

    if (!silent) {
      setStatus('Помилка запису в буфер обміну.', true);
    }
    return false;
  }
}

function copyWithExecCommand(value) {
  const host = document.body || document.documentElement;
  if (!host) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  host.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }

  textarea.remove();
  return copied;
}

function setCaptureButtonsDisabled(disabled) {
  pickTextBtn.disabled = disabled;
  pickHtmlBtn.disabled = disabled;
}

function showCopyTooltip(message) {
  copyTooltip.textContent = message;
  copyTooltip.hidden = false;

  if (copyTooltipTimer) {
    clearTimeout(copyTooltipTimer);
  }

  copyTooltipTimer = setTimeout(() => {
    copyTooltip.hidden = true;
    copyTooltipTimer = null;
  }, 1500);
}

function setStatus(message, isError = false) {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  if (!message) {
    statusText.hidden = true;
    statusText.textContent = '';
    statusText.classList.remove('error');
    return;
  }

  statusText.textContent = message;
  statusText.hidden = false;
  statusText.classList.toggle('error', Boolean(isError));

  if (isElementPickerActive) {
    return;
  }

  statusTimer = setTimeout(() => {
    statusText.hidden = true;
    statusTimer = null;
  }, isError ? 6000 : 3500);
}

async function openProviderInTab() {
  const provider = getProviderById(providerSelect?.value);
  if (!provider?.url) {
    return;
  }

  const iframeUrl = await getIframeCurrentUrl(provider);
  window.open(iframeUrl || provider.url, '_blank');
}

function getIframeCurrentUrl(provider) {
  if (!AUTO_PASTE_PROVIDERS.has(provider?.id)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, GET_URL_TIMEOUT_MS);

    function onMessage(event) {
      if (!isProviderOrigin(event.origin, provider)) {
        return;
      }
      if (event.data?.action !== GET_URL_RESULT_ACTION) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      resolve(typeof event.data?.url === 'string' ? event.data.url : null);
    }

    window.addEventListener('message', onMessage);

    try {
      providerFrame.contentWindow.postMessage(
        {action: GET_URL_ACTION},
        provider.url
      );
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        window.removeEventListener('message', onMessage);
        resolve(null);
      }
    }
  });
}

function pasteToProviderChat(text) {
  const currentProviderId = providerSelect?.value;
  if (!AUTO_PASTE_PROVIDERS.has(currentProviderId)) {
    debugLog('авто-вставка не підтримується для', currentProviderId);
    return Promise.resolve(false);
  }

  const provider = getProviderById(currentProviderId);
  if (!provider?.url) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('message', onMessage);
      debugLog('авто-вставка: таймаут');
      resolve(false);
    }, PASTE_TIMEOUT_MS);

    function onMessage(event) {
      if (!isProviderOrigin(event.origin, provider)) {
        return;
      }
      if (event.data?.action !== PASTE_RESULT_ACTION) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      debugLog('авто-вставка: результат', event.data);
      resolve(Boolean(event.data?.success));
    }

    window.addEventListener('message', onMessage);

    try {
      providerFrame.contentWindow.postMessage(
        {action: PASTE_ACTION, text},
        provider.url
      );
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        window.removeEventListener('message', onMessage);
        debugLog('авто-вставка: помилка postMessage', error);
        resolve(false);
      }
    }
  });
}

function getProviderById(providerId) {
  if (!providerId) {
    return null;
  }
  return PROVIDER_BY_ID.get(providerId) || null;
}

function isProviderOrigin(origin, provider) {
  if (!origin || !provider?.url) {
    return false;
  }
  try {
    return new URL(provider.url).origin === origin;
  } catch {
    return false;
  }
}
