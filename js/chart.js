/*
 * chart.js - a simple, dependency-free SVG bar chart of pages over time.
 *
 * Design notes:
 *  - One series, so one colour (teal) and no legend; the heading names it.
 *  - Thin bars with rounded tops anchored to the baseline, a small gap
 *    between bars, and faint gridlines so the data stands out.
 *  - Every bar has a full-height invisible hit area, so tapping anywhere in
 *    its column shows a tooltip with the exact number.
 *  - A plain table of the same numbers is provided for accessibility.
 */

import { formatDate } from './calc.js';

const W = 340; // viewBox width
const H = 190; // viewBox height
const PAD = { top: 12, right: 6, bottom: 24, left: 34 };

/** Escape text for safe use inside HTML/SVG. */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Choose a tidy top value and step for the y axis (1, 2, 5 × 10^n). */
function niceScale(max) {
  if (max <= 0) return { top: 10, step: 5 };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough)); // whole pages only
  return { top: Math.ceil(max / step) * step, step };
}

/** Path for a bar with rounded top corners and a square base. */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Build the chart's HTML.
 * @param {{date:string, pages:number}[]} series  oldest first
 * @param {'days'|'weeks'} mode
 */
export function chartHTML(series, mode) {
  const max = Math.max(0, ...series.map((d) => d.pages));
  const { top, step } = niceScale(max);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / series.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(16, band - gap)); // keep bars slim
  const inset = (band - barW) / 2; // centre each bar in its column
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const label = (d) => (mode === 'weeks' ? `Week of ${formatDate(d.date)}` : formatDate(d.date, { weekday: true }));

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Bar chart of pages read per ${mode === 'weeks' ? 'week' : 'day'}">`;

  // Gridlines and y-axis labels.
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'chart-base' : 'chart-grid'}"/>`;
    svg += `<text x="${PAD.left - 6}" y="${y(v)}" class="chart-axis" text-anchor="end" dominant-baseline="middle">${v}</text>`;
  }

  // X-axis labels: a handful, evenly spaced, always including the last.
  const every = mode === 'weeks' ? 3 : 7;
  series.forEach((d, i) => {
    if ((series.length - 1 - i) % every !== 0) return;
    const cx = PAD.left + band * i + band / 2;
    const text = mode === 'weeks' ? formatDate(d.date) : formatDate(d.date);
    svg += `<text x="${cx}" y="${H - 6}" class="chart-axis" text-anchor="middle">${esc(text)}</text>`;
  });

  // Bars, each with a full-height hit area carrying its tooltip text.
  series.forEach((d, i) => {
    const x = PAD.left + band * i + inset;
    const tip = `${label(d)}: ${d.pages.toLocaleString('en-GB')} ${d.pages === 1 ? 'page' : 'pages'}`;
    svg += `<g class="chart-col" data-tip="${esc(tip)}" data-x="${x + barW / 2}">`;
    svg += `<rect x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${plotH}" class="chart-hit"/>`;
    if (d.pages > 0) {
      const h = Math.max(1.5, PAD.top + plotH - y(d.pages));
      svg += `<path d="${barPath(x, PAD.top + plotH - h, barW, h, 4)}" class="chart-bar"/>`;
    }
    svg += '</g>';
  });
  svg += '</svg>';

  // The accessible table view.
  const rows = series
    .slice()
    .reverse()
    .map((d) => `<tr><td>${esc(label(d))}</td><td>${d.pages.toLocaleString('en-GB')}</td></tr>`)
    .join('');

  return `
    <div class="chart-wrap">
      ${svg}
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table">
      <summary>Show as a table</summary>
      <table><thead><tr><th>${mode === 'weeks' ? 'Week' : 'Day'}</th><th>Pages</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

/**
 * Wire up hover/tap tooltips for a chart already in the page.
 * Call once per render with the chart's container element.
 */
export function attachChartTooltips(container) {
  const wrap = container.querySelector('.chart-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.chart-tip');
  const svg = wrap.querySelector('svg');
  let active = null;

  const show = (col) => {
    if (active) active.classList.remove('active');
    active = col;
    col.classList.add('active');
    tip.textContent = col.dataset.tip;
    tip.hidden = false;
    // Convert the bar's SVG x position to on-screen pixels.
    const scale = svg.clientWidth / W;
    const px = Number(col.dataset.x) * scale;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(px, half), wrap.clientWidth - half)}px`;
  };
  const hide = () => {
    if (active) active.classList.remove('active');
    active = null;
    tip.hidden = true;
  };

  svg.addEventListener('pointerover', (e) => {
    const col = e.target.closest('.chart-col');
    if (col) show(col);
  });
  svg.addEventListener('pointerdown', (e) => {
    const col = e.target.closest('.chart-col');
    if (col) show(col);
  });
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
}
