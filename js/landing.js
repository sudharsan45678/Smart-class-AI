/* ============================================================
   LANDING PAGE JS
   ============================================================ */

// ── Particle Canvas ──
(function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    let W, H;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }

    function Particle() {
        this.x = Math.random() * W;
        this.y = Math.random() * H;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = (Math.random() - 0.5) * 0.4;
        this.r = Math.random() * 1.5 + 0.5;
        this.alpha = Math.random() * 0.4 + 0.1;
        this.color = ['#6C63FF', '#00D4FF', '#9B93FF'][Math.floor(Math.random() * 3)];
    }

    function init() {
        resize();
        particles = Array.from({ length: 80 }, () => new Particle());
    }

    function connect() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    ctx.strokeStyle = `rgba(108,99,255,${0.08 * (1 - dist / 120)})`;
                    ctx.lineWidth = 0.5;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, W, H);
        connect();
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > W) p.vx *= -1;
            if (p.y < 0 || p.y > H) p.vy *= -1;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.alpha;
            ctx.fill();
            ctx.globalAlpha = 1;
        });
        requestAnimationFrame(animate);
    }

    init();
    animate();
    window.addEventListener('resize', resize);
})();

// ── Behaviour Preview Canvas ──
(function initBehaviourPreview() {
    const canvas = document.getElementById('behaviourPreviewCanvas');
    if (!canvas) return;

    // Generate random but convincing data
    function genSeries(base, variability) {
        return Array.from({ length: 12 }, (_, i) => {
            const trend = base + (i / 12) * 10 - 5;
            return Math.min(100, Math.max(20, trend + (Math.random() - 0.5) * variability));
        });
    }

    function draw() {
        if (!canvas.offsetParent) return;
        const engagement = genSeries(80, 20);
        const attention = genSeries(70, 25);
        drawLineChart(canvas, [engagement, attention], {
            height: 180,
            colors: ['#6C63FF', '#00D4FF'],
            labels: ['9:00', '9:10', '9:20', '9:30', '9:40', '9:50', '10:00', '10:10', '10:20', '10:30', '10:40', '10:50'],
            pad: { top: 12, right: 12, bottom: 24, left: 36 }
        });
    }

    makeCanvasResponsive(canvas, draw);
})();

// ── Mini chart in Hero ──
(function initMiniChart() {
    const el = document.getElementById('miniChart');
    if (!el) return;

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    el.appendChild(canvas);

    const data = [65, 72, 68, 80, 78, 85, 82, 88, 86, 90, 87, 92];
    function draw() {
        const W = canvas.width = el.offsetWidth || 300;
        const H = canvas.height = 80;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        const step = W / (data.length - 1);

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(108,99,255,0.3)');
        grad.addColorStop(1, 'transparent');

        ctx.beginPath();
        data.forEach((v, i) => {
            const x = i * step;
            const y = H - (v / 100) * H * 0.85;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo((data.length - 1) * step, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = '#6C63FF';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        data.forEach((v, i) => {
            const x = i * step;
            const y = H - (v / 100) * H * 0.85;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    draw();
    window.addEventListener('resize', draw);
})();

// ── Animated note demo ──
(function animateNoteDemo() {
    const items = document.querySelectorAll('.lnote');
    items.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-10px)';
        setTimeout(() => {
            el.style.transition = 'all 0.4s ease';
            el.style.opacity = '1';
            el.style.transform = 'translateX(0)';
        }, 800 + i * 150);
    });
})();

// ── Feature cards stagger animation ──
(function initFeatureCards() {
    const cards = document.querySelectorAll('.feature-card');
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = parseInt(entry.target.dataset.delay || 0);
                setTimeout(() => {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, delay);
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        obs.observe(card);
    });
})();

// ── Module card tilt effect ──
document.querySelectorAll('.module-card').forEach(card => {
    card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(800px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateY(-8px)`;
    });
    card.addEventListener('mouseleave', () => {
        card.style.transform = '';
    });
});

// ── Workflow steps animate in sequence ──
(function animateWorkflow() {
    const steps = document.querySelectorAll('.workflow-step');
    const connectors = document.querySelectorAll('.workflow-connector .connector-line');

    const obs = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            steps.forEach((step, i) => {
                setTimeout(() => {
                    step.style.opacity = '1';
                    step.style.transform = 'translateY(0)';
                }, i * 200);
            });
            connectors.forEach((line, i) => {
                setTimeout(() => {
                    line.style.opacity = '1';
                }, i * 200 + 100);
            });
            obs.disconnect();
        }
    }, { threshold: 0.2 });

    steps.forEach(s => {
        s.style.opacity = '0';
        s.style.transform = 'translateY(20px)';
        s.style.transition = 'all 0.5s ease';
    });
    connectors.forEach(l => {
        l.style.opacity = '0';
        l.style.transition = 'opacity 0.4s ease';
    });

    const section = document.querySelector('.workflow-section');
    if (section) obs.observe(section);
})();

// ── Live data in hero preview ──
(function animatePreviewBars() {
    function randomFluctuate(val, range) {
        return Math.min(100, Math.max(20, val + (Math.random() - 0.5) * range));
    }

    const bars = {
        engagement: { el: document.querySelector('.mini-bar-fill'), val: 87 },
        attention: { el: document.querySelectorAll('.mini-bar-fill')[1], val: 73 },
        participation: { el: document.querySelectorAll('.mini-bar-fill')[2], val: 91 }
    };

    const vals = {
        engagement: document.querySelector('.mini-card-value'),
        attention: document.querySelectorAll('.mini-card-value')[1],
        participation: document.querySelectorAll('.mini-card-value')[2]
    };

    setInterval(() => {
        Object.keys(bars).forEach(key => {
            const b = bars[key];
            if (!b.el) return;
            b.val = randomFluctuate(b.val, 6);
            b.el.style.width = b.val + '%';
            const valEl = vals[key];
            if (valEl) valEl.textContent = Math.round(b.val) + '%';
        });
    }, 2000);
})();
