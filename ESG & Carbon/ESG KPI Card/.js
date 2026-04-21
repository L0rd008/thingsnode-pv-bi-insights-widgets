// ============================================
// ESG KPI Card — Enhanced Multi-Mode
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
//  Mode configuration map
// --------------------------------------------------
var MODE_CONFIG = {
    carbon: {
        icon: '🍃',
        title: 'CO₂ OFFSET',
        subtitle: 'Estimated',
        unit: 'tCO₂',
        tooltip: 'Estimated CO₂ emissions avoided via grid displacement.',
        scaleSteps: [
            { threshold: 1000, unit: 'ktCO₂', divisor: 1000 },
            { threshold: 0, unit: 'tCO₂', divisor: 1 }
        ],
        thresholdWarning: 500,
        thresholdCritical: 100,
        thresholdInvert: false
    },
    water: {
        icon: '💧',
        title: 'WATER SAVED',
        subtitle: 'Cumulative',
        unit: 'kL',
        tooltip: 'Water consumption avoided through renewable energy use.',
        scaleSteps: [
            { threshold: 1000, unit: 'ML', divisor: 1000 },
            { threshold: 0, unit: 'kL', divisor: 1 }
        ],
        thresholdWarning: 200,
        thresholdCritical: 50,
        thresholdInvert: false
    },
    waste: {
        icon: '♻️',
        title: 'WASTE DIVERTED',
        subtitle: 'Recycled / Reused',
        unit: 't',
        tooltip: 'Solid waste diverted from landfill through recycling.',
        scaleSteps: [
            { threshold: 1000, unit: 'kt', divisor: 1000 },
            { threshold: 0, unit: 't', divisor: 1 }
        ],
        thresholdWarning: 50,
        thresholdCritical: 10,
        thresholdInvert: false
    },
    renewable: {
        icon: '⚡',
        title: 'RENEWABLE SHARE',
        subtitle: 'Of Total Energy',
        unit: '%',
        tooltip: 'Percentage of energy sourced from renewable generation.',
        scaleSteps: null,
        thresholdWarning: 60,
        thresholdCritical: 30,
        thresholdInvert: false
    },
    custom: {
        icon: '📊',
        title: 'ESG METRIC',
        subtitle: '',
        unit: '',
        tooltip: '',
        scaleSteps: null,
        thresholdWarning: null,
        thresholdCritical: null,
        thresholdInvert: false
    }
};

// --------------------------------------------------
//  DOM setup — mode switching, titles, labels
// --------------------------------------------------
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;
    var mode = s.cardMode || 'carbon';
    var cfg = MODE_CONFIG[mode] || MODE_CONFIG['custom'];

    var $card = $el.find('.esg-card');

    $card.removeClass('mode-carbon mode-water mode-waste mode-renewable mode-custom');
    $card.addClass('mode-' + mode);

    if (s.accentColor) {
        $card.css('--c-accent', s.accentColor);
    }

    $el.find('.js-icon').text(cfg.icon);
    $el.find('.js-title').text(s.cardTitle || cfg.title);
    $el.find('.js-subtitle').text(s.subtitle || cfg.subtitle);

    var unitText = s.unit || cfg.unit;
    unitText = unitText.replace(/CO2|CO₂/g, 'CO<sub>2</sub>');
    $el.find('.js-unit').html(unitText);

    var ttText = s.tooltipText || cfg.tooltip;
    if (ttText) {
        $el.find('.js-tooltip').text(ttText);
        $el.find('.tooltip-container').show();
    } else {
        $el.find('.tooltip-container').hide();
    }

    $el.find('.js-delta, .js-progress, .js-status').hide();

    var showStatus = (s.showStatus !== false);

    if (mode === 'renewable') {
        $el.find('.js-progress').css('display', 'flex');
    }
    if (showStatus) {
        $el.find('.js-status').css('display', 'flex');
    }

    $el.find('.js-delta-label').text(s.deltaLabel || 'vs Target');
};

