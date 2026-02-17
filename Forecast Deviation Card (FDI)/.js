// ════════════════════════════════════════════════════
// Forecast Deviation Card (FDI) — v2.2
// ThingsBoard v4.3.0 PE | Latest Values
// 3-tier: Live → Derived → Manual Simulation
// Compact horizontal layout — no gauge
// ════════════════════════════════════════════════════

var $el, s;
var $card, $title, $resolution;
var $statusDot, $statusText;
var $value;
var $ctxForecast, $ctxActual;
var $footerText;
var $tooltip;

// ──────────────────────────────────────────────────
//  Lifecycle: Init — DOM caching
// ──────────────────────────────────────────────────
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;

    // ── Cache all DOM selections ──
    $card = $el.find('.fdi-card');
    $title = $el.find('.js-title');
    $resolution = $el.find('.js-resolution');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $value = $el.find('.js-value');
    $ctxForecast = $el.find('.js-ctx-forecast');
    $ctxActual = $el.find('.js-ctx-actual');
    $footerText = $el.find('.js-footer-text');
    $tooltip = $el.find('.js-tooltip');

    // ── Apply accent color override ──
    if (s.accentColor) {
        $card.css({
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
//  DOM setup — titles, labels
// ──────────────────────────────────────────────────
function updateDom() {
    $title.text(s.cardTitle || 'FDI vs P50 (%)');
    $footerText.text(s.footerText || 'Deviation from Median Expectation');
    $resolution.text((s.resolution || 'Plant').toUpperCase());

    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

// ──────────────────────────────────────────────────
//  Data handler — 3-tier pipeline
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    // ── Tier 0: Manual override ──
    if (s.enableManualOverride) {
        var manualVal = parseFloat(s.manualDeviation);
        if (isNaN(manualVal)) manualVal = 0;
        applyDeviation(manualVal, null, null, 'simulated');
        return;
    }

    // ── Guard: no data at all ──
    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        showPlaceholder();
        return;
    }

    // DS[0] = first key
    var ds0Raw = self.ctx.data[0].data[0][1];
    if (ds0Raw === null || ds0Raw === undefined || isNaN(parseFloat(ds0Raw))) {
        showPlaceholder();
        return;
    }
    var ds0Val = parseFloat(ds0Raw);

    // ── Tier 1: LIVE mode — both DS[0] and DS[1] available ──
    if (self.ctx.data.length > 1 &&
        self.ctx.data[1].data && self.ctx.data[1].data.length > 0) {

        var ds1Raw = self.ctx.data[1].data[0][1];
        if (ds1Raw !== null && ds1Raw !== undefined && !isNaN(parseFloat(ds1Raw))) {
            var ds1Val = parseFloat(ds1Raw);
            var forecastVal = ds0Val;
            var actualVal = ds1Val;

            if (forecastVal > 0) {
                var fdiPct = ((actualVal - forecastVal) / forecastVal) * 100;
                applyDeviation(fdiPct, actualVal, forecastVal, 'live');
                return;
            }
        }
    }

    // ── Tier 2: DERIVED mode — DS[0] = actual, use attribute for P50 ──
    tryAttributeDerived(ds0Val, s);
};

// ──────────────────────────────────────────────────
//  Tier 2: Attribute fallback (derive P50 from annual)
// ──────────────────────────────────────────────────
function tryAttributeDerived(actualVal, settings) {
    try {
        var attrService = self.ctx.attributeService;
        if (!attrService || !self.ctx.datasources || self.ctx.datasources.length === 0) {
            applyDeviation(0, actualVal, null, 'nodata');
            return;
        }

        var ds = self.ctx.datasources[0];
        var entityId = ds.entityId;
        var entityType = ds.entityType;
        var entIdStr = (typeof entityId === 'object') ? entityId.id : entityId;
        var entTypeStr = (typeof entityType === 'string') ? entityType : entityId.entityType;

        if (!entIdStr) {
            applyDeviation(0, actualVal, null, 'nodata');
            return;
        }

        var p50Attr = settings.p50AttributeKey || 'p50_energy';
        var entityObj = { id: entIdStr, entityType: entTypeStr };

        attrService.getEntityAttributes(entityObj, 'SERVER_SCOPE', [p50Attr])
            .subscribe(
                function (attrs) {
                    if (!attrs || attrs.length === 0) {
                        applyDeviation(0, actualVal, null, 'nodata');
                        return;
                    }

                    var p50Annual = null;
                    for (var i = 0; i < attrs.length; i++) {
                        if (attrs[i].key === p50Attr) {
                            p50Annual = parseFloat(attrs[i].value);
                            break;
                        }
                    }

                    if (isNaN(p50Annual) || p50Annual <= 0) {
                        applyDeviation(0, actualVal, null, 'nodata');
                        return;
                    }

                    var dailyP50 = (p50Annual / 365) / 1000;
                    if (dailyP50 > 0) {
                        var fdiPct = ((actualVal - dailyP50) / dailyP50) * 100;
                        applyDeviation(fdiPct, actualVal, dailyP50, 'derived');
                    } else {
                        applyDeviation(0, actualVal, null, 'nodata');
                    }
                },
                function () {
                    applyDeviation(0, actualVal, null, 'nodata');
                }
            );
    } catch (e) {
        applyDeviation(0, actualVal, null, 'nodata');
    }
}

// ──────────────────────────────────────────────────
//  Apply deviation value to all UI elements
// ──────────────────────────────────────────────────
function applyDeviation(fdiPct, actualVal, forecastVal, mode) {
    var decimals = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var invert = s.invertLogic || false;
    var unit = s.unitLabel || 'MWh';
    var warnTh = (s.warningThreshold !== undefined) ? parseFloat(s.warningThreshold) : -5;
    var critTh = (s.criticalThreshold !== undefined) ? parseFloat(s.criticalThreshold) : -10;

    // ── 1. Main Value ──
    var sign = (fdiPct > 0) ? '+' : '';
    var displayStr = sign + fdiPct.toFixed(decimals) + '%';
    $value.text(displayStr).removeClass('skeleton');

    // ── 2. Severity Classification ──
    var sevClass, sevLabel, dotClass;
    var effectivePct = invert ? -fdiPct : fdiPct;

    if (effectivePct >= 0) {
        sevClass = 'sev-good';
        sevLabel = 'ON TRACK';
        dotClass = 'good';
    } else if (effectivePct >= warnTh) {
        sevClass = 'sev-good';
        sevLabel = 'ON TRACK';
        dotClass = 'good';
    } else if (effectivePct >= critTh) {
        sevClass = 'sev-warning';
        sevLabel = 'MINOR DEVIATION';
        dotClass = 'warning';
    } else {
        sevClass = 'sev-critical';
        sevLabel = 'CRITICAL DEVIATION';
        dotClass = 'critical';
    }

    // Update card accent
    $card.removeClass('sev-good sev-warning sev-critical').addClass(sevClass);

    // Update header status — dot + colored text
    $statusDot.removeClass('good warning critical').addClass(dotClass);
    $statusText.text(sevLabel).removeClass('good warning critical').addClass(dotClass);

    // ── 4. Context Values ──
    if (forecastVal !== null) {
        $ctxForecast.text(autoScale(forecastVal, decimals) + ' ' + unit);
    } else {
        $ctxForecast.text(mode === 'simulated' ? 'Sim' : '--');
    }

    if (actualVal !== null) {
        $ctxActual.text(autoScale(actualVal, decimals) + ' ' + unit);
    } else {
        $ctxActual.text(mode === 'simulated' ? 'Sim' : '--');
    }

    // ── 5. Dynamic Tooltip ──
    if (!s.tooltipText) {
        var modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
        var tipParts = [modeLabel + ' Mode'];
        tipParts.push('Deviation: ' + sign + fdiPct.toFixed(decimals) + '%');
        if (actualVal !== null) tipParts.push('Actual: ' + autoScale(actualVal, decimals) + ' ' + unit);
        if (forecastVal !== null) tipParts.push('P50: ' + autoScale(forecastVal, decimals) + ' ' + unit);
        tipParts.push('Status: ' + sevLabel);
        $tooltip.text(tipParts.join(' · '));
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
}

// ──────────────────────────────────────────────────
//  Placeholder state
// ──────────────────────────────────────────────────
function showPlaceholder() {
    $value.text('--%').addClass('skeleton');
    $statusDot.removeClass('good warning critical');
    $statusText.text('--').removeClass('good warning critical');
    $ctxForecast.text('--');
    $ctxActual.text('--');
    $card.removeClass('sev-good sev-warning sev-critical');

    if (!s.tooltipText) {
        $tooltip.text('Compares actual generation against P50 forecast to assess deviation severity.');
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

    // Compact card em-budget:
    //   header(0.8) + body(2.4) + footer(0.5) + gaps(0.25) + padding(0.7) ≈ 4.65 em
    var fromHeight = (h - 4) / 4.65;
    var fromWidth = w / 20;
    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 36) fontSize = 36;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};