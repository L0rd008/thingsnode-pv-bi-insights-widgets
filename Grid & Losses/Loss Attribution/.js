// Loss Attribution Card
// ThingsBoard v4.3.0 PE | Latest Values
// Modes: grid, curtail, revenue, insurance, rangeSelector

var LOSS_RANGE_PARAM = 'LossAttributionRange';
var TB_MAX_AVG_INTERVALS = 720;
var TB_RAW_LIMIT = 50000;
var RAW_CHUNK_MS = 31 * 24 * 60 * 60 * 1000;
var SOLAR_DAY_START_HOUR = 5;
var SOLAR_DAY_END_HOUR = 19;
var DELTA_NEUTRAL_PCT = 0.1;

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.jQuery ? self.ctx.jQuery(self.ctx.$container) : $(self.ctx.$container);
    self._calcTimer = null;
    self._calcToken = 0;
    self._rangeBound = false;

    self._icons = {
        grid: '<svg viewBox="0 0 24 24"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>',
        curtail: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
        revenue: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>',
        curtailRevenue: '<svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>',
        insurance: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
        rangeSelector: '<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3V2zm11 8H6v10h12V10z"/></svg>'
    };

    self._modes = {
        grid: {
            title: 'GRID AVAILABILITY IMPACT LOSS',
            sub: 'Due to Grid Outage',
            tooltip: 'Gross missing energy from potential power minus exported power.',
            footer: 'Operational Loss - Grid & Losses',
            isFinancial: false,
            computed: true,
            metricKey: 'grossLossKWh'
        },
        curtail: {
            title: 'CURTAILMENT LOSS',
            sub: 'Export Limits Imposed',
            tooltip: 'Energy loss during active setpoint limits using the V5 potential-power formula.',
            footer: 'Operational Loss - Curtailment',
            isFinancial: false,
            computed: true,
            metricKey: 'curtailLossKWh'
        },
        revenue: {
            title: 'REVENUE LOSS (POTENTIAL)',
            sub: 'Tariff Rated Loss',
            tooltip: 'Gross missing energy multiplied by the plant tariff rate.',
            footer: 'Financial Loss - Revenue Impact',
            isFinancial: true,
            computed: true,
            metricKey: 'revenueLossLkr'
        },
        curtailRevenue: {
            title: 'CURTAILMENT REVENUE LOSS',
            sub: 'Financial Impact of Limits',
            tooltip: 'Curtailment energy loss multiplied by the plant tariff rate.',
            footer: 'Financial Loss - Curtailment',
            isFinancial: true,
            computed: true,
            metricKey: 'curtailRevenueLossLkr'
        },
        insurance: {
            title: 'INSURANCE CLAIMABLE LOSS',
            sub: 'Eligible Major Events',
            tooltip: 'Portion of revenue loss from qualifying events eligible for insurance claims under the policy.',
            footer: 'Recoverable Loss - Insurance',
            isFinancial: true,
            computed: false
        },
        rangeSelector: {
            title: 'LOSS RANGE',
            sub: 'Dashboard Scope',
            tooltip: 'Selects the shared range used by Loss Attribution cards.',
            footer: 'Shared Range',
            isFinancial: false,
            computed: false
        }
    };

    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;
    var mode = getMode();
    var def = getModeDef(mode);
    var $card = $el.find('.loss-card');

    $card.removeClass('mode-grid mode-curtail mode-revenue mode-curtailRevenue mode-insurance mode-rangeSelector is-selector');
    $card.addClass('mode-' + mode);

    if (mode === 'rangeSelector') {
        $card.addClass('is-selector');
    }

    $el.find('.js-icon').html(self._icons[mode] || '');
    $el.find('.js-title').text(s.customTitle || def.title);
    $el.find('.js-sub').text(s.customSub || def.sub);
    $el.find('.js-footer-label').text(def.footer);
    hideDelta();

    if (s.tooltipText) {
        $el.find('.js-tooltip').text(s.tooltipText);
    } else {
        $el.find('.js-tooltip').text(def.tooltip);
    }

    if (mode === 'rangeSelector') {
        setupRangeSelector();
    }

    self._onRangeChanged = function(e) {
        if (e && e.detail) {
            self._activeRangeOverride = e.detail;
            storeRangeLocal(e.detail);
            if (getMode() !== 'rangeSelector') {
                debouncedComputedRender();
            }
        }
    };
    window.addEventListener('loss-range-changed', self._onRangeChanged);
};

self.onDataUpdated = function () {
    var mode = getMode();
    if (mode === 'rangeSelector') {
        renderSelectorRange(getActiveRange());
        return;
    }

    var def = getModeDef(mode);
    if (def.computed) {
        debouncedComputedRender();
    } else {
        renderLatestValueFallback();
    }
};

function getMode() {
    return (self.ctx.settings && self.ctx.settings.cardMode) || 'grid';
}

function getModeDef(mode) {
    return (self._modes && self._modes[mode]) || self._modes.grid;
}

function debouncedComputedRender() {
    if (self._calcTimer) clearTimeout(self._calcTimer);
    self._calcTimer = setTimeout(function () {
        self._calcTimer = null;
        renderComputedMode();
    }, 150);
}

