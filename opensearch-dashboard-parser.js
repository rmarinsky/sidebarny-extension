'use strict';

// OpenSearch Dashboard Parser
// Parses OpenSearch Dashboard log pages and extracts log data

const DEBUG = false;

function debugLog(...args) {
  if (!DEBUG) {
    return;
  }
  console.debug('[SideBarny][opensearch]', ...args);
}

/**
 * Detect if current page is an OpenSearch Dashboard page
 * @returns {boolean} - True if OpenSearch Dashboard page
 */
function detectOpenSearchDashboardPage() {
  const url = window.location.href;

  // Check URL pattern for OpenSearch Dashboard
  const opensearchPatterns = [
    /opensearch/i,
    /kibana/i, // OpenSearch Dashboard is based on Kibana
    /_dashboards/i
  ];

  const matchesUrl = opensearchPatterns.some(pattern => pattern.test(url));

  if (matchesUrl) {
    // Verify by checking for OpenSearch/Kibana-specific elements
    const opensearchSelectors = [
      'table[data-test-subj="docTable"]',
      '[data-test-subj="osdDocTableCellDataField"]',
      'kbn-management-app',
      'osd-management-app'
    ];

    const hasOpenSearchElements = opensearchSelectors.some(selector =>
      document.querySelector(selector) !== null
    );

    return hasOpenSearchElements;
  }

  return false;
}

/**
 * Parse OpenSearch Dashboard log table
 * @returns {Object} - Parsed log data with structured information
 */
