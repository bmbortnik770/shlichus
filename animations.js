/**
 * ═══════════════════════════════════════════════════════════
 *  animations.js — GSAP Premium Animations
 *  תלוי ב: GSAP 3.12 (נטען לפני קובץ זה)
 *  מחליף: CSS transitions רגילים
 *  רמה: Production-grade, כמו Stripe / Apple
 * ═══════════════════════════════════════════════════════════
 */

(function() {
'use strict';

// ── המתן ל-DOM מוכן ──
function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
}

ready(function() {

    // ── 1. SLIDING PILL TABS ────────────────────────────────
    // pill element שזזה מאחורי הטאב הפעיל
    const tabsContainer = document.querySelector('.main-tabs');
    if (tabsContainer && window.gsap) {

        // צור את ה-pill
        const pill = document.createElement('div');
        pill.id = 'tab-pill';
        pill.style.cssText = `
            position: absolute;
            background: linear-gradient(135deg, #3b82f6, #4f46e5);
            box-shadow: 0 4px 16px rgba(59,130,246,.4);
            pointer-events: none;
            z-index: 0;
            border-radius: 14px;
            width: 0; height: 0;
            top: 0; left: 0;
        `;
        tabsContainer.style.position = 'relative';
        tabsContainer.insertBefore(pill, tabsContainer.firstChild);

        // הסר background מ-active tab (ה-pill עושה את זה)
        const style = document.createElement('style');
        style.textContent = `
            .main-tab { position: relative; z-index: 1; }
            .main-tab.active { background: transparent !important; color: white !important; box-shadow: none !important; }
            .main-tab:not(.active) { color: var(--text-muted); }
            #tab-pill { border-radius: 14px !important; }
        `;
        document.head.appendChild(style);

        // מקם את ה-pill על הטאב הפעיל
        function positionPill(tabEl, animate) {
            const tabRect   = tabEl.getBoundingClientRect();
            const wrapRect  = tabsContainer.getBoundingClientRect();
            const left      = tabRect.left - wrapRect.left;
            const top       = tabRect.top  - wrapRect.top;

            if (!animate) {
                gsap.set(pill, {
                    x: left, y: top,
                    width:  tabRect.width,
                    height: tabRect.height,
                });
            } else {
                gsap.to(pill, {
                    x: left, y: top,
                    width:  tabRect.width,
                    height: tabRect.height,
                    duration: .42,
                    ease: 'back.out(1.4)',
                });
            }
        }

        // אתחול על הטאב הפעיל
        const activeTab = tabsContainer.querySelector('.main-tab.active');
        if (activeTab) {
            setTimeout(() => positionPill(activeTab, false), 50);
        }

        // האזן לשינוי טאב
        tabsContainer.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                setTimeout(() => positionPill(tab, true), 0);
            });
        });

        // עדכן בשינוי גודל חלון
        window.addEventListener('resize', () => {
            const cur = tabsContainer.querySelector('.main-tab.active');
            if (cur) positionPill(cur, false);
        });
    }

    // ── 2. SIDEBAR SLIDE ────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    if (sidebar && window.gsap) {

        // entrance animation בטעינה
        gsap.from(sidebar, {
            x: 80, opacity: 0, duration: .7,
            ease: 'power3.out', delay: .2,
        });

        // override פתיחת sidebar עם GSAP
        const origToggle = window.toggleSidebar;
        window.toggleSidebarGSAP = function(show) {
            if (show) {
                sidebar.style.display = 'flex';
                gsap.fromTo(sidebar,
                    { x: 60, opacity: 0 },
                    { x: 0, opacity: 1, duration: .45, ease: 'back.out(1.2)' }
                );
            } else {
                gsap.to(sidebar, {
                    x: 60, opacity: 0, duration: .3, ease: 'power2.in',
                    onComplete: () => { sidebar.style.display = 'none'; }
                });
            }
        };
    }

    // ── 3. KPI CARDS — STAGGER ENTRANCE ────────────────────
    if (window.gsap) {
        const statCards = document.querySelectorAll('.stat-card, .kpi-box');
        if (statCards.length) {
            gsap.from(statCards, {
                y: 24, opacity: 0, scale: .96,
                duration: .5, stagger: .08,
                ease: 'back.out(1.2)', delay: .4,
            });
        }
    }

    // ── 4. TOAST ANIMATIONS ─────────────────────────────────
    // override showToast להשתמש ב-GSAP
    if (window.gsap) {
        const origShowToast = window.showToast;
        window.showToast = function(msg, type, duration) {
            // קרא ל-original
            origShowToast && origShowToast(msg, type, duration);

            // מצא את ה-toast האחרון ואנים אותו
            setTimeout(() => {
                const toasts = document.querySelectorAll('#toast-container .toast');
                const last = toasts[toasts.length - 1];
                if (last) {
                    // override animation
                    last.style.opacity = '0';
                    last.style.transform = 'translateX(-60px) scale(0.9)';
                    gsap.to(last, {
                        opacity: 1,
                        x: 0, scale: 1,
                        duration: .5,
                        ease: 'back.out(1.6)',
                    });
                }
            }, 10);
        };
    }

    // ── 5. MODAL ANIMATIONS ─────────────────────────────────
    if (window.gsap) {
        // המתן שכל ה-modals ייפתחו ואז אנים
        const observer = new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.target.querySelectorAll && m.target.querySelectorAll('.modal').forEach(modal => {
                    if (modal.style.display === 'flex') {
                        const content = modal.querySelector('.modal-content');
                        if (content && !content._gsapAnimated) {
                            content._gsapAnimated = true;
                            gsap.fromTo(content,
                                { y: 32, scale: .95, opacity: 0 },
                                { y: 0,  scale: 1,   opacity: 1,
                                  duration: .45, ease: 'back.out(1.3)' }
                            );
                            setTimeout(() => { content._gsapAnimated = false; }, 600);
                        }
                    }
                });
            });
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    // ── 6. FAMILY CARDS — hover spring ──────────────────────
    if (window.gsap) {
        // משפחה cards hover effect — spring physics
        document.addEventListener('mouseover', e => {
            const card = e.target.closest('.bldg-fam-item, .kanban-card, .stat-card');
            if (!card) return;
            gsap.to(card, {
                y: -4, scale: 1.015,
                duration: .3, ease: 'back.out(2)',
                overwrite: 'auto',
            });
        });
        document.addEventListener('mouseout', e => {
            const card = e.target.closest('.bldg-fam-item, .kanban-card, .stat-card');
            if (!card) return;
            gsap.to(card, {
                y: 0, scale: 1,
                duration: .4, ease: 'elastic.out(1, .5)',
                overwrite: 'auto',
            });
        });

        // FAB spring
        const fabs = document.querySelectorAll('.fab-add, #desktopFab');
        fabs.forEach(fab => {
            fab.addEventListener('mouseover', () => {
                gsap.to(fab, { scale: 1.15, rotation: 15, duration: .3, ease: 'back.out(2)' });
            });
            fab.addEventListener('mouseout', () => {
                gsap.to(fab, { scale: 1, rotation: 0, duration: .5, ease: 'elastic.out(1, .4)' });
            });
            fab.addEventListener('mousedown', () => {
                gsap.to(fab, { scale: .9, duration: .1 });
            });
            fab.addEventListener('mouseup', () => {
                gsap.to(fab, { scale: 1.12, duration: .3, ease: 'back.out(2)' });
            });
        });
    }

    // ── 7. BUTTON CLICK RIPPLE ──────────────────────────────
    if (window.gsap) {
        document.addEventListener('click', e => {
            const btn = e.target.closest('.btn, .btn-icon, .main-tab');
            if (!btn) return;

            // Spring click feedback
            gsap.timeline()
                .to(btn, { scale: .94, duration: .08, ease: 'power2.in' })
                .to(btn, { scale: 1,   duration: .4,  ease: 'elastic.out(1.2, .5)' });
        });
    }

    // ── 8+10. VIEW TRANSITIONS + PILL UPDATE (משולב) ────────
    if (window.gsap) {
        const _origSwitch = window.switchMainView;
        window.switchMainView = function(viewName) {
            // 1. קרא ל-original
            _origSwitch && _origSwitch(viewName);

            // 2. fade in תוכן חדש
            setTimeout(() => {
                const containers = document.querySelectorAll(
                    '#map-container, #list-container, #kanban-container, #comm-container, #tasks-container, #events-container'
                );
                const newVisible = [...containers].filter(c => {
                    const d = c.style.display;
                    return d && d !== 'none';
                });
                if (newVisible.length) {
                    gsap.fromTo(newVisible,
                        { opacity: 0, y: 10 },
                        { opacity: 1, y: 0, duration: .3, ease: 'power2.out' }
                    );
                }

                // 3. עדכן pill
                const tabsEl = document.querySelector('.main-tabs');
                const pillEl = document.getElementById('tab-pill');
                if (!tabsEl || !pillEl) return;
                const active = tabsEl.querySelector('.main-tab.active');
                if (!active) return;
                const tabRect  = active.getBoundingClientRect();
                const wrapRect = tabsEl.getBoundingClientRect();
                gsap.to(pillEl, {
                    x: tabRect.left - wrapRect.left,
                    y: tabRect.top  - wrapRect.top,
                    width: tabRect.width,
                    height: tabRect.height,
                    duration: .38, ease: 'back.out(1.4)',
                });
            }, 20);
        };
    }

    // ── 9. SEARCH RESULTS — stagger ─────────────────────────
    if (window.gsap) {
        const searchDD = document.getElementById('searchDropdown');
        if (searchDD) {
            const ddObserver = new MutationObserver(() => {
                if (searchDD.style.display === 'block') {
                    const items = searchDD.querySelectorAll('.search-item');
                    gsap.from(items, {
                        opacity: 0, y: -8, duration: .25,
                        stagger: .04, ease: 'power2.out',
                    });
                }
            });
            ddObserver.observe(searchDD, { attributes: true, attributeFilter: ['style'] });
        }
    }



    console.log('✅ animations.js loaded — GSAP premium animations active');
});

})();