function renderComputedMode() {
    var token = ++self._calcToken;
    var mode = getMode();
    var def = getModeDef(mode);
    var entity = resolveEntity();
    var range = getActiveRange();

    if (!entity || !entity.id || !def.computed) {
        renderLatestValueFallback();
        return;
    }

    setLoadingState(range);

    var s = self.ctx.settings || {};
    var useNew = s.useNewLossKeys !== undefined ? s.useNewLossKeys : 'auto';

    /**
     * Pick the calculation function for a given range.
     *
     * 'off'   → always legacy per-minute path.
     * 'force' → always precomputed; no fallback.
     * 'auto'  → precomputed UNLESS it's the current calendar day in day mode
     *            (today: ≤1440 rows, legacy is fine and gives live data).
     *            If precomputed returns ok=false, fall back to legacy.
     */
    function calcForRange(rangeObj, attrs) {
        if (useNew === 'off') {
            return calculateLossForRange(entity, rangeObj, attrs);
        }

        if (useNew === 'force') {
            return calculateLossForRangePrecomputed(entity, rangeObj, attrs);
        }

        // 'auto' (default)
        if (isCurrentDay(rangeObj)) {
            // Today's data: use per-minute live path
            return calculateLossForRange(entity, rangeObj, attrs);
        }

        return calculateLossForRangePrecomputed(entity, rangeObj, attrs)
            .then(function (preResult) {
                if (preResult && preResult.ok) {
                    return preResult;
                }
                // Precomputed empty / not yet rolled up → silent fallback
                return calculateLossForRange(entity, rangeObj, attrs);
            })
            .catch(function () {
                return calculateLossForRange(entity, rangeObj, attrs);
            });
    }

    fetchCalculationAttributes(entity).then(function (attrs) {
        if (token !== self._calcToken) return null;
        if (mode === 'revenue' && !isFiniteNumber(attrs.tariffRate) && useNew === 'off') {
            return null;
        }

        return calcForRange(range, attrs).then(function (primary) {
            var compRange = getComparatorRange(range);
            if (!compRange) {
                return { attrs: attrs, primary: primary, comparator: null, compRange: null };
            }

            return calcForRange(compRange, attrs).then(function (comparator) {
                return { attrs: attrs, primary: primary, comparator: comparator, compRange: compRange };
            }).catch(function () {
                return { attrs: attrs, primary: primary, comparator: null, compRange: null };
            });
        });
    }).then(function (result) {
        if (token !== self._calcToken) return;
        if (!result || !result.primary || !result.primary.ok) {
            renderLatestValueFallback();
            return;
        }

        renderComputedResult(mode, def, range, result.attrs, result.primary, result.comparator, result.compRange);
    }).catch(function () {
        if (token === self._calcToken) {
            renderLatestValueFallback();
        }
    });
}

function renderComputedResult(mode, def, range, attrs, primary, comparator, compRange) {
    var value;
    if (mode === 'revenue') {
        // Prefer the pre-computed LKR value (historically accurate tariff).
        // Fall back to kWh × current tariff for the legacy path or when LKR key is missing.
        if (primary.fromPrecomputed && isFiniteNumber(primary.revenueLossLkr) && primary.revenueLossLkr >= 0) {
            value = primary.revenueLossLkr;
        } else {
            value = primary.grossLossKWh * attrs.tariffRate;
            primary.revenueLossLkr = value;
        }
    } else if (mode === 'curtailRevenue') {
        if (primary.fromPrecomputed && isFiniteNumber(primary.curtailRevenueLossLkr) && primary.curtailRevenueLossLkr >= 0) {
            value = primary.curtailRevenueLossLkr;
        } else {
            value = primary.curtailLossKWh * attrs.tariffRate;
            primary.curtailRevenueLossLkr = value;
        }
    } else {
        value = primary[def.metricKey] / 1000;
    }

    if (!isFiniteNumber(value)) {
        renderLatestValueFallback();
        return;
    }

    var formattedText = formatModeValue(value, def);
    var sev = getSeverity(value, def);
    var $el = self.ctx.$widget;

    $el.find('.js-value').text(formattedText).removeClass('skeleton');
    $el.find('.js-sub').text((self.ctx.settings.customSub || def.sub));
    $el.find('.js-status-dot')
        .removeClass('sev-low sev-moderate sev-high')
        .addClass(sev.cssClass);
    $el.find('.js-status-text').text(sev.label);
    $el.find('.js-footer-label').text(range.label || def.footer);

    renderDelta(def, primary, comparator, compRange);

    if (!self.ctx.settings.tooltipText) {
        var lossRate = getMetricLossRate(def, primary);
        var tip = def.tooltip +
            ' Value: ' + formattedText +
            '. Potential: ' + formatEnergy(primary.potentialEnergyKWh / 1000) +
            '. Loss rate: ' + (lossRate * 100).toFixed(2) + '%.';
        if (mode === 'revenue' || mode === 'curtailRevenue') {
            tip += ' Tariff: ' + attrs.tariffRate + ' LKR/kWh.';
        }
        $el.find('.js-tooltip').text(tip);
    }

    detectChanges();
}

function renderLatestValueFallback() {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;
    var mode = getMode();
    var def = getModeDef(mode);
    var rawVal = getLatestDataValue();

    hideDelta();
    $el.find('.js-footer-label').text(def.footer);

    if (!isFiniteNumber(rawVal)) {
        showPlaceholders();
        return;
    }

    var val = parseFloat(rawVal);
    var formattedText = formatModeValue(val, def);
    var sev = getSeverity(val, def);

    $el.find('.js-value').text(formattedText).removeClass('skeleton');
    $el.find('.js-sub').text(s.customSub || def.sub);
    $el.find('.js-status-dot')
        .removeClass('sev-low sev-moderate sev-high')
        .addClass(sev.cssClass);
    $el.find('.js-status-text').text(sev.label);

    if (!s.tooltipText) {
        $el.find('.js-tooltip').text(def.tooltip + ' Current value: ' + formattedText + '. Severity: ' + sev.label + '.');
    }

    detectChanges();
}

function showPlaceholders() {
    var $el = self.ctx.$widget;
    $el.find('.js-value').text('--').removeClass('skeleton');
    $el.find('.js-status-dot').removeClass('sev-low sev-moderate sev-high');
    $el.find('.js-status-text').text('--');
    hideDelta();
    detectChanges();
}

function setLoadingState(range) {
    var $el = self.ctx.$widget;
    $el.find('.js-value').text('--').addClass('skeleton');
    $el.find('.js-status-dot').removeClass('sev-low sev-moderate sev-high');
    $el.find('.js-status-text').text('CALC');
    $el.find('.js-footer-label').text(range && range.label ? range.label : 'Calculating');
    hideDelta();
}

