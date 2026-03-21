// ════════════════════════════════════════════════════
// Finance KPI Card
// ThingsBoard v4.3.0 PE | Latest Values
// Auto-scale · Delta · Severity badge
// ════════════════════════════════════════════════════

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.jQuery ? self.ctx.jQuery(self.ctx.$container) : $(self.ctx.$container);

    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  Helper: Auto-scale
// ──────────────────────────────────────────────────
self.autoScale = function (val, decimals) {
    var abs = Math.abs(val);
    var steps = [
        { threshold: 1e9, suffix: 'B', divisor: 1e9 },
        { threshold: 1e6, suffix: 'M', divisor: 1e6 },
        { threshold: 1e4, suffix: 'K', divisor: 1e3 },
        { threshold: 0, suffix: '', divisor: 1 }
    ];

    for (var i = 0; i < steps.length; i++) {
        if (abs >= steps[i].threshold) {
            var scaled = val / steps[i].divisor;
            return scaled.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }) + steps[i].suffix;
        }
    }
    return val.toFixed(decimals);
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, labels, currency
// ──────────────────────────────────────────────────
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    $el.find('.js-title').text(s.cardTitle || 'Metric Name');
    $el.find('.js-currency').text(s.currencySym || 'LKR');
    $el.find('.js-unit').text(s.mainUnit || '');
    $el.find('.js-delta-label').text(s.deltaLabel || 'vs Target');

    // Footer
    if (s.footerText) {
        $el.find('.js-footer-label').text(s.footerText);
    }

    // Tooltip: static override or will be set dynamically
    if (s.tooltipText) {
        $el.find('.js-tooltip').text(s.tooltipText);
    }
};

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $valEl = $el.find('.js-value');
    var $statusDot = $el.find('.js-status-dot');
    var $statusTxt = $el.find('.js-status-text');
    var $delta = $el.find('.js-delta');

    // ── Guard: no data ──
    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        showPlaceholders();
        return;
    }

    var rawVal = self.ctx.data[0].data[0][1];
    if (rawVal === null || rawVal === undefined || isNaN(parseFloat(rawVal))) {
        showPlaceholders();
        return;
    }

    // ── Parse and format main value ──
    var val = parseFloat(rawVal);
    var divider = parseFloat(s.divider) || 1;
    var decimals = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var display = val / divider;

    var formattedText;
    if (s.enableAutoScale) {
        formattedText = self.autoScale(display, decimals);
        // Auto-scale provides its own suffix, hide static unit
        $el.find('.js-unit').text('');
    } else {
        formattedText = display.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    $valEl.text(formattedText).removeClass('skeleton');

    // ── Delta calculation (DS[1] = comparator) ──
    var invert = s.invertDelta || false;
    var deltaShown = false;

    if (self.ctx.data.length > 1 &&
        self.ctx.data[1].data && self.ctx.data[1].data.length > 0) {

        var compRaw = self.ctx.data[1].data[0][1];
        if (compRaw !== null && compRaw !== undefined && !isNaN(parseFloat(compRaw))) {
            var compVal = parseFloat(compRaw);
            if (compVal > 0) {
                var diff = val - compVal;
                var pct = (diff / compVal) * 100;

                $el.find('.js-delta-value').text(Math.abs(pct).toFixed(1) + '%');

                // Arrow follows actual direction
                $el.find('.js-delta-arrow').text(pct >= 0 ? '▲' : '▼');

                // Color follows "is this good?" logic (invertable)
                var isGood = pct >= 0;
                if (invert) isGood = !isGood;

                if (isGood) {
                    $delta.removeClass('negative');
                } else {
                    $delta.addClass('negative');
                }

                deltaShown = true;

                // Auto-footer if no custom footer
                if (!s.footerText) {
                    var compFormatted = s.enableAutoScale
                        ? self.autoScale(compVal / divider, decimals)
                        : (compVal / divider).toLocaleString('en-US', {
                            minimumFractionDigits: decimals,
                            maximumFractionDigits: decimals
                        });
                    var currency = s.currencySym || 'LKR';
                    $el.find('.js-footer-label').text(
                        (s.deltaLabel || 'Target') + ': ' + currency + ' ' + compFormatted
                    );
                }
            }
        }
    }

    if (!deltaShown) {
        $delta.css('visibility', 'hidden');
    } else {
        $delta.css('visibility', 'visible');
    }

    // ── Severity evaluation ──
    var sevMed = (s.severityMedium !== undefined && s.severityMedium !== null && s.severityMedium !== '')
        ? parseFloat(s.severityMedium) : null;
    var sevHigh = (s.severityHigh !== undefined && s.severityHigh !== null && s.severityHigh !== '')
        ? parseFloat(s.severityHigh) : null;

    $statusDot.removeClass('sev-low sev-moderate sev-high');

    if (sevMed !== null && sevHigh !== null) {
        var sevClass, sevLabel;
        if (val < sevMed) {
            sevClass = 'sev-low';
            sevLabel = 'LOW';
        } else if (val < sevHigh) {
            sevClass = 'sev-moderate';
            sevLabel = 'MODERATE';
        } else {
            sevClass = 'sev-high';
            sevLabel = 'HIGH';
        }
        $statusDot.addClass(sevClass);
        $statusTxt.text(sevLabel);
    } else {
        $statusTxt.text('');
    }

    // ── Dynamic tooltip ──
    if (!s.tooltipText) {
        var currency = s.currencySym || 'LKR';
        var tipParts = [currency + ' ' + formattedText + (s.mainUnit ? ' ' + s.mainUnit : '')];
        if (deltaShown) {
            var sign = (pct >= 0) ? '+' : '';
            tipParts.push('Delta: ' + sign + pct.toFixed(1) + '%');
        }
        if (sevMed !== null && sevHigh !== null) {
            tipParts.push('Status: ' + sevLabel);
        }
        $el.find('.js-tooltip').text(tipParts.join(' | '));
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }

    // ── Helpers ──
    function showPlaceholders() {
        $valEl.text('--');
        $delta.css('visibility', 'hidden');
        $statusDot.removeClass('sev-low sev-moderate sev-high');
        $statusTxt.text('--');
        if (!s.footerText) $el.find('.js-footer-label').text('--');
    }
};



// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.finance-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget (vertical):
    //   header(0.7) + gap(0.15) + value(2.0) + delta(0.65) +
    //   gap(0.1) + footer(0.42) + padding(1.0)
    //   ≈ 5.02 em → use 5.2 for breathing room
    var fromHeight = (h - 8) / 5.2;

    // Em budget (horizontal):
    //   padding(1.4) + currency(0.9) + value(~5em) + unit(0.9)
    //   ≈ 10 em
    var fromWidth = w / 10;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 36) fontSize = 36;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
