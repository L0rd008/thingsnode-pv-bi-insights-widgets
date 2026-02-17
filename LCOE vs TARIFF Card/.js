// ════════════════════════════════════════════════════
// LCOE vs TARIFF Card
// ThingsBoard v4.3.0 PE | Latest Values
// ════════════════════════════════════════════════════

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, labels, tooltip, accent color
// ──────────────────────────────────────────────────
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    // Title
    $el.find('.js-title').text(s.widgetTitle || 'LCOE VS TARIFF COMPARISON');

    // Sub-labels
    $el.find('.js-sub-lcoe').text(s.lcoeSubLabel || '(Levelized Cost)');
    $el.find('.js-sub-tariff').text(s.tariffSubLabel || '(Selling Price)');

    // Tooltip — static override or will be set dynamically in onDataUpdated
    if (s.tooltipText) {
        $el.find('.js-tooltip').text(s.tooltipText);
    }

    // Custom accent color override
    if (s.accentColor) {
        var $card = $el.find('.lcoe-card');
        $card.css({
            '--c-accent': s.accentColor,
            '--c-accent-border': s.accentColor + '66',
            '--c-accent-hover': s.accentColor + 'CC',
            '--c-accent-glow': s.accentColor + '1F',
            '--c-accent-glow-hover': s.accentColor + '40'
        });
    }
};

