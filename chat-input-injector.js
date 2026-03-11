'use strict';

// Content script injected into LLM provider iframes to enable auto-paste of captured text.
// Communicates with sidepanel.js via window.postMessage.

(function () {
  if (window.__sidebarnyInjectorLoaded) {
    return;
  }
  window.__sidebarnyInjectorLoaded = true;

  const PASTE_ACTION = 'sidebarny:pasteToChat';
  const PASTE_RESULT_ACTION = 'sidebarny:pasteToChatResult';
  const GET_URL_ACTION = 'sidebarny:getCurrentUrl';
  const GET_URL_RESULT_ACTION = 'sidebarny:getCurrentUrlResult';
  const EXPECTED_ORIGIN = (() => {
    try {
      return `chrome-extension://${chrome.runtime.id}`;
    } catch {
      return null;
    }
  })();

  // Selectors derived from real DOM inspection of each provider.
  // Most specific first, with fallbacks. 'type' indicates insertion strategy.
  const PROVIDER_SELECTORS = {
    'chatgpt.com': {
      type: 'contenteditable',
      selectors: ['#prompt-textarea']
    },
    'claude.ai': {
      type: 'contenteditable',
      selectors: [
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"]'
      ]
    },
    'gemini.google.com': {
      type: 'contenteditable',
      selectors: [
        'div.ql-editor.textarea[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]'
      ]
    },
    'copilot.microsoft.com': {
      type: 'textarea',
      selectors: [
        'textarea#userInput',
        'textarea[data-testid="composer-input"]',
        'textarea[placeholder*="Copilot"]',
        'textarea'
      ]
    },
    'grok.com': {
      type: 'textarea',
      selectors: [
        'textarea[aria-label="Ask Grok anything"]',
        'textarea[placeholder="What\'s on your mind?"]',
        '.query-bar textarea',
        'textarea'
      ]
    },
    'poe.com': {
      type: 'textarea',
      selectors: [
        'textarea[class*="GrowingTextArea_textArea"]',
        'div[class*="ChatMessageInputContainer"] textarea',
        'textarea'
      ]
    },
    'huggingface.co': {
      type: 'textarea',
      selectors: [
        'textarea[inputmode="text"]',
        'form[aria-label="file dropzone"] textarea',
        'textarea[placeholder="Ask anything"]',
        'textarea'
      ]
    },
    'rovo-extension-web.atlassian.com': {
      type: 'contenteditable',
      selectors: [
        'div.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea'
      ]
    }
  };

  function getHostname() {
    try {
      return window.location.hostname;
    } catch {
      return '';
    }
  }

  function getProviderConfig() {
    const hostname = getHostname();
    for (const [domain, config] of Object.entries(PROVIDER_SELECTORS)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return config;
      }
    }
    return null;
  }

  function findChatInput(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        return el;
      }
    }
    return null;
  }

  // --- Insertion strategies for textarea elements (React/Svelte apps) ---

  function insertTextViaNativeSetter(textarea, text) {
    // React/Svelte override the value setter. Using the native HTMLTextAreaElement
    // prototype setter ensures the framework picks up the change.
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (!nativeSetter) {
        return false;
      }
      textarea.focus();
      nativeSetter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', {bubbles: true}));
      textarea.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    } catch {
      return false;
    }
  }

  function insertTextToTextareaFallback(textarea, text) {
    textarea.focus();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
    textarea.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  }

  function insertTextToTextarea(textarea, text) {
    if (insertTextViaNativeSetter(textarea, text)) {
      return {success: true, method: 'nativeSetter'};
    }
    insertTextToTextareaFallback(textarea, text);
    return {success: true, method: 'textareaFallback'};
  }

  // --- Insertion strategies for contenteditable elements (Quill, ProseMirror) ---

  function insertTextViaExecCommand(element, text) {
    element.focus();

    const selection = window.getSelection();
    if (selection && element.childNodes.length > 0) {
      selection.selectAllChildren(element);
      selection.collapseToEnd();
    }

    return document.execCommand('insertText', false, text);
  }

  function insertTextViaPasteEvent(element, text) {
    element.focus();

    const dt = new DataTransfer();
    dt.setData('text/plain', text);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt
    });

    return element.dispatchEvent(pasteEvent);
  }

  function insertTextViaDomManipulation(element, text) {
    element.focus();
    element.innerHTML = '';

    const p = document.createElement('p');
    p.textContent = text;
    element.appendChild(p);

    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  }

  function insertTextToContentEditable(element, text) {
    if (insertTextViaExecCommand(element, text)) {
      return {success: true, method: 'execCommand'};
    }

    if (insertTextViaPasteEvent(element, text)) {
      return {success: true, method: 'pasteEvent'};
    }

    insertTextViaDomManipulation(element, text);
    return {success: true, method: 'domManipulation'};
  }

  // --- Unified insertion dispatcher ---

  function insertText(element, text, type) {
    if (type === 'textarea' && element.tagName === 'TEXTAREA') {
      return insertTextToTextarea(element, text);
    }
    return insertTextToContentEditable(element, text);
  }

  function handlePasteRequest(text) {
    const config = getProviderConfig();
    if (!config) {
      return {success: false, error: 'Непідтримуваний провайдер: ' + getHostname()};
    }

    const input = findChatInput(config.selectors);
    if (!input) {
      return {success: false, error: 'Не знайдено поле вводу чату.'};
    }

    try {
      return insertText(input, text, config.type);
    } catch (error) {
      return {success: false, error: error?.message || 'Помилка вставки тексту.'};
    }
  }

  function isValidMessage(data) {
    return data !== null && typeof data === 'object' && typeof data.action === 'string';
  }

  window.addEventListener('message', (event) => {
    if (!EXPECTED_ORIGIN || event.origin !== EXPECTED_ORIGIN) {
      return;
    }

    if (!isValidMessage(event.data)) {
      return;
    }

    const action = event.data.action;

    if (action === GET_URL_ACTION) {
      sendResult(event.origin, {
        action: GET_URL_RESULT_ACTION,
        success: true,
        url: window.location.href
      });
      return;
    }

    if (action !== PASTE_ACTION) {
      return;
    }

    const text = typeof event.data.text === 'string' ? event.data.text : '';
    if (!text) {
      sendResult(event.origin, {success: false, error: 'Порожній текст.'});
      return;
    }

    const result = handlePasteRequest(text);
    sendResult(event.origin, result);
  });

  function sendResult(targetOrigin, result) {
    try {
      window.parent.postMessage(
        {action: PASTE_RESULT_ACTION, ...result},
        targetOrigin
      );
    } catch {
      // Cannot send result back — parent may not be accessible
    }
  }
})();
