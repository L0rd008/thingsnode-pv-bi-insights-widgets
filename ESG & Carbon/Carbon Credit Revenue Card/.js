// ============================================
// Carbon Credit Revenue Card
// ThingsBoard v4.3.0 PE | Latest Values
// ============================================

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// --------------------------------------------------
//  DOM setup — titles, labels, tooltip, visibility
// --------------------------------------------------
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $card = $el.find('.carbon-rev-card');

    // Accent color override
    if (s.accentColor) {
        $card.css('--c-accent', s.accentColor);
    }

    // Icon & Title
    $el.find('.js-icon').text(s.icon || '💰');
    $el.find('.js-title').text(s.title || 'CARBON CREDIT REVENUE');
    $el.find('.js-main-label').text(s.mainLabel || 'ANNUAL VALUE');
    $el.find('.js-bar-title').text(s.barLabel || 'LIFETIME POTENTIAL VALUE');

    // Currency unit
    $el.find('.js-unit').text(s.currency || 'LKR');

    // Footer
    $el.find('.js-footer-left').text(s.subtitle || 'Estimated');
    $el.find('.js-footer-right').text(s.footerNote || '* Based on verified standards');

    // Tooltip
    var ttText = s.tooltipText || '';
    if (ttText) {
        $el.find('.js-tooltip').text(ttText);
        $el.find('.tooltip-container').show();
    } else {
        $el.find('.tooltip-container').hide();
    }

    // Delta label
    $el.find('.js-delta-label').text(s.deltaLabel || 'vs Target');

    // Hide sub-content sections by default (shown in onDataUpdated)
    $el.find('.js-delta, .js-status').hide();
};

// --------------------------------------------------
//  Data handler — value formatting, auto-scaling,
//  delta calculation, threshold evaluation
// --------------------------------------------------
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $valEl = $el.find('.js-value');
    var $barVal = $el.find('.js-bar-value');
    var $fill = $el.find('.js-progress-fill');

    // 1. Data safety check
    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        $valEl.text('--');
        $barVal.text('--');
        $fill.css('width', '0%');
        return;
    }

    var rawVal = self.ctx.data[0].data[0][1];

    // 2. NaN / null protection
    if (rawVal === null || rawVal === undefined || isNaN(parseFloat(rawVal))) {
        $valEl.text('--');
        $barVal.text('--');
        $fill.css('width', '0%');
        return;
    }

    var val = parseFloat(rawVal);

    // 3. Apply divider
    var divider = s.divider || 1;
    var baseVal = val / divider;

    // 4. Calculate financials
    var annualFactor = parseFloat(s.annualFactor) || 15;
    var lifetimeFactor = parseFloat(s.lifetimeFactor) || 350;

    var annualRevenue = baseVal * annualFactor;
    var lifetimePotential = baseVal * lifetimeFactor;

    // 5. Auto-scale currency (K / M / B)
    var autoScale = (s.autoScale !== false);
    var currency = s.currency || 'LKR';

    var scaleSteps = [
        { threshold: 1e9, suffix: 'B', divisor: 1e9 },
        { threshold: 1e6, suffix: 'M', divisor: 1e6 },
        { threshold: 1e3, suffix: 'K', divisor: 1e3 },
        { threshold: 0, suffix: '', divisor: 1 }
    ];

    var formatScaled = function (value) {
        var displayVal = value;
        var displaySuffix = '';

        if (autoScale) {
            for (var i = 0; i < scaleSteps.length; i++) {
                if (Math.abs(value) >= scaleSteps[i].threshold) {
                    displayVal = value / scaleSteps[i].divisor;
                    displaySuffix = scaleSteps[i].suffix;
                    break;
                }
            }
        }

        var decimals = (s.decimals !== undefined) ? s.decimals : 0;
        var formatted = displayVal.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });

        return formatted + displaySuffix;
    };

    // 6. Render main value
    $valEl.text(formatScaled(annualRevenue));
    $valEl.removeClass('skeleton');

    // 7. Render bar value
    $barVal.text(formatScaled(lifetimePotential) + ' ' + currency);

    // 8. Progress bar logic
    // Represents: what fraction of the lifetime projection budget is consumed by one annual period?
    // = annualFactor / lifetimeFactor (both are multipliers on the same base, so baseVal cancels out).
    // BUG-1 FIX: removed the arbitrary ×10 fudge that only matched the factory-default settings.
    var visualPct = 0;
    if (lifetimeFactor > 0) {
        visualPct = (annualFactor / lifetimeFactor) * 100;
    }
    if (visualPct > 100) visualPct = 100;
    if (visualPct < 3) visualPct = 3;

    $fill.css('width', visualPct + '%');

    // 9. Delta vs target (2nd data source)
    var $delta = $el.find('.js-delta');

    if (s.showDelta !== false) {
        var hasTarget = self.ctx.data.length > 1 &&
            self.ctx.data[1].data &&
            self.ctx.data[1].data.length > 0;

        if (hasTarget) {
            var targetRaw = self.ctx.data[1].data[0][1];

            if (targetRaw !== null && targetRaw !== undefined && !isNaN(parseFloat(targetRaw))) {
                var targetVal = parseFloat(targetRaw) / divider;
                var targetRevenue = targetVal * annualFactor;

                if (targetRevenue > 0) {
                    var diff = annualRevenue - targetRevenue;
                    var pct = (diff / targetRevenue) * 100;

                    $el.find('.js-delta-value').text(Math.abs(pct).toFixed(1) + '%');

                    if (pct >= 0) {
                        $delta.removeClass('negative');
                        $el.find('.js-delta-arrow').text('▲');
                    } else {
                        $delta.addClass('negative');
                        $el.find('.js-delta-arrow').text('▼');
                    }

                    $delta.css('display', 'flex');
                } else {
                    $delta.hide();
                }
            } else {
                $delta.hide();
            }
        } else {
            $delta.hide();
        }
    } else {
        $delta.hide();
    }

    // 10. Threshold status badge
    if (s.showStatus !== false) {
        var threshWarn = s.thresholdWarning;
        var threshCrit = s.thresholdCritical;

        if (threshWarn !== undefined && threshWarn !== null &&
            threshCrit !== undefined && threshCrit !== null) {

            var $dot = $el.find('.js-status-dot');
            var $text = $el.find('.js-status-text');
            var $status = $el.find('.js-status');

            $dot.removeClass('warn critical');

            if (annualRevenue < threshCrit) {
                $dot.addClass('critical');
                $text.text('Critical');
            } else if (annualRevenue < threshWarn) {
                $dot.addClass('warn');
                $text.text('Warning');
            } else {
                $text.text('On Track');
            }

            $status.css('display', 'flex');
        }
    }

    // 11. Angular change detection
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// --------------------------------------------------
//  Responsive font scaling
// --------------------------------------------------
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.carbon-rev-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget:
    //   title(0.7) + value(2.0) + mainLabel(0.55) + sub(0.65) +
    //   barHeader(0.5) + barTrack(0.5) + footer(0.45) + gaps(1.15) ≈ 7.5em
    var fromHeight = (h - 8) / 7.5;

    // Width: value + unit + padding ≈ 8em minimum
    var fromWidth = w / 10;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 36) fontSize = 36;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};