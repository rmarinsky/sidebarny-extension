# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SideBarny LLM is a Chrome Extension (Manifest V3) that opens popular LLM chat interfaces in a Chrome side panel and provides tools to capture text/HTML from the active page. UI language is Ukrainian.

## Development Workflow

No build step — plain JavaScript, HTML, and CSS. To develop:

1. Load as unpacked extension at `chrome://extensions/` with Developer mode enabled
2. Edit files directly
3. Reload the extension in `chrome://extensions/` to apply changes

There are no tests, linters, or package managers configured.

## Architecture

**Message-passing pattern**: The side panel (`sidepanel.js`) communicates with content scripts (`content.js`) via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`. The background service worker (`background.js`) handles extension lifecycle only (side panel open behavior).

### Key files

- `manifest.json` — Manifest V3 config; permissions: `sidePanel`, `declarativeNetRequest`, `scripting`, `tabs`, `activeTab`, `clipboardWrite`
- `background.js` — Service worker that configures side panel to open on action click, with fallback for older Chrome versions
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css` — Side panel UI. Renders a provider selector dropdown, action buttons ("Вибрати текст" / "Вибрати HTML"), and an iframe loading the selected LLM provider
- `content.js` — Injected into the active tab on demand via `chrome.scripting.executeScript`. Handles: element picker (DevTools-style hover highlight + click to capture), text/HTML extraction, page context capture (selection/viewport/full-page modes), and OpenSearch Dashboard detection
- `opensearch-dashboard-parser.js` — Standalone parser for OpenSearch/Kibana dashboard log tables. Extracts structured log data, calculates statistics, and formats as Markdown
- `rules.json` — `declarativeNetRequest` rules that strip `X-Frame-Options` and `Content-Security-Policy` headers for LLM provider domains, enabling iframe embedding

### LLM Providers

Defined as the `PROVIDERS` array in `sidepanel.js`. Currently: ChatGPT, Claude, Gemini, Copilot, Grok, t3.chat, Poe, HuggingChat. Adding a provider requires:
1. Add entry to `PROVIDERS` in `sidepanel.js`
2. Add header-stripping rule in `rules.json` (increment rule ID)
3. Optionally add provider-specific CSS theme in `sidepanel.css` (via `[data-provider="id"]` selector)

### Content Script Guard

`content.js` uses `window.__llmSidebarContentLoaded` flag to prevent double-initialization when injected multiple times. The side panel pings the content script first; if ping fails, it injects the script dynamically.

### Clipboard Strategy

Two-tier: tries `navigator.clipboard.writeText()` first, falls back to `document.execCommand('copy')`. Implemented independently in both `content.js` (page context) and `sidepanel.js` (panel context).

## Conventions

- All user-facing strings are in Ukrainian
- Debug logging gated behind `const DEBUG = false` in each file (change to `true` to enable)
- `'use strict'` at the top of every JS file
- No frameworks or dependencies — vanilla JS only