function renderDelta(def, primary, comparator, compRange) {
    var $el = self.ctx.$widget;
    var $delta = $el.find('.js-delta');

    if (!comparator || !comparator.ok || !compRange) {
        hideDelta();
        return;
    }

    var baseRate = getMetricLossRate(def, comparator);
    var selectedRate = getMetricLossRate(def, primary);
    if (!isFiniteNumber(baseRate) || !isFiniteNumber(selectedRate)) {
        hideDelta();
        return;
    }

    if (baseRate === 0 && selectedRate === 0) {
        $delta.removeClass('delta-good delta-bad').addClass('delta-neutral');
        $el.find('.js-delta-arrow').text('');
        $el.find('.js-delta-value').text('0.0%');
        $el.find('.js-delta-label').text('vs ' + compRange.label);
        $delta.css('visibility', 'visible');
        return;
    }

    if (baseRate <= 0) {
        hideDelta();
        return;
    }

    var pct = ((selectedRate - baseRate) / baseRate) * 100;
    var absPct = Math.abs(pct);
    var cls = 'delta-neutral';
    var arrow = '';
    
    if (absPct >= DELTA_NEUTRAL_PCT) {
        cls = pct <= 0 ? 'delta-good' : 'delta-bad';
        arrow = pct > 0 ? '▲ ' : '▼ ';
    }

    $delta.removeClass('delta-good delta-bad delta-neutral').addClass(cls);
    $el.find('.js-delta-arrow').text(arrow);
    $el.find('.js-delta-value').text(absPct.toFixed(1) + '%');
    $el.find('.js-delta-label').text('vs ' + compRange.label);
    $delta.css('visibility', 'visible');
}

function hideDelta() {
    var $el = self.ctx.$widget;
    $el.find('.js-delta')
        .removeClass('delta-good delta-bad delta-neutral')
        .css('visibility', 'hidden');
}

function getMetricLossRate(def, metrics) {
    if (!metrics || !metrics.potentialEnergyKWh || metrics.potentialEnergyKWh <= 0) return NaN;
    var isCurtail = def.metricKey === 'curtailLossKWh' || def.metricKey === 'curtailRevenueLossLkr';
    var lossKWh = isCurtail ? metrics.curtailLossKWh : metrics.grossLossKWh;
    return lossKWh / metrics.potentialEnergyKWh;
}

function formatModeValue(val, def) {
    var s = self.ctx.settings || {};
    var decimals = (s.decimals !== undefined && s.decimals !== null && s.decimals !== '')
        ? parseInt(s.decimals, 10)
        : 1;
    if (isNaN(decimals)) decimals = 1;

    if (def.isFinancial) {
        return (s.currencySym || 'LKR') + ' ' + autoScale(val, 0);
    }

    return autoScale(val, decimals) + ' ' + (s.energyUnit || 'MWh');
}

function formatEnergy(mwh) {
    if (!isFiniteNumber(mwh)) return '--';
    return autoScale(mwh, 1) + ' MWh';
}

function getSeverity(val, def) {
    var s = self.ctx.settings || {};
    var sevMed = (s.severityMedium !== undefined && s.severityMedium !== null && s.severityMedium !== '')
        ? parseFloat(s.severityMedium)
        : (def.isFinancial ? 50000 : 100);
    var sevHigh = (s.severityHigh !== undefined && s.severityHigh !== null && s.severityHigh !== '')
        ? parseFloat(s.severityHigh)
        : (def.isFinancial ? 200000 : 500);

    if (!isFiniteNumber(sevMed)) sevMed = def.isFinancial ? 50000 : 100;
    if (!isFiniteNumber(sevHigh)) sevHigh = def.isFinancial ? 200000 : 500;

    if (val < sevMed) return { cssClass: 'sev-low', label: 'LOW' };
    if (val < sevHigh) return { cssClass: 'sev-moderate', label: 'MODERATE' };
    return { cssClass: 'sev-high', label: 'HIGH' };
}

function getLatestDataValue() {
    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        return NaN;
    }
    return self.ctx.data[0].data[0][1];
}

// ── Precomputed fast path (server-side aggregated daily/lifetime keys) ────────

/**
 * Read precomputed daily or lifetime loss keys from ThingsBoard.
 *
 * For lifetime ranges: reads six SERVER_SCOPE attributes and returns them directly.
 * For all other ranges: fetches daily timeseries keys over [range.startTs, range.endTs],
 * sums each series (dropping -1 sentinels), and returns a result object with the same
 * shape as calculateLossForRange().
 *
 * Revenue / curtailRevenue: prefers the pre-computed LKR key; falls back to kWh × tariff
 * when the LKR key is missing or zero (e.g. plant had no tariff at compute time).
 *
 * Returns a Promise resolving to:
 *   { ok, grossLossKWh, curtailLossKWh, potentialEnergyKWh, exportedEnergyKWh,
 *     revenueLossLkr, curtailRevenueLossLkr, bucketMs,
 *     fromPrecomputed: true }
 */