// --------------------------------------------------
//  Data handler — value formatting, auto-scaling,
//  delta calculation, threshold evaluation
// --------------------------------------------------
self.onDataUpdated = function () {

    var $el = self.ctx.$widget;
    var s = self.ctx.settings;
    var mode = s.cardMode || 'carbon';
    var cfg = MODE_CONFIG[mode] || MODE_CONFIG['custom'];

    var $valEl = $el.find('.js-value');
    var $unitEl = $el.find('.js-unit');

    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        $valEl.text('--');
        return;
    }

    var rawVal = self.ctx.data[0].data[0][1];

    if (rawVal === null || rawVal === undefined || isNaN(parseFloat(rawVal))) {
        $valEl.text('--');
        return;
    }

    var val = parseFloat(rawVal);

    // 3. Apply divider
    var divider = s.divider || 1;
    var baseVal = val / divider;

    // 3b. Optional in-widget CO2 conversion for carbon mode.
    //     If co2Factor is configured, treat baseVal as energy (post-divider) and
    //     convert to tCO2 here.  This eliminates the need for device-side CO2
    //     computation and ensures all time-period widgets use the same factor.
    //     Leave co2Factor empty to use raw telemetry as-is (legacy: device sends tCO2).
    var co2Factor = parseFloat(s.co2Factor);
    if (mode === 'carbon' && !isNaN(co2Factor) && co2Factor > 0) {
        baseVal = baseVal * co2Factor;
    }

    // 4. Auto-scale.
    //     BUG-10 NOTE (reverted): the unit override freezes the LABEL only.
    //     The numeric divisor is still applied so that scale steps remain effective.
    //     Rationale: devices commonly send kgCO2; the autoScale divisor (×1000)
    //     coincidentally converts kgCO2→tCO2 when unit='tCO2' is forced.
    //     Skipping the divisor (BUG-10 attempt) caused a 1000x display inflation.
    var autoScale = (s.autoScale !== false);
    var displayUnit = s.unit || cfg.unit;
    var displayVal  = baseVal;

    var hasUnitOverride = (s.unit && s.unit.trim() !== '');

    if (autoScale && cfg.scaleSteps) {
        for (var i = 0; i < cfg.scaleSteps.length; i++) {
            var step = cfg.scaleSteps[i];
            if (Math.abs(baseVal) >= step.threshold) {
                displayVal = baseVal / step.divisor;
                // Only update the unit label when no explicit override is set.
                if (!hasUnitOverride) {
                    displayUnit = step.unit;
                }
                break;
            }
        }
    }


    var decimals = (s.decimals !== undefined) ? s.decimals : 1;
    var formattedVal = displayVal.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });

    $valEl.text(formattedVal);
    $valEl.removeClass('skeleton');

    displayUnit = displayUnit.replace(/CO2|CO₂/g, 'CO<sub>2</sub>');
    $unitEl.html(displayUnit);

    // BUG-4 FIX: Populate renewable progress bar from live data.
    // The bar was shown in the DOM for renewable mode but never driven by onDataUpdated.
    if (mode === 'renewable') {
        var fillPct = Math.max(0, Math.min(100, baseVal));
        $el.find('.js-progress-fill').css('width', fillPct + '%');
        $el.find('.js-progress-label').text(baseVal.toFixed(decimals) + '%');
    }

    // 7. Delta vs target
    var $delta = $el.find('.js-delta');

    if (s.showDelta !== false && mode !== 'renewable') {

        var hasTarget = self.ctx.data.length > 1 &&
                        self.ctx.data[1].data &&
                        self.ctx.data[1].data.length > 0;

        if (hasTarget) {

            var targetRaw = self.ctx.data[1].data[0][1];

            if (targetRaw !== null && targetRaw !== undefined && !isNaN(parseFloat(targetRaw))) {

                var targetBase = parseFloat(targetRaw) / divider;
                var targetDisplayVal = targetBase;

                // BUG-3 FIX: Delta must be computed on the raw (pre-scale) values.
                // Using display-scaled values caused a units mismatch when main and target
                // crossed different scale thresholds (e.g. 1.5 ktCO₂ vs 800 tCO₂ → diff = -798.5).
                if (autoScale && cfg.scaleSteps) {
                    for (var j = 0; j < cfg.scaleSteps.length; j++) {
                        var tStep = cfg.scaleSteps[j];
                        if (Math.abs(targetBase) >= tStep.threshold) {
                            targetDisplayVal = targetBase / tStep.divisor;
                            break;
                        }
                    }
                }

                if (targetBase > 0) {

                    var diff = baseVal - targetBase;
                    var pct = (diff / targetBase) * 100;

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

    // Threshold logic untouched
    if (s.showStatus !== false) {

        var threshWarn = (s.thresholdWarning !== undefined && s.thresholdWarning !== null)
            ? s.thresholdWarning
            : (cfg.thresholdWarning);

        var threshCrit = (s.thresholdCritical !== undefined && s.thresholdCritical !== null)
            ? s.thresholdCritical
            : (cfg.thresholdCritical);

        if (threshWarn !== null && threshCrit !== null) {

            var invert = s.thresholdInvert || cfg.thresholdInvert || false;
            var checkVal = baseVal;

            var $dot = $el.find('.js-status-dot');
            var $text = $el.find('.js-status-text');

            $dot.removeClass('warn critical');

            if (invert) {
                if (checkVal > threshWarn) {
                    $dot.addClass('critical');
                    $text.text('Critical');
                } else if (checkVal > threshCrit) {
                    $dot.addClass('warn');
                    $text.text('Warning');
                } else {
                    $text.text('On Track');
                }
            } else {
                if (checkVal < threshCrit) {
                    $dot.addClass('critical');
                    $text.text('Critical');
                } else if (checkVal < threshWarn) {
                    $dot.addClass('warn');
                    $text.text('Warning');
                } else {
                    $text.text('On Track');
                }
            }
        }
    }

    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// --------------------------------------------------
//  Responsive font scaling
//  BUG-5/9 FIX: onResize was called in onInit but never defined,
//  causing a hard TypeError crash on every widget render.
// --------------------------------------------------
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.esg-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget:
    //   header(0.7) + value(2.0) + unit(0.6) + sub-content(0.65) +
    //   footer(0.5) + gaps(1.05) + padding(1.0) ≈ 8.5em
    var fromHeight = (h - 8) / 8.5;

    // Width: value + unit + padding ≈ 9em minimum
    var fromWidth = w / 10;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 32) fontSize = 32;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
