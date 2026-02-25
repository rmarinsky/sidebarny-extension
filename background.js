'use strict';

// Background service worker for SideBarny LLM Extension

const DEBUG = false;
let hasActionClickFallback = false;

chrome.runtime.onInstalled.addListener(() => {
  debugLog('розширення встановлено або оновлено');
  void configureSidePanelBehavior();
});

// Best effort at startup in case browser skipped onInstalled hook (rare but possible after crashes).
void configureSidePanelBehavior();

async function configureSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    registerActionClickFallback();
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  } catch (error) {
    console.warn('Не вдалося налаштувати поведінку бічної панелі:', error);
    registerActionClickFallback();
  }
}

function registerActionClickFallback() {
  if (hasActionClickFallback) {
    return;
  }

  chrome.action.onClicked.addListener((tab) => {
    void openSidePanelForTab(tab?.id);
  });
  hasActionClickFallback = true;
}

async function openSidePanelForTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.sidePanel.open({tabId});
    debugLog('бічну панель відкрито', tabId);
  } catch (error) {
    console.error('Помилка відкриття бічної панелі:', error);
  }
}

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }
  console.debug('[SideBarny][background]', ...args);
}
