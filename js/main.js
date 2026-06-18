/* ============================================================
   MAIN JS — Shared utilities
   ============================================================ */

// ── Navbar scroll effect ──
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });
}

// ── Hamburger menu ──
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
if (hamburger && navLinks) {
  hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    hamburger.classList.toggle('open');
  });
}

// ── Animate on scroll ──
const animateObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.animate-fade-up').forEach(el => animateObserver.observe(el));

// ── Show notification ──
function showNotification(message, type = 'info', duration = 3500) {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.innerHTML = `<span style="font-size:1.2rem">${icons[type]}</span><span style="flex:1;font-size:0.88rem">${message}</span>`;
  document.body.appendChild(notif);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => notif.classList.add('show'));
  });

  setTimeout(() => {
    notif.classList.remove('show');
    setTimeout(() => notif.remove(), 400);
  }, duration);
}
window.showNotification = showNotification;

// ── Toggle switches ──
document.querySelectorAll('.toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('on');
  });
});

// ── Counter animation ──
function animateCounter(el, target, duration = 1800) {
  const start = performance.now();
  const startVal = 0;
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (target - startVal) * eased);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ── Observe counters ──
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !entry.target.dataset.animated) {
      entry.target.dataset.animated = 'true';
      const target = parseInt(entry.target.dataset.target || entry.target.dataset.count);
      animateCounter(entry.target, target);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-target], [data-count]').forEach(el => counterObserver.observe(el));

// ── Tab system ──
function initTabs(containerSelector, tabSelector, contentSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const tabs = container.querySelectorAll(tabSelector);
  const contents = document.querySelectorAll(contentSelector);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.style.display = 'block';
    });
  });
}

// ── Simple chart drawer ──
function drawLineChart(canvas, data, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 400;
  const H = canvas.height = options.height || 160;
  const pad = options.pad || { top: 16, right: 16, bottom: 28, left: 40 };
  const colors = options.colors || ['#6C63FF', '#00D4FF', '#00FFB3'];
  const labels = options.labels || [];

  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (i / gridLines) * (H - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(100 - (i / gridLines) * 100) + '%', pad.left - 6, y + 4);
  }

  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  data.forEach((series, si) => {
    if (!series.length) return;
    const color = colors[si % colors.length];
    const step = chartW / (series.length - 1);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, H);
    grad.addColorStop(0, color.replace(')', ',0.2)').replace('rgb(', 'rgba('));
    grad.addColorStop(1, 'transparent');

    ctx.beginPath();
    series.forEach((v, i) => {
      const x = pad.left + i * step;
      const y = pad.top + (1 - v / 100) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = pad.left + (series.length - 1) * step;
    ctx.lineTo(lastX, H - pad.bottom);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    series.forEach((v, i) => {
      const x = pad.left + i * step;
      const y = pad.top + (1 - v / 100) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots
    series.forEach((v, i) => {
      const x = pad.left + i * step;
      const y = pad.top + (1 - v / 100) * chartH;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#080814';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  });

  // Labels
  if (labels.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '10px Inter';
    ctx.textAlign = 'center';
    const step = chartW / (labels.length - 1);
    labels.forEach((lbl, i) => {
      ctx.fillText(lbl, pad.left + i * step, H - 6);
    });
  }
}
window.drawLineChart = drawLineChart;

// ── Donut chart ──
function drawDonut(canvas, segments, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = options.size || 140;
  canvas.width = size;
  canvas.height = size;
  const cx = size / 2, cy = size / 2;
  const r = size * 0.38;
  const thickness = options.thickness || 28;

  ctx.clearRect(0, 0, size, size);

  let startAngle = -Math.PI / 2;
  segments.forEach(seg => {
    const angle = (seg.pct / 100) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + angle);
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'butt';
    ctx.stroke();
    startAngle += angle;
  });

  // Center text
  if (options.centerText) {
    ctx.fillStyle = options.centerColor || '#fff';
    ctx.font = `700 ${options.centerFontSize || 20}px Outfit`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(options.centerText, cx, cy);
  }
}
window.drawDonut = drawDonut;

// ── Responsive canvas resize observer ──
function makeCanvasResponsive(canvas, drawFn) {
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(drawFn);
  });
  ro.observe(canvas.parentElement);
  drawFn();
}
window.makeCanvasResponsive = makeCanvasResponsive;

// ── Format time ──
function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}
window.formatTime = formatTime;

// ── Debounce ──
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
window.debounce = debounce;