// ── 11. KPI NUMBER COUNTER ANIMATION ────────────────────
if (window.gsap) {
    // Override refresh/update functions לאנים את המספרים
    function animateCounter(el, targetVal) {
        if (!el || !window.gsap) return;
        const num = parseInt(String(targetVal).replace(/[^0-9]/g, '')) || 0;
        gsap.fromTo({ val: 0 },
            { val: 0 },
            {
                val: num, duration: 1.2, ease: 'power2.out',
                onUpdate: function() {
                    el.textContent = Math.round(this.targets()[0].val);
                }
            }
        );
    }

    // פעם ב-3 שניות בדוק אם KPI השתנה
    let _lastTotal = null, _lastUrgent = null;
    setInterval(() => {
        const totalEl  = document.getElementById('kpiTotal');
        const urgentEl = document.getElementById('kpiUrgent');
        if (!totalEl || !urgentEl) return;

        const t = parseInt(totalEl.textContent) || 0;
        const u = parseInt(urgentEl.textContent) || 0;

        if (_lastTotal !== null && t !== _lastTotal) animateCounter(totalEl, t);
        if (_lastUrgent !== null && u !== _lastUrgent) animateCounter(urgentEl, u);

        _lastTotal  = t;
        _lastUrgent = u;
    }, 3000);

    // counter בטעינה ראשונה
    setTimeout(() => {
        const totalEl  = document.getElementById('kpiTotal');
        const urgentEl = document.getElementById('kpiUrgent');
        if (totalEl  && totalEl.textContent  !== '0') animateCounter(totalEl,  totalEl.textContent);
        if (urgentEl && urgentEl.textContent !== '0') animateCounter(urgentEl, urgentEl.textContent);
    }, 1200);
}

// ── 12. SEARCH CLEAR BUTTON ──────────────────────────────
ready(function() {
    const search = document.getElementById('smartSearch');
    const clearBtn = document.getElementById('searchClearBtn');
    if (search && clearBtn) {
        search.addEventListener('input', () => {
            clearBtn.style.display = search.value ? 'flex' : 'none';
        });
    }
});

// ── 13. PROGRESS BAR ANIMATED ENTRANCE ──────────────────
if (window.gsap) {
    const goalBarObserver = new MutationObserver(() => {
        const bar = document.getElementById('goalProgressBar');
        if (bar && bar.style.width && bar.style.width !== '0%') {
            const target = bar.style.width;
            bar.style.width = '0%';
            gsap.to(bar, {
                width: target, duration: 1.2,
                ease: 'power3.out', delay: .3,
            });
            goalBarObserver.disconnect();
        }
    });
    const barEl = document.getElementById('goalProgressBar');
    if (barEl) goalBarObserver.observe(barEl, { attributes: true, attributeFilter: ['style'] });
}