function calculateLossForRangePrecomputed(entity, range, attrs) {
    var s = self.ctx.settings || {};
    var prefix = s.lossLifetimeAttrPrefix !== undefined ? s.lossLifetimeAttrPrefix : 'loss_';

    // ── Lifetime: single attribute read ────────────────────────────────────
    if (range.mode === 'lifetime') {
        var lifetimeAttrNames = [
            prefix + 'grid_lifetime_kwh',
            prefix + 'curtail_lifetime_kwh',
            prefix + 'revenue_lifetime_lkr',
            prefix + 'curtail_revenue_lifetime_lkr',
            'potential_energy_lifetime_kwh',
            'exported_energy_lifetime_kwh',
            prefix + 'lifetime_anchor_date',
        ];

        return fetchAttributesWithFallback(entity, lifetimeAttrNames).then(function (attrMap) {
            var gridKwh     = parseFloat(attrMap[prefix + 'grid_lifetime_kwh']);
            var curtailKwh  = parseFloat(attrMap[prefix + 'curtail_lifetime_kwh']);
            var revLkr      = parseFloat(attrMap[prefix + 'revenue_lifetime_lkr']);
            var curtRevLkr  = parseFloat(attrMap[prefix + 'curtail_revenue_lifetime_lkr']);
            var potKwh      = parseFloat(attrMap['potential_energy_lifetime_kwh']);
            var expKwh      = parseFloat(attrMap['exported_energy_lifetime_kwh']);

            var hasPotential = isFiniteNumber(potKwh) && potKwh >= 0;
            var hasGrid      = isFiniteNumber(gridKwh) && gridKwh >= 0;

            // Fall back to kWh × current tariff if LKR key is missing/negative
            if (!isFiniteNumber(revLkr) || revLkr < 0) {
                revLkr = isFiniteNumber(gridKwh) && isFiniteNumber(attrs.tariffRate)
                    ? gridKwh * attrs.tariffRate
                    : NaN;
            }
            if (!isFiniteNumber(curtRevLkr) || curtRevLkr < 0) {
                curtRevLkr = isFiniteNumber(curtailKwh) && isFiniteNumber(attrs.tariffRate)
                    ? curtailKwh * attrs.tariffRate
                    : NaN;
            }

            return {
                ok: hasPotential && hasGrid,
                grossLossKWh:           isFiniteNumber(gridKwh)    ? gridKwh    : 0,
                curtailLossKWh:         isFiniteNumber(curtailKwh) ? curtailKwh : 0,
                potentialEnergyKWh:     isFiniteNumber(potKwh)     ? potKwh     : 0,
                exportedEnergyKWh:      isFiniteNumber(expKwh)     ? expKwh     : 0,
                revenueLossLkr:         revLkr,
                curtailRevenueLossLkr:  curtRevLkr,
                bucketMs: 0,
                fromPrecomputed: true
            };
        });
    }

    // ── Daily: timeseries sum over [startTs, endTs] ─────────────────────────
    var gridKey     = s.lossDailyGridKey          || 'loss_grid_daily_kwh';
    var curtailKey  = s.lossDailyCurtailKey       || 'loss_curtail_daily_kwh';
    var revenueKey  = s.lossDailyRevenueKey       || 'loss_revenue_daily_lkr';
    var curtRevKey  = s.lossDailyCurtailRevenueKey|| 'loss_curtail_revenue_daily_lkr';
    var potKey      = s.lossDailyPotentialKey     || 'potential_energy_daily_kwh';
    var expKey      = s.lossDailyExportedKey      || 'exported_energy_daily_kwh';

    var keysToFetch = uniqueList([gridKey, curtailKey, revenueKey, curtRevKey, potKey, expKey]);
    var startTs = parseInt(range.startTs, 10);
    var endTs   = parseInt(range.endTs, 10);

    // Daily keys are pre-aggregated (one record per day); fetch raw (agg=NONE)
    return fetchTimeseriesChunked(entity, keysToFetch, startTs, endTs, null, false)
        .then(function (raw) {
            function sumKey(key) {
                var records = raw[key] || [];
                var total = 0;
                var hasValid = false;
                for (var i = 0; i < records.length; i++) {
                    var v = parseFloat(records[i].value);
                    if (isFiniteNumber(v) && v >= 0) {
                        total += v;
                        hasValid = true;
                    }
                }
                return hasValid ? total : -1;
            }

            var gridKwh    = sumKey(gridKey);
            var curtailKwh = sumKey(curtailKey);
            var revLkr     = sumKey(revenueKey);
            var curtRevLkr = sumKey(curtRevKey);
            var potKwh     = sumKey(potKey);
            var expKwh     = sumKey(expKey);

            var hasPotential = potKwh >= 0;
            var hasGrid      = gridKwh >= 0;

            // Fall back to kWh × current tariff when LKR key is missing/sentinel
            if (revLkr < 0) {
                revLkr = gridKwh >= 0 && isFiniteNumber(attrs.tariffRate)
                    ? gridKwh * attrs.tariffRate
                    : NaN;
            }
            if (curtRevLkr < 0) {
                curtRevLkr = curtailKwh >= 0 && isFiniteNumber(attrs.tariffRate)
                    ? curtailKwh * attrs.tariffRate
                    : NaN;
            }

            return {
                ok: hasPotential && hasGrid,
                grossLossKWh:           gridKwh    >= 0 ? gridKwh    : 0,
                curtailLossKWh:         curtailKwh >= 0 ? curtailKwh : 0,
                potentialEnergyKWh:     potKwh     >= 0 ? potKwh     : 0,
                exportedEnergyKWh:      expKwh     >= 0 ? expKwh     : 0,
                revenueLossLkr:         revLkr,
                curtailRevenueLossLkr:  curtRevLkr,
                bucketMs: 0,
                fromPrecomputed: true
            };
        });
}

/**
 * Return true when range.mode === 'day' AND the start date is today (current calendar day).
 * These ranges bypass the precomputed path and use per-minute fetch.
 */
function isCurrentDay(range) {
    if (!range || range.mode !== 'day') return false;
    var rangeStart = new Date(parseInt(range.startTs, 10));
    var today = new Date();
    return rangeStart.getFullYear() === today.getFullYear() &&
           rangeStart.getMonth()    === today.getMonth()    &&
           rangeStart.getDate()     === today.getDate();
}

