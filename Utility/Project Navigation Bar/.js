// ============================================
// Project Navigation Bar
// ThingsBoard v4.3.0 PE | Static Widget
// ============================================

self.onInit = function () {
    var $container = self.ctx.$container;
    var sc = self.ctx.stateController;
    var actionsApi = self.ctx.actionsApi;
    var $items = $container.find('.nav-item[data-state]');
    var NUM_ITEMS = $items.length || 6;

    // ==========================================================
    //  ROOT STATE — maps ThingsBoard 'default' to this state.
    //  If you renamed the default state ID to 'energy_prod',
    //  this mapping still works correctly.
    // ==========================================================
    var ROOT_STATE = 'energy_prod';

    // ----------------------------------------------------------
    //  Resolve: 'default' / '' / null → ROOT_STATE
    // ----------------------------------------------------------
    function resolveState(raw) {
        return (!raw || raw === 'default') ? ROOT_STATE : raw;
    }

    // ----------------------------------------------------------
    //  Highlight the correct button
    // ----------------------------------------------------------
    function setActive(stateId) {
        var resolved = resolveState(stateId);
        $items.removeClass('active');
        $items.filter('[data-state="' + resolved + '"]').addClass('active');
    }

    // ----------------------------------------------------------
    //  Navigate to a dashboard state
    //
    //  Strategy 1 (primary): actionsApi.handleWidgetAction()
    //    — Same engine the built-in Action Button uses.
    //    — Constructs a descriptor identical to the working
    //      action_button JSON, type "updateDashboardState".
    //
    //  Strategy 2 (fallback): stateController.updateState()
    //    — Direct call WITH state params (the missing params
    //      was the original bug — TB needs them internally).
    // ----------------------------------------------------------
    function goToState(targetState) {

        // ── Strategy 1: actionsApi (proven Action Button path) ──
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
                return; // success
            } catch (e) {
                console.warn('[NavBar] actionsApi route failed:', e.message || e);
            }
        }

        // ── Strategy 2: stateController with params (fallback) ──
        if (sc && typeof sc.updateState === 'function') {
            try {
                var params = {};
                if (typeof sc.getStateParams === 'function') {
                    params = sc.getStateParams() || {};
                }
                sc.updateState(targetState, params, false);
                return;
            } catch (e) {
                console.warn('[NavBar] updateState route failed:', e.message || e);
            }
        }

        console.error('[NavBar] No navigation method available for "' + targetState + '"');
    }

    // ----------------------------------------------------------
    //  Click handlers
    // ----------------------------------------------------------
    $items.on('click', function () {
        var target = $(this).attr('data-state');
        if (!target) return;

        // Immediate visual feedback
        $items.removeClass('active');
        $(this).addClass('active');

        goToState(target);
    });

    // ----------------------------------------------------------
    //  Initial active state
    // ----------------------------------------------------------
    try {
        setActive(sc ? sc.getStateId() : ROOT_STATE);
    } catch (e) {
        setActive(ROOT_STATE);
    }

    // ----------------------------------------------------------
    //  SCALING: Measure text at probe size, then fit to container
    // ----------------------------------------------------------
    function updateScale() {
        var $nav = $container.find('.nav-container');
        var w = $container.width();
        var h = $container.height();

        // 1. Set known probe font-size to measure real widths
        var PROBE = 16;
        $nav.css('font-size', PROBE + 'px');

        // 2. Find widest nav-item at probe size
        var maxItemW = 0;
        $items.each(function () {
            var iw = $(this).outerWidth(true);
            if (iw > maxItemW) maxItemW = iw;
        });

        // 3. Available width per item (minus gaps & padding)
        var totalGaps = 0.4 * PROBE * (NUM_ITEMS - 1);
        var padX = 0.6 * PROBE * 2;
        var availPerItem = (w - totalGaps - padX) / NUM_ITEMS;

        // 4. Scale: font-size that makes widest item fit
        var fromWidth = (availPerItem / maxItemW) * PROBE;

        // 5. Height constraint: item ≈ 2.6em tall (text + padding)
        var fromHeight = h / 2.6;

        var fontSize = Math.min(fromWidth, fromHeight);

        // 6. Clamp
        if (fontSize < 6) fontSize = 6;
        if (fontSize > 32) fontSize = 32;

        $nav.css('font-size', fontSize + 'px');
    }
    updateScale();

    // ----------------------------------------------------------
    //  Poll for external state changes (URL, other widgets, etc.)
    //  TB's IStateController has no change callback, so we poll.
    // ----------------------------------------------------------
    self._poll = setInterval(function () {
        if (!sc) return;
        try {
            var cur = resolveState(sc.getStateId());
            var $act = $items.filter('.active');
            if (!$act.length || $act.attr('data-state') !== cur) {
                setActive(cur);
            }
        } catch (e) { /* ignore */ }
    }, 300);

    // ----------------------------------------------------------
    //  Resize
    // ----------------------------------------------------------
    self.onResize = function () {
        updateScale();
    };

    // ----------------------------------------------------------
    //  Cleanup
    // ----------------------------------------------------------
    self.onDestroy = function () {
        if (self._poll) {
            clearInterval(self._poll);
            self._poll = null;
        }
        $items.off('click');
    };
};