function parseOpenSearchDashboard() {
  debugLog('Парсинг сторінки OpenSearch Dashboard...');

  try {
    // Get all the data rows from the table body
    const rows = document.querySelectorAll('table[data-test-subj="docTable"] tbody tr');

    if (rows.length === 0) {
      debugLog('У таблиці не знайдено логів');
      return {
        url: window.location.href,
        timestamp: new Date().toISOString(),
        logData: [],
        error: 'У таблиці не знайдено рядків логів'
      };
    }

    // Create an array to hold the extracted data
    const logData = [];

    // Loop through each row
    rows.forEach((row, index) => {
      try {
        // Select the data span within each cell (td) by its column position

        // Column 2: Time
        const timeEl = row.querySelector('td:nth-child(2) [data-test-subj="osdDocTableCellDataField"] span');
        const time = timeEl ? timeEl.textContent.trim() : null;

        // Column 3: payload.level
        const payloadLevelEl = row.querySelector('td:nth-child(3) [data-test-subj="osdDocTableCellDataField"] span');
        const payloadLevel = payloadLevelEl ? payloadLevelEl.textContent.trim() : null;

        // Column 4: message
        const messageEl = row.querySelector('td:nth-child(4) [data-test-subj="osdDocTableCellDataField"] span');
        const message = messageEl ? messageEl.textContent.trim() : null;

        // Column 5: payload.message
        const payloadMessageEl = row.querySelector('td:nth-child(5) [data-test-subj="osdDocTableCellDataField"] span');
        const payloadMessage = payloadMessageEl ? payloadMessageEl.textContent.trim() : null;

        // Only add if at least one field has data
        if (time || payloadLevel || message || payloadMessage) {
          logData.push({
            rowIndex: index + 1,
            time,
            payloadLevel,
            message,
            payloadMessage
          });
        }
      } catch (rowError) {
        console.error(`Помилка парсингу рядка ${index + 1}:`, rowError);
      }
    });

    // Get additional context from the page
    const pageTitle = document.title;
    const url = window.location.href;

    // Extract filter/query information if available
    const queryBar = document.querySelector('[data-test-subj="queryInput"]');
    const currentQuery = queryBar ? queryBar.value || queryBar.textContent.trim() : null;

    // Extract time range if available
    const timeRangeDisplay = document.querySelector('[data-test-subj="superDatePickerShowDatesButton"]');
    const timeRange = timeRangeDisplay ? timeRangeDisplay.textContent.trim() : null;

    // Calculate log statistics
    const statistics = calculateLogStatistics(logData);

    const result = {
      url,
      pageTitle,
      timestamp: new Date().toISOString(),
      currentQuery,
      timeRange,
      totalRows: logData.length,
      logData,
      statistics
    };

    debugLog('OpenSearch Dashboard успішно розібрано:', result);
    return result;

  } catch (error) {
    console.error('Помилка парсингу OpenSearch Dashboard:', error);
    return {
      error: error?.message || 'Помилка парсингу OpenSearch.',
      url: window.location.href,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Calculate statistics about the log data
 * @param {Array} logData - Array of log entries
 * @returns {Object} - Statistics about the logs
 */
function calculateLogStatistics(logData) {
  const stats = {
    totalLogs: logData.length,
    levelBreakdown: {},
    timeRange: {
      earliest: null,
      latest: null
    },
    hasErrors: false,
    hasWarnings: false
  };

  // Count logs by level
  logData.forEach((log) => {
    if (log.payloadLevel) {
      const level = log.payloadLevel.toLowerCase();
      stats.levelBreakdown[level] = (stats.levelBreakdown[level] || 0) + 1;

      // Check for errors and warnings
      if (level.includes('error') || level.includes('fatal')) {
        stats.hasErrors = true;
      }
      if (level.includes('warn')) {
        stats.hasWarnings = true;
      }
    }

    // Track time range (simplified - would need proper date parsing)
    if (log.time) {
      if (!stats.timeRange.earliest || log.time < stats.timeRange.earliest) {
        stats.timeRange.earliest = log.time;
      }
      if (!stats.timeRange.latest || log.time > stats.timeRange.latest) {
        stats.timeRange.latest = log.time;
      }
    }
  });

  return stats;
}

/**
 * Format parsed OpenSearch data as Markdown
 * @param {Object} data - Parsed OpenSearch dashboard data
 * @returns {string} - Formatted Markdown string
 */
function formatOpenSearchAsMarkdown(data) {
  if (data.error) {
    return `# Помилка парсингу OpenSearch Dashboard\n\nПомилка: ${data.error}\nURL: ${data.url}`;
  }

  let markdown = '';

  // Header
  markdown += `## Логи OpenSearch Dashboard\n\n`;
  markdown += `**URL:** ${data.url}\n`;
  if (data.pageTitle) markdown += `**Заголовок сторінки:** ${data.pageTitle}\n`;
  markdown += `**Час парсингу:** ${data.timestamp}\n\n`;

  // Query and Time Range
  if (data.currentQuery || data.timeRange) {
    markdown += `### Інформація про запит\n\n`;
    if (data.currentQuery) markdown += `**Запит:** \`${data.currentQuery}\`\n`;
    if (data.timeRange) markdown += `**Проміжок часу:** ${data.timeRange}\n`;
    markdown += `\n`;
  }

  // Statistics
  if (data.statistics) {
    markdown += `### Статистика логів\n\n`;
    markdown += `**Усього логів:** ${data.statistics.totalLogs}\n`;

    if (Object.keys(data.statistics.levelBreakdown).length > 0) {
      markdown += `**Розподіл за рівнями:**\n`;
      Object.entries(data.statistics.levelBreakdown).forEach(([level, count]) => {
        markdown += `  - ${level}: ${count}\n`;
      });
    }

    if (data.statistics.hasErrors) markdown += `\n⚠️ **Містить помилки**\n`;
    if (data.statistics.hasWarnings) markdown += `⚠️ **Містить попередження**\n`;
    markdown += `\n`;
  }

  // Log Entries
  markdown += `### Записи логів (усього: ${data.totalRows})\n\n`;

  if (data.logData && data.logData.length > 0) {
    // Show first 20 logs to avoid overwhelming output
    const displayCount = Math.min(data.logData.length, 20);
    markdown += `Показано перші ${displayCount} з ${data.logData.length} логів:\n\n`;

    data.logData.slice(0, displayCount).forEach((log, index) => {
      markdown += `#### Запис логу ${log.rowIndex}\n\n`;
      if (log.time) markdown += `**Час:** ${log.time}\n`;
      if (log.payloadLevel) markdown += `**Рівень:** ${log.payloadLevel}\n`;
      if (log.message) markdown += `**Повідомлення:** ${log.message}\n`;
      if (log.payloadMessage) markdown += `**Payload-повідомлення:** ${log.payloadMessage}\n`;
      markdown += `\n---\n\n`;
    });

    if (data.logData.length > displayCount) {
      markdown += `\n*... і ще ${data.logData.length - displayCount} записів*\n\n`;
    }
  } else {
    markdown += `Записів логів не знайдено.\n\n`;
  }

  return markdown;
}

debugLog('Парсер OpenSearch Dashboard завантажено');