function calculateLossForRange(entity, range, attrs) {
    var s = self.ctx.settings || {};
    var actualKeys = parseCommaList(s.actualPowerKeys || 'active_power');
    var potentialKeys = parseCommaList(s.potentialPowerKeys || 'potential_power');
    var setpointKeys = parseCommaList(s.setpointKeys || 'setpoint_active_power, curtailment_limit, power_limit');
    var startTs = parseInt(range.startTs, 10);
    var endTs = parseInt(range.endTs, 10);

    if (!actualKeys.length || !potentialKeys.length || !isFinite(startTs) || !isFinite(endTs) || endTs <= startTs) {
        return Promise.resolve({ ok: false });
    }

    var bucketMs = getBucketMsForRange(range);
    var powerKeys = uniqueList(actualKeys.concat(potentialKeys));
    var setpointStartTs = Math.max(0, startTs - (30 * 24 * 60 * 60 * 1000));

    return Promise.all([
        fetchPowerTimeseries(entity, powerKeys, startTs, endTs, bucketMs),
        setpointKeys.length ? fetchRawTimeseries(entity, setpointKeys, setpointStartTs, endTs) : Promise.resolve({})
    ]).then(function (results) {
        var powerData = results[0] || {};
        var setpointData = results[1] || {};
        var actualSeries = getFirstMatchingSeries(powerData, actualKeys);
        var potentialSeries = getFirstMatchingSeries(powerData, potentialKeys);
        var setpointSeries = getFirstMatchingSeries(setpointData, setpointKeys) || [];

        if (!actualSeries || !actualSeries.length) {
            return { ok: false };
        }

        var exportedKw = bucketAverage(actualSeries, startTs, endTs, bucketMs, false);
        var potentialKw = bucketAverage(potentialSeries || [], startTs, endTs, bucketMs, true);
        var capacityKw = capacityToKw(attrs.capacity, s.capacityUnit || 'kW');
        if (!isFiniteNumber(capacityKw) || capacityKw <= 0) {
            capacityKw = parseFloat(s.fallbackPower) || 1000;
        }

        var N = exportedKw.length;
        if (potentialKw.length < N) potentialKw.length = N;
        
        var hasAnyPotential = false;
        for (var pi = 0; pi < potentialKw.length; pi++) {
            if (potentialKw[pi] !== null && potentialKw[pi] !== undefined) {
                hasAnyPotential = true;
                break;
            }
        }

        if (!hasAnyPotential) {
            var firstOn = -1, lastOn = -1;
            var thresholdKw = capacityKw * 0.01;
            for (var k = 0; k < exportedKw.length; k++) {
                if (exportedKw[k] != null && exportedKw[k] > thresholdKw) {
                    if (firstOn === -1) firstOn = k;
                    lastOn = k;
                }
            }
            if (firstOn >= 0 && lastOn >= firstOn) {
                var span = lastOn - firstOn;
                for (var j = 0; j < exportedKw.length; j++) {
                    if (j >= firstOn && j <= lastOn) {
                        if (lastOn === firstOn) {
                            potentialKw[j] = Math.max(capacityKw * 0.01, 0);
                        } else {
                            var frac = (j - firstOn) / span;
                            potentialKw[j] = capacityKw * Math.sin(frac * Math.PI);
                        }
                    }
                }
            }
        }

        var hPerBucket = bucketMs / 3600000;

        setpointSeries.sort(function (a, b) {
            return parseInt(a.ts, 10) - parseInt(b.ts, 10);
        });

        var grossLossKWh = 0;
        var curtailLossKWh = 0;
        var potentialEnergyKWh = 0;
        var exportedEnergyKWh = 0;
        var hasActual = false;
        var hasPotential = false;

        for (var i = 0; i < N; i++) {
            var potV = i < potentialKw.length ? potentialKw[i] : null;
            var expV = i < exportedKw.length ? exportedKw[i] : null;

            if (expV != null) {
                hasActual = true;
                exportedEnergyKWh += expV * hPerBucket;
            }

            if (potV != null) {
                hasPotential = true;
                potentialEnergyKWh += potV * hPerBucket;
            }

            if (potV != null && expV != null) {
                grossLossKWh += Math.max(potV - expV, 0) * hPerBucket;

                var midTs = startTs + ((i + 0.5) * bucketMs);
                var spPct = getSetpointPct(setpointSeries, midTs);
                if (spPct < 99.5) {
                    var ceilingKw = capacityKw * (spPct / 100);
                    var curtailBaseKw = Math.max(ceilingKw, expV);
                    curtailLossKWh += Math.max(potV - curtailBaseKw, 0) * hPerBucket;
                }
            }
        }

        return {
            ok: hasActual && hasPotential && potentialEnergyKWh > 0,
            grossLossKWh: grossLossKWh,
            curtailLossKWh: curtailLossKWh,
            potentialEnergyKWh: potentialEnergyKWh,
            exportedEnergyKWh: exportedEnergyKWh,
            bucketMs: bucketMs
        };
    });
}

function bucketAverage(series, startTs, endTs, bucketMs, skipNegative) {
    var N = Math.max(1, Math.ceil((endTs - startTs) / bucketMs));
    var sum = new Array(N).fill(0);
    var hits = new Array(N).fill(0);
    var out = new Array(N).fill(null);

    for (var i = 0; i < series.length; i++) {
        var ts = parseInt(series[i].ts, 10);
        var val = parseFloat(series[i].value);
        if (!isFinite(ts) || !isFiniteNumber(val) || ts < startTs || ts > endTs) continue;
        if (skipNegative && val < 0) continue;
        var idx = Math.min(Math.floor((ts - startTs) / bucketMs), N - 1);
        sum[idx] += val;
        hits[idx] += 1;
    }

    for (var b = 0; b < N; b++) {
        out[b] = hits[b] > 0 ? (sum[b] / hits[b]) : null;
    }
    return out;
}

function getSetpointPct(series, ts) {
    if (!series || !series.length) return 100;
    var last = 100;
    for (var i = 0; i < series.length; i++) {
        var rowTs = parseInt(series[i].ts, 10);
        if (rowTs <= ts) {
            var v = parseFloat(series[i].value);
            if (isFiniteNumber(v)) last = v;
        } else {
            break;
        }
    }
    return isFiniteNumber(last) ? last : 100;
}

function getBucketMsForRange(range) {
    var diff = parseInt(range.endTs, 10) - parseInt(range.startTs, 10);
    if (diff <= 86400000 * 1.05) return 5 * 60000;
    if (diff <= 86400000 * 7.05) return 10 * 60000;
    return 15 * 60000;
}

function fetchCalculationAttributes(entity) {
    var s = self.ctx.settings || {};
    var keys = uniqueList([
        s.plantCapacityKey || 'Capacity',
        s.tariffAttributeKey || 'tariff_rate_lkr'
    ]);

    return fetchAttributesWithFallback(entity, keys).then(function (attrs) {
        return {
            capacity: getAttr(attrs, s.plantCapacityKey || 'Capacity'),
            tariffRate: parseFloat(getAttr(attrs, s.tariffAttributeKey || 'tariff_rate_lkr'))
        };
    });
}

function fetchAttributesWithFallback(entity, keys) {
    return fetchScopedAttributes(entity, 'SERVER_SCOPE', keys).then(function (serverAttrs) {
        var missing = [];
        for (var i = 0; i < keys.length; i++) {
            if (getAttr(serverAttrs, keys[i]) === undefined) missing.push(keys[i]);
        }
        if (!missing.length) return serverAttrs;

        return fetchScopedAttributes(entity, 'SHARED_SCOPE', missing).then(function (sharedAttrs) {
            for (var j = 0; j < missing.length; j++) {
                var key = missing[j];
                if (getAttr(sharedAttrs, key) !== undefined && getAttr(serverAttrs, key) === undefined) {
                    serverAttrs[key] = getAttr(sharedAttrs, key);
                }
            }
            return serverAttrs;
        });
    });
}

