// ════════════════════════════════════════════════════
// DSCR Status Card
// ThingsBoard v4.3.0 PE | Latest Values
// 3-Tier: Manual -> Live
// Severity: Compliant (Green) vs Breach (Red)
// ════════════════════════════════════════════════════

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.jQuery ? self.ctx.jQuery(self.ctx.$container) : $(self.ctx.$container);

    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, labels
// ──────────────────────────────────────────────────
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    $el.find('.js-title').text(s.cardTitle || 'DSCR');

    // Tooltip: Static override or auto-generated later
    if (s.tooltipText) {
        $el.find('.js-tooltip').text(s.tooltipText);
    }
};

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.dscr-card');
    var s = self.ctx.settings;

    var $valEl = $el.find('.js-value');
    var $statusDot = $el.find('.js-status-dot');
    var $statusTxt = $el.find('.js-status-text');
    var $footerLbl = $el.find('.js-footer-label');
    var $footerVal = $el.find('.js-footer-value');

    var val, limit;

    // ── Tier 1: Manual Override ──
    if (s.enableManualOverride) {
        val = parseFloat(s.manualDSCR);
        limit = parseFloat(s.manualLimit);
        if (isNaN(val)) val = 0;
        if (isNaN(limit)) limit = 1.20;
    }
    // ── Tier 2: Live Data (DS[0]=Value, DS[1]=Limit) ──
    else {
        // Guard: Need at least 2 datasources
        if (!self.ctx.data || self.ctx.data.length < 2 ||
            !self.ctx.data[0].data || self.ctx.data[0].data.length === 0 ||
            !self.ctx.data[1].data || self.ctx.data[1].data.length === 0) {
            showPlaceholders();
            return;
        }

        var rawVal = self.ctx.data[0].data[0][1];
        var rawLimit = self.ctx.data[1].data[0][1];

        if (rawVal === null || rawVal === undefined || isNaN(parseFloat(rawVal)) ||
            rawLimit === null || rawLimit === undefined || isNaN(parseFloat(rawLimit))) {
            showPlaceholders();
            return;
        }

        val = parseFloat(rawVal);
        limit = parseFloat(rawLimit);
    }

    // ── Render ──
    var decimals = (s.decimals !== undefined) ? parseInt(s.decimals) : 2;
    $valEl.text(val.toFixed(decimals));
    $valEl.removeClass('skeleton');

    // Footer
    $footerLbl.text(s.covLabel || 'Min Covenant:');
    $footerVal.text(limit.toFixed(decimals) + 'x');

    // ── Severity Logic ──
    // Compliant: val >= limit
    var isCompliant = val >= limit;
    var passText = s.passText || 'COMPLIANT';
    var failText = s.failText || 'BREACH';

    $card.removeClass('status-good status-critical');

    if (isCompliant) {
        $card.addClass('status-good');
        $statusTxt.text(passText);
    } else {
        $card.addClass('status-critical');
        $statusTxt.text(failText);
    }

    // ── Dynamic Tooltip ──
    if (!s.tooltipText) {
        var status = isCompliant ? passText : failText;
        var diff = (val - limit).toFixed(decimals);
        var sign = (diff >= 0) ? '+' : '';
        $el.find('.js-tooltip').text(
            'DSCR: ' + val.toFixed(decimals) + ' | Limit: ' + limit.toFixed(decimals) + 'x | ' + status + ' (' + sign + diff + ')'
        );
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }

    function showPlaceholders() {
        $valEl.text('--');
        $statusTxt.text('--');
        $card.removeClass('status-good status-critical');
        $footerVal.text('--');
    }
};

// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.dscr-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget (vertical):
    //   header(0.7) + gap(0.15) + value(2.2) + gap(0.1) + footer(0.45) + padding(1.0)
    //   ≈ 4.6em -> using 5.2 for safety
    var fromHeight = (h - 8) / 5.2;

    // Em budget (horizontal):
    //   padding(1.4) + value(~4ch * 0.6?) -> roughly w/8
    var fromWidth = w / 8;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 36) fontSize = 36;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
