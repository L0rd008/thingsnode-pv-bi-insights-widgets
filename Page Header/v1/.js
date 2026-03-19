// ============================================
// Page Header — Minimal Single-Row Design
// ThingsBoard v4.3.0 PE | Static Widget
// Fully generic — all config from HTML data-*
// ============================================

self.onInit = function () {
    var $container = self.ctx.$container;
    var sc = self.ctx.stateController;
    var actionsApi = self.ctx.actionsApi;

    // ──────────────────────────────────────────
    //  CONFIG FROM HTML data-* ATTRIBUTES
    // ──────────────────────────────────────────
    var $header = $container.find('.page-header');
    var ROOT_STATE = $header.attr('data-root-state') || 'energy_prod';
    var tzLabel = $header.attr('data-tz-label') || 'UTC+05:30';
    var tzOffset = parseInt($header.attr('data-tz-offset'), 10);
    if (isNaN(tzOffset)) tzOffset = 330;

    // ──────────────────────────────────────────
    //  DOM REFERENCES
    // ──────────────────────────────────────────
    var $title = $container.find('.header-title');
    var $tabs = $container.find('.tab[data-state]');
    var $clockTime = $container.find('.clock-time');
    var $clockDate = $container.find('.clock-date');

    // ──────────────────────────────────────────
    //  CLOCK — time on top, date below
    // ──────────────────────────────────────────
    function updateClock() {
        var now = new Date();
        var utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        var local = new Date(utc + (tzOffset * 60000));

        var timeStr =
            String(local.getHours()).padStart(2, '0') + ':' +
            String(local.getMinutes()).padStart(2, '0') + ':' +
            String(local.getSeconds()).padStart(2, '0');

        var dateStr =
            local.getFullYear() + '-' +
            String(local.getMonth() + 1).padStart(2, '0') + '-' +
            String(local.getDate()).padStart(2, '0');

        if ($clockTime.length) $clockTime.text(timeStr);
        if ($clockDate.length) $clockDate.text(dateStr + ' (' + tzLabel + ')');
    }

    updateClock();
    self._clockInterval = setInterval(updateClock, 1000);

    // ──────────────────────────────────────────
    //  STATE RESOLUTION
    // ──────────────────────────────────────────
    function resolveState(raw) {
        return (!raw || raw === 'default') ? ROOT_STATE : raw;
    }

    // ──────────────────────────────────────────
    //  ACTIVE TAB — highlight it, update title
    // ──────────────────────────────────────────
    function setActive(stateId) {
        var resolved = resolveState(stateId);

        // Reset all tabs, then mark the active one
        $tabs.removeClass('active');
        var $active = $tabs.filter('[data-state="' + resolved + '"]');
        $active.addClass('active');

        // Fade title: out → swap text → in
        if ($title.length && $active.length) {
            var pageTitle = $active.attr('data-title') || $active.text();
            var newText = 'SOLAR PV PLANT MONITORING \u2014 ' + pageTitle.toUpperCase();
            $title.css('opacity', 0);
            setTimeout(function () {
                $title.text(newText);
                $title.css('opacity', 1);
            }, 150);
        }
    }

    // ──────────────────────────────────────────
    //  NAVIGATION
    //  Strategy 1: actionsApi (primary)
    //  Strategy 2: stateController (fallback)
    // ──────────────────────────────────────────
    function goToState(targetState) {

        if (actionsApi && typeof actionsApi.handleWidgetAction === 'function') {
            try {
                var descriptor = {
                    id: 'nav_' + targetState,
                    name: 'navigate',
                    icon: 'more_horiz',
                    type: 'updateDashboardState',
                    targetDashboardStateId: targetState,
                    openRightLayout: false,
                    setEntityId: false,
                    stateEntityParamName: null,
                    openInSeparateDialog: false,
                    openInPopover: false
                };
                actionsApi.handleWidgetAction({}, descriptor);
                return;
            } catch (e) {
                console.warn('[PageHeader] actionsApi failed:', e.message || e);
            }
        }

        if (sc && typeof sc.updateState === 'function') {
            try {
                var params = {};
                if (typeof sc.getStateParams === 'function') {
                    params = sc.getStateParams() || {};
                }
                sc.updateState(targetState, params, false);
                return;
            } catch (e) {
                console.warn('[PageHeader] updateState failed:', e.message || e);
            }
        }

        console.error('[PageHeader] No navigation method for "' + targetState + '"');
    }

    // ──────────────────────────────────────────
    //  CLICK HANDLERS
    // ──────────────────────────────────────────
    $tabs.on('click', function () {
        var target = $(this).attr('data-state');
        if (!target) return;

        // Brief cyan flash for click feedback
        var $clicked = $(this);
        $clicked.addClass('clicked');
        setTimeout(function () { $clicked.removeClass('clicked'); }, 150);

        setActive(target);
        goToState(target);
    });

    // ──────────────────────────────────────────
    //  INITIAL ACTIVE STATE
    // ──────────────────────────────────────────
    try {
        setActive(sc ? sc.getStateId() : ROOT_STATE);
    } catch (e) {
        setActive(ROOT_STATE);
    }

    // ──────────────────────────────────────────
    //  SCALING — single row measurement
    // ──────────────────────────────────────────
    function updateScale() {
        var w = $container.width();
        var h = $container.height();
        if (!w || !h) return;

        var PROBE = 16;
        $header.css('font-size', PROBE + 'px');

        // Measure total content width at probe size
        var titleW = $title.length ? $title[0].scrollWidth : 0;
        var $tabsWrap = $container.find('.header-tabs');
        var tabsW = $tabsWrap.length ? $tabsWrap[0].scrollWidth : 0;
        var $sep = $container.find('.header-sep');
        var sepW = $sep.length ? $sep.outerWidth(true) : 0;
        var $clock = $container.find('.header-clock');
        var clockW = $clock.length ? $clock[0].scrollWidth : 0;
        var padX = 0.8 * PROBE * 2;
        var contentW = titleW + tabsW + sepW + clockW + padX;

        var fromWidth = (w / contentW) * PROBE;

        // Height: single row ~1.6em with padding
        var fromHeight = h / 1.7;

        var fontSize = Math.min(fromWidth, fromHeight);
        if (fontSize < 6) fontSize = 6;
        if (fontSize > 30) fontSize = 30;

        $header.css('font-size', fontSize + 'px');
    }

    updateScale();

    // ──────────────────────────────────────────
    //  POLL FOR EXTERNAL STATE CHANGES
    // ──────────────────────────────────────────
    self._statePoll = setInterval(function () {
        if (!sc) return;
        try {
            var cur = resolveState(sc.getStateId());
            var $act = $tabs.filter('.active');
            if (!$act.length || $act.attr('data-state') !== cur) {
                setActive(cur);
            }
        } catch (e) { /* ignore */ }
    }, 300);

    // ──────────────────────────────────────────
    //  RESIZE
    // ──────────────────────────────────────────
    self.onResize = function () {
        updateScale();
    };

    // ──────────────────────────────────────────
    //  CLEANUP
    // ──────────────────────────────────────────
    self.onDestroy = function () {
        if (self._clockInterval) {
            clearInterval(self._clockInterval);
            self._clockInterval = null;
        }
        if (self._statePoll) {
            clearInterval(self._statePoll);
            self._statePoll = null;
        }
        $tabs.off('click');
    };
};