function fetchScopedAttributes(entity, scope, keys) {
    if (!entity || !entity.id || !keys || !keys.length) return Promise.resolve({});

    var attrSvc = self.ctx.attributeService;
    var entObj = { id: entity.id, entityType: entity.type };
    if (attrSvc && typeof attrSvc.getEntityAttributes === 'function') {
        return new Promise(function (resolve) {
            try {
                attrSvc.getEntityAttributes(entObj, scope, keys).subscribe(function (data) {
                    resolve(attributeArrayToMap(data));
                }, function () {
                    resolve({});
                });
            } catch (e) {
                resolve({});
            }
        });
    }

    var url = '/api/plugins/telemetry/' + encodeURIComponent(entity.type) + '/' + entity.id +
        '/values/attributes/' + scope + '?keys=' + encodeURIComponent(keys.join(','));
    return tbGet(url).then(attributeArrayToMap).catch(function () {
        return {};
    });
}

function attributeArrayToMap(data) {
    var out = {};
    if (!Array.isArray(data)) return out;
    for (var i = 0; i < data.length; i++) {
        if (data[i] && data[i].key !== undefined) {
            out[data[i].key] = data[i].value;
        }
    }
    return out;
}

function getAttr(attrs, key) {
    if (!attrs || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(attrs, key)) return attrs[key];
    var wanted = String(key).toLowerCase();
    for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k) && String(k).toLowerCase() === wanted) {
            return attrs[k];
        }
    }
    return undefined;
}

function fetchRawTimeseries(entity, keys, startTs, endTs) {
    return fetchTimeseriesChunked(entity, keys, startTs, endTs, null, false);
}

function fetchPowerTimeseries(entity, keys, startTs, endTs, bucketMs) {
    return fetchTimeseriesChunked(entity, keys, startTs, endTs, bucketMs, true);
}

function fetchTimeseriesChunked(entity, keys, startTs, endTs, bucketMs, useAgg) {
    if (!entity || !entity.id || !keys || !keys.length) return Promise.resolve({});
    var encodedKeys = keys.map(function (k) {
        return encodeURIComponent(k);
    }).join(',');

    var maxBucketsPerChunk = 700;
    var chunkMs = useAgg ? (maxBucketsPerChunk * bucketMs) : RAW_CHUNK_MS;
    var promises = [];

    for (var cursor = startTs; cursor < endTs; cursor += chunkMs) {
        var chunkEnd = Math.min(endTs, cursor + chunkMs);
        var url = '/api/plugins/telemetry/' + entity.type + '/' + entity.id +
            '/values/timeseries?keys=' + encodedKeys +
            '&startTs=' + cursor + '&endTs=' + chunkEnd +
            '&limit=' + TB_RAW_LIMIT;
            
        if (useAgg) {
            url += '&interval=' + bucketMs + '&agg=AVG';
        } else {
            url += '&agg=NONE';
        }
        promises.push(tbGet(url));
    }

    return Promise.all(promises).then(function(results) {
        var merged = {};
        for (var i = 0; i < results.length; i++) {
            mergeTimeseries(merged, results[i] || {});
        }
        return merged;
    });
}

function getAggIntervalCount(startTs, endTs, intervalMs) {
    if (!intervalMs || intervalMs <= 0) return Infinity;
    return Math.ceil(Math.max((endTs - startTs), 1) / intervalMs);
}

function mergeTimeseries(target, source) {
    for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        if (!target[key]) target[key] = [];
        if (Array.isArray(source[key])) {
            target[key] = target[key].concat(source[key]);
        }
    }
}

function tbGet(url) {
    return new Promise(function (resolve, reject) {
        try {
            self.ctx.http.get(url).subscribe(resolve, reject);
        } catch (e) {
            reject(e);
        }
    });
}

function resolveEntity() {
    if (self.ctx.datasources && self.ctx.datasources.length) {
        for (var i = 0; i < self.ctx.datasources.length; i++) {
            var ds = self.ctx.datasources[i];
            if (!ds) continue;
            var eid = ds.entityId;
            var etype = ds.entityType || (eid && eid.entityType);
            if (eid && etype) {
                return {
                    id: typeof eid === 'object' ? eid.id : eid,
                    type: typeof etype === 'string' ? etype : (eid.entityType || 'ASSET')
                };
            }
        }
    }

    try {
        var params = getStateParams();
        var sel = params.SelectedAsset;
        if (typeof sel === 'string') sel = safeParseJson(sel);
        if (sel) {
            if (sel.entityType && sel.id) return { id: sel.id, type: sel.entityType };
            if (sel.entityId) return { id: sel.entityId.id, type: sel.entityId.entityType };
        }
    } catch (e) {}

    return null;
}

function setupRangeSelector() {
    var range = getActiveRange();
    renderSelectorRange(range);
    bindRangeSelector();
}

function bindRangeSelector() {
    if (self._rangeBound) return;
    self._rangeBound = true;

    var $el = self.ctx.$widget;

    $el.find('.js-range-mode-select').on('change', function () {
        var mode = $(this).val();
        if (!mode) return;

        if (mode === 'lifetime') {
            buildLifetimeRangeFromEntity().then(pushRange);
        } else if (mode === 'day') {
            var dayValue = $el.find('.js-day-input').val() || formatDateInput(new Date());
            pushRange(buildDayRange(parseDateInput(dayValue)));
        } else if (mode === 'month') {
            var monthValue = $el.find('.js-month-input').val() || formatMonthInput(new Date());
            pushRange(buildMonthRange(parseMonthInput(monthValue)));
        } else if (mode === 'year') {
            var y = parseInt($el.find('.js-year-input').val(), 10) || new Date().getFullYear();
            pushRange(buildYearRange(new Date(y, 0, 1)));
        } else if (mode === 'custom') {
            var custom = getCustomRangeFromInputs();
            if (!custom) {
                custom = buildDefaultCustomRange();
                $el.find('.js-custom-start').val(formatDateInput(new Date(custom.startTs)));
                $el.find('.js-custom-end').val(formatDateInput(new Date(custom.endTs)));
            }
            if (custom) pushRange(custom);
        }
    });

    $el.find('.js-day-input').on('change', function () {
        var d = parseDateInput($(this).val());
        if (d) pushRange(buildDayRange(d));
    });

    $el.find('.js-month-input').on('change', function () {
        var d = parseMonthInput($(this).val());
        if (d) pushRange(buildMonthRange(d));
    });

    $el.find('.js-year-input').on('change', function () {
        var y = parseInt($(this).val(), 10);
        if (isFinite(y) && y > 1990 && y < 2100) pushRange(buildYearRange(new Date(y, 0, 1)));
    });

    $el.find('.js-custom-start, .js-custom-end').on('change', function () {
        var custom = getCustomRangeFromInputs();
        if (custom) pushRange(custom);
    });
}