// ──────────────────────────────────────────────────
//  Data handler — LCOE vs Tariff comparison
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    // Cache DOM elements
    var $valLcoe = $el.find('.js-val-lcoe');
    var $valTariff = $el.find('.js-val-tariff');
    var $barLcoe = $el.find('.js-bar-lcoe');
    var $barBase = $el.find('.js-bar-tariff-base');
    var $barMargin = $el.find('.js-bar-tariff-margin');
    var $statusDot = $el.find('.js-status-dot');
    var $statusText = $el.find('.js-status-text');
    var $deltaArrow = $el.find('.js-delta-arrow');
    var $deltaPct = $el.find('.js-delta-pct');
    var $marginVal = $el.find('.js-margin-val');
    var $ratioFill = $el.find('.js-ratio-fill');
    var $ratioText = $el.find('.js-ratio-text');
    var $tooltip = $el.find('.js-tooltip');

    // ── Level 1: Data array existence ──
    if (!self.ctx.data || self.ctx.data.length < 2 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0 ||
        !self.ctx.data[1].data || self.ctx.data[1].data.length === 0) {
        showPlaceholders();
        return;
    }

    // ── Level 2: NaN / null protection ──
    var rawLcoe = self.ctx.data[0].data[0][1];
    var rawTariff = self.ctx.data[1].data[0][1];

    if (rawLcoe === null || rawLcoe === undefined || isNaN(parseFloat(rawLcoe)) ||
        rawTariff === null || rawTariff === undefined || isNaN(parseFloat(rawTariff))) {
        showPlaceholders();
        return;
    }

    // ── Level 3: Parse and process ──
    var lcoe = parseFloat(rawLcoe);
    var tariff = parseFloat(rawTariff);

    // Settings with safe defaults
    var currency = s.currency || 'LKR';
    var unit = s.unit || '/ kWh';
    var decimals = (s.decimals !== undefined) ? parseInt(s.decimals) : 2;
    var warnPct = (s.warningThreshold !== undefined) ? parseFloat(s.warningThreshold) : 10;

    // ── Format display values ──
    var fmtLcoe = currency + ' ' + lcoe.toFixed(decimals) + ' ' + unit;
    var fmtTariff = currency + ' ' + tariff.toFixed(decimals) + ' ' + unit;

    $valLcoe.text(fmtLcoe).removeClass('skeleton');
    $valTariff.text(fmtTariff).removeClass('skeleton');

    // ── Margin calculations ──
    var margin = tariff - lcoe;
    var marginPct = (tariff !== 0) ? ((margin / tariff) * 100) : 0;
    var ratio = (tariff !== 0) ? (lcoe / tariff) : 0;

    // ── Status evaluation ──
    var statusClass, statusLabel;
    if (margin > 0 && marginPct > warnPct) {
        statusClass = 'good';
        statusLabel = 'PROFITABLE';
    } else if (margin > 0) {
        statusClass = 'warning';
        statusLabel = 'MARGINAL';
    } else if (margin === 0) {
        statusClass = 'warning';
        statusLabel = 'BREAK-EVEN';
    } else {
        statusClass = 'critical';
        statusLabel = 'LOSS';
    }

    $statusDot.removeClass('good warning critical').addClass(statusClass);
    $statusText.text(statusLabel);

    // ── Delta arrow & percentage ──
    var isPositive = margin >= 0;
    var arrow = isPositive ? '▲' : '▼';
    var deltaClass = isPositive ? 'positive' : 'negative';

    $deltaArrow.text(arrow)
        .removeClass('positive negative')
        .addClass(deltaClass);

    $deltaPct.text(Math.abs(marginPct).toFixed(1) + '%')
        .removeClass('positive negative')
        .addClass(deltaClass);

    // ── Margin absolute value ──
    var marginSign = margin >= 0 ? '+' : '';
    $marginVal.text(marginSign + currency + ' ' + margin.toFixed(decimals) + ' ' + unit);

    // ── Bar width calculations ──
    var maxVal = Math.max(lcoe, tariff) * 1.15;
    if (maxVal === 0) maxVal = 1;

    var lcoePct = (lcoe / maxVal) * 100;
    var tariffTotalPct = (tariff / maxVal) * 100;

    // LCOE bar
    $barLcoe.css('width', lcoePct + '%');

    // Tariff bar: cost portion (= LCOE width) + margin portion
    if (tariff >= lcoe) {
        var costPct = lcoePct;
        var profitPct = Math.max(0, tariffTotalPct - lcoePct);
        $barBase.css('width', costPct + '%');
        $barMargin.css('width', profitPct + '%').show();
    } else {
        // Loss scenario: tariff is less than LCOE
        $barBase.css('width', tariffTotalPct + '%');
        $barMargin.css('width', '0%').hide();
    }

    // ── Ratio mini-bar ──
    var ratioPct = Math.min(ratio, 1) * 100;
    $ratioFill.css('width', ratioPct + '%');
    $ratioText.text(ratio.toFixed(2) + ' : 1');

    // ── Dynamic tooltip (context-aware) ──
    if (!s.tooltipText) {
        var tip;
        if (margin > 0) {
            tip = 'Profitable: LCOE (' + currency + ' ' + lcoe.toFixed(decimals) + ') is ' +
                Math.abs(marginPct).toFixed(1) + '% below Tariff (' + currency + ' ' + tariff.toFixed(decimals) +
                '). Net margin of ' + currency + ' ' + margin.toFixed(decimals) + ' ' + unit + '.';
        } else if (margin === 0) {
            tip = 'Break-even: LCOE equals Tariff at ' + currency + ' ' + lcoe.toFixed(decimals) + ' ' + unit +
                '. No profit margin.';
        } else {
            tip = 'Loss: LCOE (' + currency + ' ' + lcoe.toFixed(decimals) + ') exceeds Tariff (' +
                currency + ' ' + tariff.toFixed(decimals) + ') by ' + currency + ' ' +
                Math.abs(margin).toFixed(decimals) + ' ' + unit + '. Review cost structure.';
        }
        $tooltip.text(tip);
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }

    // ── Placeholder helper (defined as closure for access to cached DOM) ──
    function showPlaceholders() {
        $valLcoe.text('--');
        $valTariff.text('--');
        $statusDot.removeClass('good warning critical');
        $statusText.text('--');
        $deltaArrow.text('●').removeClass('positive negative');
        $deltaPct.text('--%').removeClass('positive negative');
        $marginVal.text('--');
        $ratioFill.css('width', '0%');
        $ratioText.text('--');
    }
};

// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.lcoe-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget (vertical):
    //   header(0.65) + gap(0.2) + row1(1.5) + gap(0.2) +
    //   row2(1.5) + gap(0.15) + footer(0.7) + padding(0.9)
    //   ≈ 5.8 em
    var fromHeight = (h - 8) / 5.8;

    // Em budget (horizontal):
    //   label(4.5) + bar(min ~5) + value(5) + padding(1.4) + gaps(2)
    //   ≈ 18 em
    var fromWidth = w / 18;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 32) fontSize = 32;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
