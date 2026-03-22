// ============================================
// Page Header — Minimal Single-Row Design
// ThingsBoard v4.3.0 PE | Static Widget
// Adapted for root-state + <tb-dashboard-state> architecture
//
// KEY CHANGE from GP Dashboard version:
//   Instead of navigating to a new state (which leaves root),
//   this saves a "dashboardMode" server attribute (1-6) on
//   the currently selected entity. The State Loader widget
//   reads this attribute and renders the correct sub-state
//   via <tb-dashboard-state>.
//
// Settings Form fields:
//   titleText       (Text)   - Title prefix
//   timezoneLabel   (Text)   - e.g. "UTC+05:30"
//   timezoneOffset  (Number) - minutes from UTC, e.g. 330
//   rootState       (Text)   - default state ID
// ============================================

self.onInit = function () {
    var $container = self.ctx.$container;
    var sc = self.ctx.stateController;
    var lastResolvedEntityId = null;

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
    //  ACTIVE TAB — highlight it, update title
    // ──────────────────────────────────────────
    var currentMode = 1;

    function setActive(stateId) {
        var resolved = (!stateId || stateId === 'default') ? ROOT_STATE : stateId;

        // Reset all tabs, then mark the active one
        $tabs.removeClass('active');
        var $active = $tabs.filter('[data-state="' + resolved + '"]');
        $active.addClass('active');

        // Update currentMode from the tab's data-mode
        if ($active.length) {
            currentMode = parseInt($active.attr('data-mode')) || 1;
        }

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
    //  SAVE DASHBOARD MODE
    //  Instead of navigating to a new state,
    //  save dashboardMode attribute → state loader
    //  picks it up and renders the sub-state
    // ──────────────────────────────────────────
    function resolveEntityId(raw) {
        if (!raw) {
            return null;
        }

        if (raw.entityType && raw.id) {
            return {
                entityType: raw.entityType,
                id: raw.id
            };
        }

        if (raw.id && raw.id.entityType && raw.id.id) {
            return {
                entityType: raw.id.entityType,
                id: raw.id.id
            };
        }

        if (raw.entityId && raw.entityId.entityType && raw.entityId.id) {
            return {
                entityType: raw.entityId.entityType,
                id: raw.entityId.id
            };
        }

        return null;
    }

    function getSelectedEntityId() {
        var params = sc ? sc.getStateParams() : {};
        var selected = params && (params.SelectedAsset || params.selectedEntity || params.entityId);
        var resolved = resolveEntityId(selected);

        if (resolved) {
            lastResolvedEntityId = resolved;
            return resolved;
        }

        return lastResolvedEntityId;
    }

    function refreshDashboardBindings() {
        if (typeof self.ctx.updateAliases === 'function') {
            self.ctx.updateAliases();
        }
        if (typeof self.ctx.detectChanges === 'function') {
            self.ctx.detectChanges();
        }
        if (self.ctx.dashboard && typeof self.ctx.dashboard.dashboardTimewindowChanged === 'function') {
            self.ctx.dashboard.dashboardTimewindowChanged();
        }
    }

    function saveDashboardMode(mode) {
        var entityId = getSelectedEntityId();

        if (entityId && self.ctx.attributeService) {
            self.ctx.attributeService.saveEntityAttributes(
                entityId, 'SERVER_SCOPE',
                [{ key: 'dashboardMode', value: mode }]
            ).subscribe(
                function () {
                    console.log('[PageHeader] dashboardMode saved:', mode);
                    refreshDashboardBindings();
                },
                function (err) {
                    console.warn('[PageHeader] Failed to save dashboardMode:', err);
                }
            );
        } else {
            console.warn('[PageHeader] No selected entity found in state params. Expected param name: SelectedAsset');
        }
    }

    // ──────────────────────────────────────────
    //  CLICK HANDLERS
    // ──────────────────────────────────────────
    $tabs.on('click', function () {
        var target = $(this).attr('data-state');
        var mode = parseInt($(this).attr('data-mode')) || 1;
        if (!target) return;

        // Brief cyan flash for click feedback
        var $clicked = $(this);
        $clicked.addClass('clicked');
        setTimeout(function () { $clicked.removeClass('clicked'); }, 150);

        // Update visual state
        setActive(target);

        // Save dashboardMode attribute (state loader reads this)
        saveDashboardMode(mode);
    });

    // ──────────────────────────────────────────
    //  INITIAL ACTIVE STATE
    // ──────────────────────────────────────────
    setActive(ROOT_STATE);

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
        $tabs.off('click');
    };
};