function renderSelectorRange(range) {
    var $el = self.ctx.$widget;
    var mode = range && range.mode ? range.mode : 'month';
    var start = new Date(range.startTs || Date.now());

    $el.find('.js-range-mode-select').val(mode);
    $el.find('.js-footer-label').text(range.label || 'Shared Range');
    $el.find('.js-status-dot').removeClass('sev-low sev-moderate sev-high').addClass('sev-low');
    $el.find('.js-status-text').text('SYNC');

    $el.find('.range-input').hide();
    if (mode === 'day') {
        $el.find('.js-day-input').val(formatDateInput(start)).show();
    } else if (mode === 'month') {
        $el.find('.js-month-input').val(formatMonthInput(start)).show();
    } else if (mode === 'year') {
        $el.find('.js-year-input').val(start.getFullYear()).show();
    } else if (mode === 'custom') {
        $el.find('.js-custom-start').val(formatDateInput(start)).show();
        $el.find('.js-custom-end').val(formatDateInput(new Date(range.endTs || Date.now()))).show();
    }

    if (!self.ctx.settings.tooltipText) {
        $el.find('.js-tooltip').text('Shared Loss Attribution range: ' + (range.label || 'Current Month') + '.');
    }

    detectChanges();
}

function pushRange(range) {
    if (!range) return;
    range.updatedAt = Date.now();
    storeRangeLocal(range);
    renderSelectorRange(range);

    try {
        window.dispatchEvent(new CustomEvent('loss-range-changed', { detail: range }));
    } catch(e) {}

    var sc = self.ctx.stateController;
    if (!sc) return;

    try {
        var params = {};
        var currentParams = getStateParams();
        for (var key in currentParams) {
            if (Object.prototype.hasOwnProperty.call(currentParams, key)) {
                params[key] = currentParams[key];
            }
        }
        params[LOSS_RANGE_PARAM] = range;

        var currentState = sc.getStateId ? sc.getStateId() : null;
        if (currentState && typeof sc.openState === 'function') {
            sc.openState(currentState, params, false);
        } else if (typeof sc.updateState === 'function') {
            sc.updateState(currentState, params, false);
        }
    } catch (e) {}
}

function getActiveRange() {
    var ranges = [];
    
    if (self._activeRangeOverride) {
        ranges.push(normalizeRange(self._activeRangeOverride));
    }
    
    var params = getStateParams();
    var raw = params ? params[LOSS_RANGE_PARAM] : null;
    var parsedParam = normalizeRange(typeof raw === 'string' ? safeParseJson(raw) : raw);
    if (parsedParam) ranges.push(parsedParam);
    
    var parsedLocal = normalizeRange(readRangeLocal());
    if (parsedLocal) ranges.push(parsedLocal);
    
    ranges = ranges.filter(Boolean);
    if (ranges.length > 0) {
        // Sort by updatedAt descending to pick the absolute newest
        ranges.sort(function(a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        return ranges[0];
    }

    return buildMonthRange(new Date());
}

function getComparatorRange(range) {
    if (!range || range.mode === 'lifetime') return null;
    var start = new Date(range.startTs);

    if (range.mode === 'day') {
        if (isSameDay(start, new Date())) {
            var prevDay = new Date(start.getTime());
            prevDay.setDate(prevDay.getDate() - 1);
            return buildDayRange(prevDay, 'Last Day');
        }
        return buildDayRange(new Date(), 'Current Day');
    }

    if (range.mode === 'month') {
        if (isSameMonth(start, new Date())) {
            var prevMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1);
            return buildMonthRange(prevMonth, 'Last Month');
        }
        return buildMonthRange(new Date(), 'Current Month');
    }

    if (range.mode === 'year') {
        if (start.getFullYear() === new Date().getFullYear()) {
            return buildYearRange(new Date(start.getFullYear() - 1, 0, 1), 'Last Year');
        }
        return buildYearRange(new Date(), 'Current Year');
    }

    if (range.mode === 'custom') {
        var span = Math.max(1, range.endTs - range.startTs);
        return {
            mode: 'custom',
            startTs: range.startTs - span,
            endTs: range.startTs - 1,
            label: 'Previous Range',
            updatedAt: Date.now()
        };
    }

    return null;
}

function normalizeRange(range) {
    if (!range) return null;
    var startTs = parseInt(range.startTs, 10);
    var endTs = parseInt(range.endTs, 10);
    var mode = range.mode || 'month';
    if (!isFinite(startTs) || !isFinite(endTs) || endTs <= startTs) return null;
    return {
        mode: mode,
        startTs: startTs,
        endTs: endTs,
        label: range.label || buildRangeLabel(mode, startTs, endTs),
        updatedAt: parseInt(range.updatedAt, 10) || Date.now()
    };
}

function buildDayRange(date, labelOverride) {
    var d = date || new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SOLAR_DAY_START_HOUR, 0, 0, 0);
    var end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SOLAR_DAY_END_HOUR, 0, 0, 0);
    var label = labelOverride || (isSameDay(d, new Date()) ? 'Today' : formatDateInput(d));
    return { mode: 'day', startTs: start.getTime(), endTs: end.getTime(), label: label, updatedAt: Date.now() };
}

function buildMonthRange(date, labelOverride) {
    var d = date || new Date();
    var now = new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    var end = isSameMonth(d, now)
        ? now
        : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    var label = labelOverride || (isSameMonth(d, now) ? 'Current Month' : formatMonthLabel(d));
    return { mode: 'month', startTs: start.getTime(), endTs: end.getTime(), label: label, updatedAt: Date.now() };
}

