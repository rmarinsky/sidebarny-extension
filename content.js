'use strict';

// Content script for context capture and page parsing

if (!window.__llmSidebarContentLoaded) {
  window.__llmSidebarContentLoaded = true;

  const DEBUG = false;
  const PICKER_CANCEL_ERROR = 'Вибір елемента скасовано.';
  const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS', 'NAV', 'FOOTER', 'HEADER', 'ASIDE']);

  const PICKER_OVERLAY_ID = '__llm_sidebar_picker_overlay';
  const PICKER_HELP_ID = '__llm_sidebar_picker_help';
  const MAX_CONTEXT_LENGTH = 50000;
  const MAX_HTML_LENGTH = 120000;

  let activePicker = null;

  debugLog('content script завантажено');

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const action = request?.action;

    if (action === 'ping') {
      sendResponse({success: true});
      return false;
    }

    if (action === 'captureContext') {
      try {
        sendResponse(captureContext(request.mode));
      } catch (error) {
        sendResponse({success: false, error: error?.message || 'Помилка захоплення контексту.'});
      }
      return false;
    }

    if (action === 'startElementPicker') {
      startElementPicker(request?.outputType || 'text')
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({success: false, error: error?.message || 'Помилка вибору елемента.'}));
      return true;
    }

    if (action === 'cancelElementPicker') {
      sendResponse(cancelElementPicker());
      return false;
    }

    if (action === 'parsePage') {
      try {
        sendResponse(handleParsePageRequest());
      } catch (error) {
        sendResponse({success: false, error: error?.message || 'Помилка парсингу сторінки.'});
      }
      return false;
    }

    return false;
  });

  function debugLog(...args) {
    if (!DEBUG) {
      return;
    }
    console.debug('[SideBarny][content]', ...args);
  }

  function captureContext(mode) {
    switch (mode) {
      case 'selection': {
        const selectedText = normalizeWhitespace(window.getSelection()?.toString() || '');
        if (!selectedText) {
          return {
            success: false,
            error: 'Немає виділеного тексту. Виділи текст на сторінці або використовуй режим вибору елемента.'
          };
        }
        return {success: true, context: buildContextPayload('selection', selectedText)};
      }
      case 'viewport': {
        const viewportText = collectText({viewportOnly: true, maxLength: MAX_CONTEXT_LENGTH});
        if (!viewportText) {
          return {success: false, error: 'У видимій області немає читабельного тексту.'};
        }
        return {success: true, context: buildContextPayload('viewport', viewportText)};
      }
      case 'full-page': {
        const fullPageText = collectText({viewportOnly: false, maxLength: MAX_CONTEXT_LENGTH});
        if (!fullPageText) {
          return {success: false, error: 'На сторінці немає читабельного тексту.'};
        }
        return {success: true, context: buildContextPayload('full-page', fullPageText)};
      }
      default:
        return {success: false, error: `Непідтримуваний режим захоплення: ${mode || 'невідомо'}`};
    }
  }

  function startElementPicker(outputType) {
    if (activePicker) {
      return Promise.resolve({success: false, error: 'Режим вибору елемента вже активний.'});
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = PICKER_OVERLAY_ID;
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '0';
      overlay.style.height = '0';
      overlay.style.background = 'rgba(14, 116, 255, 0.18)';
      overlay.style.border = '2px solid #0e74ff';
      overlay.style.boxSizing = 'border-box';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '2147483646';
      overlay.style.display = 'none';

      const help = document.createElement('div');
      help.id = PICKER_HELP_ID;
      help.textContent = 'Наведи на елемент';
      help.style.position = 'fixed';
      help.style.top = '10px';
      help.style.left = '50%';
      help.style.transform = 'translateX(-50%)';
      help.style.padding = '4px 10px';
      help.style.borderRadius = '999px';
      help.style.background = 'rgba(15, 23, 42, 0.88)';
      help.style.color = '#f8fafc';
      help.style.fontFamily = 'system-ui, sans-serif';
      help.style.fontSize = '12px';
      help.style.fontWeight = '600';
      help.style.lineHeight = '16px';
      help.style.pointerEvents = 'none';
      help.style.zIndex = '2147483647';

      document.documentElement.appendChild(overlay);
      document.documentElement.appendChild(help);

      const previousCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = 'crosshair';

      let hoveredElement = null;

      const cleanup = () => {
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', onWindowBlur, true);
        overlay.remove();
        help.remove();
        document.documentElement.style.cursor = previousCursor;
      };

      const finish = (result) => {
        if (!activePicker) {
          return;
        }
        const picker = activePicker;
        activePicker = null;
        picker.cleanup();
        picker.resolve(result);
      };

      const onMouseMove = (event) => {
        const target = getTargetElement(event.clientX, event.clientY);
        if (!target) {
          overlay.style.display = 'none';
          hoveredElement = null;
          return;
        }

        hoveredElement = target;
        renderHighlight(target, overlay);
      };

      const onClick = (event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const target = getTargetElement(event.clientX, event.clientY) || hoveredElement;
        if (!target) {
          finish({success: false, error: 'Не вдалося визначити елемент, по якому клікнули.'});
          return;
        }

        const context = buildElementContext(target);
        const pickedValue = outputType === 'html' ? context.html : context.text;

        copyPickedValue(pickedValue)
          .then((copyResult) => {
            finish({
              success: true,
              payload: buildPickerPayload(context, outputType, copyResult)
            });
          })
          .catch((error) => {
            finish({
              success: true,
              payload: buildPickerPayload(context, outputType, {
                success: false,
                method: null,
                error: error?.message || 'Помилка запису в буфер обміну.'
              })
            });
          });
      };

      const onKeyDown = (event) => {
        if (event.key !== 'Escape') {
          return;
        }
        event.preventDefault();
        finish({success: false, cancelled: true, error: PICKER_CANCEL_ERROR});
      };

      const onWindowBlur = () => {
        finish({success: false, cancelled: true, error: PICKER_CANCEL_ERROR});
      };

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', onWindowBlur, true);

      activePicker = {resolve, cleanup};
    });
  }

  function cancelElementPicker() {
    if (!activePicker) {
      return {success: true, cancelled: false};
    }

    const picker = activePicker;
    activePicker = null;
    picker.cleanup();
    picker.resolve({success: false, cancelled: true, error: PICKER_CANCEL_ERROR});
    return {success: true, cancelled: true};
  }

  function buildPickerPayload(context, outputType, copyResult) {
    const key = outputType === 'html' ? 'html' : 'text';

    return {
      [key]: context[key],
      copied: Boolean(copyResult?.success),
      copyMethod: copyResult?.method || null,
      copyError: copyResult?.error || null
    };
  }

  function getTargetElement(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) {
      return null;
    }
    if (target.id === PICKER_OVERLAY_ID || target.id === PICKER_HELP_ID) {
      return null;
    }
    if (target === document.documentElement) {
      return document.body;
    }
    return target;
  }

  function renderHighlight(element, overlay) {
    const rect = element.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'block';
    overlay.style.top = `${Math.max(rect.top, 0)}px`;
    overlay.style.left = `${Math.max(rect.left, 0)}px`;
    overlay.style.width = `${Math.max(rect.width, 1)}px`;
    overlay.style.height = `${Math.max(rect.height, 1)}px`;
  }

  function extractAriaText(element) {
    const parts = [];
    const seen = new Set();

    function addUnique(value) {
      const trimmed = (value || '').trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        parts.push(trimmed);
      }
    }

    addUnique(element.getAttribute('aria-label'));

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const el = document.getElementById(id);
        if (el) {
          addUnique(el.textContent);
        }
      }
    }

    const describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
      for (const id of describedBy.split(/\s+/)) {
        const el = document.getElementById(id);
        if (el) {
          addUnique(el.textContent);
        }
      }
    }

    addUnique(element.getAttribute('aria-valuetext'));
    addUnique(element.getAttribute('aria-placeholder'));
    addUnique(element.getAttribute('title'));
    addUnique(element.getAttribute('alt'));

    return parts.join(' ');
  }

  function buildElementContext(element) {
    let text = formatRenderedText(element.innerText || element.textContent || '').slice(0, MAX_CONTEXT_LENGTH);

    if (!text.trim()) {
      text = extractAriaText(element).slice(0, MAX_CONTEXT_LENGTH);
    }

    const html = trimToLimit(element.outerHTML || '', MAX_HTML_LENGTH);

    return {
      mode: 'element',
      title: document.title,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      selector: buildCssSelector(element),
      tagName: element.tagName.toLowerCase(),
      text,
      html
    };
  }

  async function copyPickedValue(value) {
    const normalizedValue = `${value || ''}`;
    if (!normalizedValue) {
      return {success: false, method: null, error: 'Немає контенту для копіювання.'};
    }

    try {
      await navigator.clipboard.writeText(normalizedValue);
      return {success: true, method: 'navigator.clipboard'};
    } catch (clipboardError) {
      const fallbackSuccess = copyWithExecCommand(normalizedValue);
      if (fallbackSuccess) {
        return {success: true, method: 'execCommand'};
      }

      return {
        success: false,
        method: null,
        error: clipboardError?.message || 'Clipboard API заблоковано.'
      };
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

  function buildCssSelector(element) {
    if (element === document.body) {
      return 'body';
    }

    if (element.id) {
      return `#${escapeForSelector(element.id)}`;
    }

    const path = [];
    let current = element;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && depth < 6) {
      let part = current.tagName.toLowerCase();

      const classTokens = typeof current.className === 'string' ? current.className.trim().split(/\s+/) : [];
      const meaningfulClasses = classTokens.filter(Boolean).slice(0, 2).map((name) => `.${escapeForSelector(name)}`);
      if (meaningfulClasses.length) {
        part += meaningfulClasses.join('');
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (sibling) => sibling.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      path.unshift(part);
      current = parent;
      depth += 1;
    }

    return path.join(' > ') || element.tagName.toLowerCase();
  }

  function escapeForSelector(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function buildContextPayload(mode, text) {
    return {
      mode,
      title: document.title,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      text
    };
  }

  function collectText({viewportOnly, maxLength}) {
    if (!document.body) {
      return '';
    }

    const collected = [];
    let totalLength = 0;
    const visibilityCache = new WeakMap();

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          if (isBlockedTag(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!isElementVisible(parent, visibilityCache)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (viewportOnly && !isTextNodeInViewport(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node = walker.nextNode();
    while (node) {
      const cleaned = normalizeWhitespace(node.nodeValue || '');
      if (cleaned) {
        const nextLength = totalLength + cleaned.length + 1;
        if (nextLength > maxLength) {
          const remaining = Math.max(maxLength - totalLength, 0);
          if (remaining > 0) {
            collected.push(cleaned.slice(0, remaining));
          }
          break;
        }
        collected.push(cleaned);
        totalLength = nextLength;
      }
      node = walker.nextNode();
    }

    return collected.join(' ');
  }

  function isElementVisible(element, visibilityCache) {
    if (visibilityCache.has(element)) {
      return visibilityCache.get(element);
    }

    const style = window.getComputedStyle(element);
    const isVisible = style.display !== 'none' && style.visibility !== 'hidden';
    visibilityCache.set(element, isVisible);
    return isVisible;
  }

  function isTextNodeInViewport(textNode) {
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    range.detach?.();

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return false;
    }

    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth
    );
  }

  function isBlockedTag(tagName) {
    return BLOCKED_TAGS.has(tagName);
  }

  function trimToLimit(value, maxLength) {
    const normalized = `${value || ''}`;
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 13)}...[trimmed]`;
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  function formatRenderedText(value) {
    if (!value) {
      return '';
    }

    return value
      .replace(/\u00A0/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function handleParsePageRequest() {
    if (typeof detectOpenSearchDashboardPage === 'function' && detectOpenSearchDashboardPage()) {
      const pageContent = parseOpenSearchDashboard();
      return {success: true, content: pageContent, type: 'opensearch-dashboard'};
    }

    const pageContent = parsePageContent();
    return {success: true, content: pageContent, type: 'general'};
  }

  function parsePageContent() {
    const title = document.title;
    const url = window.location.href;
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((heading) => ({
        level: heading.tagName.toLowerCase(),
        text: heading.textContent.trim()
      }))
      .filter((heading) => heading.text.length > 0);

    const textContent = collectText({viewportOnly: false, maxLength: MAX_CONTEXT_LENGTH});

    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((link) => ({
        text: link.textContent.trim(),
        href: link.href
      }))
      .filter((link) => link.text.length > 0)
      .slice(0, 20);

    const images = Array.from(document.querySelectorAll('img[alt]'))
      .map((image) => ({
        alt: image.alt,
        src: image.src
      }))
      .filter((image) => image.alt.length > 0)
      .slice(0, 10);

    return {
      title,
      url,
      metaDescription,
      headings,
      textContent,
      links,
      images,
      timestamp: new Date().toISOString()
    };
  }
}
