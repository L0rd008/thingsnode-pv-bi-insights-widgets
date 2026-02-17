// ════════════════════════════════════════════════════
// Investment Returns Panel — v2.0
// ThingsBoard v4.3.0 PE | Latest Values
// 3 sub-cards: IRR, NPV, ROE (configurable)
// DOM caching | autoScale | em-budget resize
// ════════════════════════════════════════════════════

var $el, s;
var $panel, $title, $footer;
var $statusDot, $statusText;
var $tooltip;
var $vals = [], $titles = [], $subs = [], $ttLabels = [], $ttVals = [];

// ──────────────────────────────────────────────────
//  Lifecycle: Init
// ──────────────────────────────────────────────────
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;

    // ── Cache DOM ──
    $panel = $el.find('.invest-panel');
    $title = $el.find('.js-title');
    $footer = $el.find('.js-footer');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $tooltip = $el.find('.js-tooltip');

    for (var i = 1; i <= 3; i++) {
        $titles.push($el.find('.js-title-' + i));
        $vals.push($el.find('.js-val-' + i));
        $subs.push($el.find('.js-sub-' + i));
        $ttLabels.push($el.find('.js-tt-label-' + i));
        $ttVals.push($el.find('.js-tt-val-' + i));
    }

    // ── Accent color override ──
    if (s.accentColor) {
        $panel.css({
            '--c-accent': s.accentColor,
            '--c-accent-border': s.accentColor + '66',
            '--c-accent-hover': s.accentColor + 'CC',
            '--c-accent-glow': s.accentColor + '1F',
            '--c-accent-glow-hover': s.accentColor + '40'
        });
    }

    updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, labels, tooltip
// ──────────────────────────────────────────────────
function updateDom() {
    $title.text(s.panelTitle || 'INVESTMENT RETURNS');
    $footer.text(s.panelFooter || 'Project Life Assumptions Applied: 25 Years');

    // Card 1
    $titles[0].text(s.c1_title || 'IRR (%)');
    $subs[0].text(s.c1_sub || 'Projected: 12%');
    $ttLabels[0].text(s.c1_ttLabel || 'Target IRR');
    $ttVals[0].text(s.c1_ttVal || '12.0%');

    // Card 2
    $titles[1].text(s.c2_title || 'NPV (LKR)');
    $subs[1].text(s.c2_sub || 'Discount Rate: 7%');
    $ttLabels[1].text(s.c2_ttLabel || 'Discount Rate');
    $ttVals[1].text(s.c2_ttVal || '7.0%');

    // Card 3
    $titles[2].text(s.c3_title || 'ROE (%)');
    $subs[2].text(s.c3_sub || 'Equity: LKR 25 M');
    $ttLabels[2].text(s.c3_ttLabel || 'Total Equity');
    $ttVals[2].text(s.c3_ttVal || 'LKR 25.0 M');

    // Static tooltip override
    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    if (!self.ctx.data || self.ctx.data.length < 3) {
        showPlaceholders();
        return;
    }

    var cardConfigs = [
        { div: s.c1_divider, pre: s.c1_prefix, suf: s.c1_suffix, dec: s.c1_decimals },
        { div: s.c2_divider, pre: s.c2_prefix, suf: s.c2_suffix, dec: s.c2_decimals },
        { div: s.c3_divider, pre: s.c3_prefix, suf: s.c3_suffix, dec: s.c3_decimals }
    ];

    var allPositive = true;
    var hasNegative = false;

    for (var i = 0; i < 3; i++) {
        var dataObj = self.ctx.data[i];
        if (!dataObj || !dataObj.data || !dataObj.data.length) {
            $vals[i].text('--').addClass('skeleton');
            continue;
        }

        var rawVal = dataObj.data[0][1];
        if (rawVal === null || rawVal === undefined || isNaN(parseFloat(rawVal))) {
            $vals[i].text('--').addClass('skeleton');
            continue;
        }

        var val = parseFloat(rawVal);
        var cfg = cardConfigs[i];
        var decimals = (cfg.dec !== undefined && cfg.dec !== null) ? parseInt(cfg.dec) : 1;

        // Divide if configured
        if (cfg.div && cfg.div !== 0 && cfg.div !== 1) {
            val = val / cfg.div;
        }

        // Format
        var formatted = autoScale(val, decimals);
        var displayStr = (cfg.pre || '') + formatted + (cfg.suf || '');

        $vals[i].text(displayStr).removeClass('skeleton');

        // Positive / Negative coloring
        $vals[i].removeClass('positive negative');
        if (val > 0) {
            $vals[i].addClass('positive');
        } else if (val < 0) {
            $vals[i].addClass('negative');
            hasNegative = true;
            allPositive = false;
        }
    }

    // ── Header status — overall health ──
    var dotClass, statusLabel;
    if (hasNegative) {
        dotClass = 'critical';
        statusLabel = 'NEEDS ATTENTION';
    } else if (allPositive) {
        dotClass = 'good';
        statusLabel = 'HEALTHY';
    } else {
        dotClass = 'warning';
        statusLabel = 'MIXED';
    }

    $statusDot.removeClass('good warning critical').addClass(dotClass);
    $statusText.text(statusLabel).removeClass('good warning critical').addClass(dotClass);

    // ── Dynamic tooltip ──
    if (!s.tooltipText) {
        var tipParts = [];
        for (var j = 0; j < 3; j++) {
            var t = $titles[j].text();
            var v = $vals[j].text();
            if (v !== '--') tipParts.push(t + ': ' + v);
        }
        tipParts.push('Status: ' + statusLabel);
        $tooltip.text(tipParts.join(' · '));
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// ──────────────────────────────────────────────────
//  Placeholder state
// ──────────────────────────────────────────────────
function showPlaceholders() {
    for (var i = 0; i < 3; i++) {
        $vals[i].text('--').addClass('skeleton').removeClass('positive negative');
    }
    $statusDot.removeClass('good warning critical');
    $statusText.text('--').removeClass('good warning critical');

    if (!s.tooltipText) {
        $tooltip.text('Investment returns: IRR, NPV, and ROE metrics.');
    }
}

// ──────────────────────────────────────────────────
//  Auto-scale large numbers (K / M / B)
// ──────────────────────────────────────────────────
function autoScale(val, decimals) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    var abs = Math.abs(val);
    if (abs >= 1e9) return (val / 1e9).toFixed(decimals) + 'B';
    if (abs >= 1e6) return (val / 1e6).toFixed(decimals) + 'M';
    if (abs >= 1e3) return (val / 1e3).toFixed(decimals) + 'K';
    return val.toFixed(decimals);
}

// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var h = $el.height();
    var w = $el.width();
    if (!w || !h) return;

    // Em-budget:
    //   header(0.8) + sub-cards(title 0.55 + value 1.6 + footer 0.42 + padding 0.8 ≈ 3.37)
    //   + footer(0.5) + gaps(0.35) + outer padding(0.8) ≈ 5.82 em
    var fromHeight = (h - 4) / 5.82;

    // Width: 3 sub-cards + gaps → ~18em minimum
    var fromWidth = w / 18;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 36) fontSize = 36;

    $panel.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
