# SideBarny LLM - Marketplace Description (EN)

## Short description (up to 132 characters)

Chrome side panel with multiple LLMs. Capture text/HTML, parse LinkedIn comments — without leaving the page.

## Full description

**SideBarny LLM** is a Chrome extension that opens popular AI chats in a side panel and helps you quickly work with page content.

### Features

- Works in the side panel (no constant tab switching)
- Supports 8 LLM providers in a single interface
- DevTools-style element picker with hover highlighting
- Captures visible text or HTML markup of the selected element
- **Auto-pastes captured content directly into the provider's chat input** — no Ctrl+V needed
- Extracts text from ARIA attributes for elements without visible text (buttons, icons, etc.)
- Falls back to clipboard if auto-paste is unavailable
- Opens the provider in a regular tab if iframe mode is restricted
- Adaptive theme for each provider
- Minimal permissions — extended access is requested only on first use

### LinkedIn Comments Parsing

- Smart selection: hover over any part of a comment — the entire thread (author + replies) gets highlighted
- Structured output: name, role, comment text — for each participant in the discussion
- Handles large threads without freezing

### HTML Capture

- Copy full or partial HTML without opening DevTools
- Useful for analyzing page structure, debugging, or providing context to an LLM

### Supported Providers

- OpenAI ChatGPT
- Anthropic Claude
- Google Gemini
- Atlassian Rovo
- Microsoft Copilot
- xAI Grok
- Poe
- HuggingChat

### Who is it for

- QA / Test Automation Engineers
- Developers
- Product and Support teams
- SMM and content managers who respond to comments
- Anyone who regularly transfers page context to LLMs

### Privacy and Permissions

The extension requests minimal required permissions:

- `sidePanel` — side panel
- `declarativeNetRequest` — removing iframe restrictions for providers (X-Frame-Options, CSP)
- `storage` — saving the selected provider
- `activeTab` — temporary access to the active tab

Additional permissions (`scripting`, page access) are requested only on first content capture.

User data is not sent to any external backend. Captured content is processed locally and pasted into the chat or copied to the clipboard.

Source code: https://github.com/rmarinsky/sidebarny-extension

## About the Author

**Roman Marinsky**

- QA/Test Automation Expert and macOS developer
- 12+ years in QA
- Key Expert @ Intellias QA CoE
- GitHub: [rmarinsky](https://github.com/rmarinsky)
- Website: [mnfaktr.com](https://mnfaktr.com)

## Recommended Marketplace Tags

`llm`, `chatgpt`, `claude`, `gemini`, `copilot`, `grok`, `sidebar`, `productivity`, `qa`, `automation`, `linkedin`, `comments`, `auto-paste`
