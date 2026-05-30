'use strict';

// ── Lightweight Markdown renderer with color-swatch support ──────────────────
// Handles: YAML front matter, headings, bold/italic, inline code, fenced code
// blocks, tables, ordered/unordered lists, blockquotes, hr, paragraphs.
// Post-processes any #RRGGBB / #RGB hex codes into an inline color swatch.

function _mdEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _mdInline(text) {
  return text
    // inline code — process first so inner content isn't further parsed
    .replace(/`([^`]+)`/g, (_, c) => `<code>${_mdEscape(c)}</code>`)
    // bold + italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// Add a colored chip before every hex color, but only outside HTML tags.
function _addColorSwatches(html) {
  return html.replace(/(<[^>]+>)|#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g, (match, tag) => {
    if (tag) return tag; // preserve HTML tags unchanged
    return `<span class="color-chip" style="background:${match}" title="${match}"></span>${match}`;
  });
}

function renderMarkdown(raw) {
  if (!raw) return '';

  let frontMatterHtml = '';

  // ── YAML front matter (--- … ---) ─────────────────────────────────────────
  if (raw.startsWith('---\n') || raw.startsWith('---\r\n')) {
    const end = raw.indexOf('\n---', 4);
    if (end !== -1) {
      const yaml = raw.slice(raw.indexOf('\n') + 1, end);
      frontMatterHtml = `<details class="md-front-matter"><summary class="md-front-matter-label">Design tokens</summary><pre class="md-code-block"><code>${_mdEscape(yaml)}</code></pre></details>`;
      raw = raw.slice(end + 4).replace(/^\r?\n/, '');
    }
  }

  const lines = raw.split(/\r?\n/);
  const out = [];
  let i = 0;
  let listStack = []; // stack of { type: 'ul'|'ol', indent }

  function closeLists() {
    while (listStack.length) {
      out.push(`</${listStack.pop().type}>`);
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Fenced code block ──────────────────────────────────────────────────
    if (trimmed.startsWith('```')) {
      closeLists();
      const lang = trimmed.slice(3).trim();
      i++;
      const codeLines = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(_mdEscape(lines[i]));
        i++;
      }
      const langAttr = lang ? ` data-lang="${_mdEscape(lang)}"` : '';
      out.push(`<pre class="md-code-block"${langAttr}><code>${codeLines.join('\n')}</code></pre>`);
      i++; continue;
    }

    // ── Heading ────────────────────────────────────────────────────────────
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      closeLists();
      const lvl = hMatch[1].length;
      out.push(`<h${lvl} class="md-h${lvl}">${_mdInline(hMatch[2])}</h${lvl}>`);
      i++; continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      closeLists();
      out.push('<hr class="md-hr">');
      i++; continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    if (trimmed.startsWith('> ') || trimmed === '>') {
      closeLists();
      out.push(`<blockquote class="md-blockquote">${_mdInline(trimmed.slice(2))}</blockquote>`);
      i++; continue;
    }

    // ── Table (header row followed by separator) ───────────────────────────
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|[\s|:-]+\|/.test(lines[i + 1].trim())) {
      closeLists();
      const headers = trimmed.split('|').slice(1, -1)
        .map(h => `<th>${_mdInline(h.trim())}</th>`).join('');
      out.push(`<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>`);
      i += 2; // skip separator row
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().split('|').slice(1, -1)
          .map(c => `<td>${_mdInline(c.trim())}</td>`).join('');
        out.push(`<tr>${cells}</tr>`);
        i++;
      }
      out.push('</tbody></table>');
      continue;
    }

    // ── List items ─────────────────────────────────────────────────────────
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    const listMatch = ulMatch || olMatch;
    if (listMatch) {
      const indent = listMatch[1].length;
      const type = ulMatch ? 'ul' : 'ol';
      const content = _mdInline(listMatch[2]);

      // Pop deeper levels
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        out.push(`</${listStack.pop().type}>`);
      }
      // Open new level or switch type
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent || top.type !== type) {
        out.push(`<${type} class="md-list">`);
        listStack.push({ type, indent });
      }
      out.push(`<li>${content}</li>`);
      i++; continue;
    }

    // Any non-list line closes all lists
    closeLists();

    // ── Empty line ─────────────────────────────────────────────────────────
    if (trimmed === '') { i++; continue; }

    // ── Paragraph ─────────────────────────────────────────────────────────
    const paraLines = [_mdInline(trimmed)];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || next.startsWith('#') || next.startsWith('|') ||
          next.startsWith('```') || next.startsWith('>') ||
          /^(---+|\*\*\*+|___+)$/.test(next) ||
          /^(\s*)[-*+]\s/.test(lines[i]) || /^(\s*)\d+\.\s/.test(lines[i])) break;
      paraLines.push(_mdInline(next));
      i++;
    }
    out.push(`<p class="md-p">${paraLines.join('<br>')}</p>`);
  }

  closeLists();

  return _addColorSwatches(frontMatterHtml + out.join('\n'));
}