function buildYearRange(date, labelOverride) {
    var d = date || new Date();
    var now = new Date();
    var start = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
    var end = d.getFullYear() === now.getFullYear()
        ? now
        : new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
    var label = labelOverride || (d.getFullYear() === now.getFullYear() ? 'Current Year' : String(d.getFullYear()));
    return { mode: 'year', startTs: start.getTime(), endTs: end.getTime(), label: label, updatedAt: Date.now() };
}

function buildLifetimeRange() {
    var s = self.ctx.settings || {};
    var startStr = s.lifetimeStartDate || '2020-10-01';
    return buildLifetimeRangeFromStart(startStr);
}

function buildLifetimeRangeFromEntity() {
    var s = self.ctx.settings || {};
    var entity = resolveEntity();
    var key = s.lifetimeStartAttributeKey || 'commissioning_date';
    if (!entity || !key) return Promise.resolve(buildLifetimeRange());

    return fetchAttributesWithFallback(entity, [key]).then(function (attrs) {
        var attrValue = getAttr(attrs, key);
        return buildLifetimeRangeFromStart(attrValue || s.lifetimeStartDate || '2020-10-01');
    }).catch(function () {
        return buildLifetimeRange();
    });
}

function buildLifetimeRangeFromStart(startStr) {
    var start = isFiniteNumber(startStr) ? new Date(parseFloat(startStr)) : parseDateInput(startStr);
    if (!start || isNaN(start.getTime())) start = new Date(2020, 9, 1);
    start.setHours(0, 0, 0, 0);
    return {
        mode: 'lifetime',
        startTs: start.getTime(),
        endTs: Date.now(),
        label: 'Lifetime',
        updatedAt: Date.now()
    };
}

function buildDefaultCustomRange() {
    var end = new Date();
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return {
        mode: 'custom',
        startTs: start.getTime(),
        endTs: end.getTime(),
        label: formatDateInput(start) + ' to ' + formatDateInput(end),
        updatedAt: Date.now()
    };
}

function getCustomRangeFromInputs() {
    var $el = self.ctx.$widget;
    var start = parseDateInput($el.find('.js-custom-start').val());
    var end = parseDateInput($el.find('.js-custom-end').val());
    if (!start || !end) return null;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    if (end.getTime() <= start.getTime()) return null;
    return {
        mode: 'custom',
        startTs: start.getTime(),
        endTs: end.getTime(),
        label: formatDateInput(start) + ' to ' + formatDateInput(end),
        updatedAt: Date.now()
    };
}

function buildRangeLabel(mode, startTs, endTs) {
    var start = new Date(startTs);
    var end = new Date(endTs);
    if (mode === 'day') return isSameDay(start, new Date()) ? 'Today' : formatDateInput(start);
    if (mode === 'month') return isSameMonth(start, new Date()) ? 'Current Month' : formatMonthLabel(start);
    if (mode === 'year') return start.getFullYear() === new Date().getFullYear() ? 'Current Year' : String(start.getFullYear());
    if (mode === 'lifetime') return 'Lifetime';
    return formatDateInput(start) + ' to ' + formatDateInput(end);
}

function getStateParams() {
    try {
        return self.ctx.stateController &&
            typeof self.ctx.stateController.getStateParams === 'function'
            ? (self.ctx.stateController.getStateParams() || {})
            : {};
    } catch (e) {
        return {};
    }
}

function storeRangeLocal(range) {
    try {
        localStorage.setItem('tb_loss_attribution_range', JSON.stringify(range));
    } catch (e) {}
}

function readRangeLocal() {
    try {
        return safeParseJson(localStorage.getItem('tb_loss_attribution_range'));
    } catch (e) {
        return null;
    }
}

function safeParseJson(value) {
    if (!value || typeof value !== 'string') return value || null;
    try {
        return JSON.parse(value);
    } catch (e) {
        return null;
    }
}

function parseCommaList(str) {
    if (!str) return [];
    return String(str).split(',').map(function (k) {
        return k.trim();
    }).filter(function (k) {
        return k.length > 0;
    });
}

function uniqueList(values) {
    var out = [];
    var seen = {};
    (values || []).forEach(function (v) {
        if (!v || seen[v]) return;
        seen[v] = true;
        out.push(v);
    });
    return out;
}

function getFirstMatchingSeries(rawData, keys) {
    if (!rawData) return null;
    for (var i = 0; i < keys.length; i++) {
        if (rawData[keys[i]] && rawData[keys[i]].length) {
            return rawData[keys[i]];
        }
    }
    return null;
}

function capacityToKw(capacityValue, capacityUnit) {
    var cap = parseFloat(capacityValue);
    if (!isFiniteNumber(cap) || cap <= 0) return NaN;
    return capacityUnit === 'MW' ? cap * 1000 : cap;
}

function autoScale(val, decimals) {
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
}

function isFiniteNumber(value) {
    return value !== null && value !== undefined && !isNaN(parseFloat(value)) && isFinite(parseFloat(value));
}

function parseDateInput(value) {
    if (!value) return null;
    var parts = String(value).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    return new Date(y, m, d);
}

function parseMonthInput(value) {
    if (!value) return null;
    var parts = String(value).split('-');
    if (parts.length !== 2) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    if (!isFinite(y) || !isFinite(m)) return null;
    return new Date(y, m, 1);
}

function formatDateInput(date) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

function formatMonthInput(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

function formatMonthLabel(date) {
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[date.getMonth()] + ' ' + date.getFullYear();
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function isSameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth();
}

function detectChanges() {
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
}

self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.loss-card');
    var h = $el.height();
    var w = $el.width();
    var selector = getMode() === 'rangeSelector';
    var fromHeight = selector ? (h - 8) / 8.2 : (h - 8) / 5.8;
    var fromWidth = selector ? w / 12 : w / 10;
    var fontSize = Math.min(fromHeight, fromWidth);

    if (fontSize < 8) fontSize = 8;
    if (fontSize > 32) fontSize = 32;
    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
    if (self._calcTimer) {
        clearTimeout(self._calcTimer);
        self._calcTimer = null;
    }
    self._calcToken++;
    if (self._onRangeChanged) {
        window.removeEventListener('loss-range-changed', self._onRangeChanged);
    }
};
