// Loss Attribution Unified Panel
// ThingsBoard v4.3.0 PE | Latest Values
// Single fetch cycle drives all four metric sections simultaneously.
// Calculation engine functions are direct copies from Loss Attribution v1.

var LOSS_RANGE_PARAM   = 'LossAttributionRange';
var TB_MAX_AVG_INTERVALS = 720;
var TB_RAW_LIMIT       = 50000;
var RAW_CHUNK_MS       = 31 * 24 * 60 * 60 * 1000;
var DELTA_NEUTRAL_PCT  = 0.1;

// ── Mode definitions ─────────────────────────────────────────────
var MODES = {
    grid: {
        title: 'GRID AVAILABILITY LOSS', sub: 'Due to Grid Outage',
        footer: 'Operational Loss – Grid', isFinancial: false,
        metricKey: 'grossLossKWh', isCurtail: false
    },
    curtail: {
        title: 'CURTAILMENT LOSS', sub: 'Export Limits Imposed',
        footer: 'Operational Loss – Curtailment', isFinancial: false,
        metricKey: 'curtailLossKWh', isCurtail: true
    },
    revenue: {
        title: 'REVENUE LOSS', sub: 'Tariff Rated Loss',
        footer: 'Financial Loss – Revenue', isFinancial: true,
        metricKey: 'revenueLossLkr', isCurtail: false
    },
    curtailRevenue: {
        title: 'CURTAILMENT REVENUE LOSS', sub: 'Financial Impact of Limits',
        footer: 'Financial Loss – Curtailment', isFinancial: true,
        metricKey: 'curtailRevenueLossLkr', isCurtail: true
    }
};

// ── Lifecycle ────────────────────────────────────────────────────
self.onInit = function () {
    self.ctx.settings    = self.ctx.settings || {};
    self.ctx.$widget     = $(self.ctx.$container);
    self._calcToken      = 0;
    self._hasRendered    = false;
    self._activeRange    = null;
    self._activeEntityKey = null;
    self._cachedAttrs    = null;
    self._refreshTimer   = null;
    self._refreshTimerInterval = null;
    self._visibilityHandler = null;
    self._activeRangeOverride = null;
    self._rangeBound     = false;

    var s0 = self.ctx.settings;
    var pollMin = parseFloat(s0.pollIntervalMinutes);
    self._POLL_INTERVAL_MS = (isFinite(pollMin) && pollMin >= 1 ? pollMin : 30) * 60 * 1000;
    var attrMin = parseFloat(s0.attrCacheMinutes);
    self._ATTR_TTL_MS = (isFinite(attrMin) && attrMin >= 1 ? attrMin : 30) * 60 * 1000;

    self._onRangeChanged = function (e) {
        if (!e || !e.detail) return;
        self._activeRangeOverride = e.detail;
        storeRangeLocal(e.detail);
        clearRefreshTimer();
        fetchAndRenderAll({ silent: false });
        ensureRefreshTimer();
    };
    window.addEventListener('loss-range-changed', self._onRangeChanged);

    initRangeSelector();
    self.onResize();
    self.onDataUpdated();
};

self.onDataUpdated = function () {
    ensureRefreshTimer();
};

self.onResize = function () {
    var $el = self.ctx.$widget;
    var h = $el.height();
    var w = $el.width();
    // Each section is ~1/5 of total width; scale font to section size
    var sectionW = w / 5.2;
    var fromH = (h - 8) / 5.8;
    var fromW = sectionW / 9.5;
    var fs = Math.min(fromH, fromW);
    if (fs < 7)  fs = 7;
    if (fs > 30) fs = 30;
    $el.find('.lau-panel').css('font-size', fs + 'px');
};

self.onDestroy = function () {
    self._calcToken++;
    clearRefreshTimer();
    if (self._onRangeChanged)
        window.removeEventListener('loss-range-changed', self._onRangeChanged);
    if (self._visibilityHandler)
        document.removeEventListener('visibilitychange', self._visibilityHandler);
};

// ── Refresh timer ────────────────────────────────────────────────
function rangeIncludesToday(range) {
    if (!range) return false;
    if (range.mode === 'lifetime') return true;
    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
    return parseInt(range.endTs, 10) >= todayStart.getTime();
}

// Returns the correct poll interval based on range mode:
//   day      → 1 hour   (data changes as generation accumulates)
//   month    → 24 hours (daily rollup updates once per day)
//   year / lifetime → 30 days (monthly rollup updates once per month)
function getPollIntervalMs(range) {
    var mode = range && range.mode ? range.mode : 'month';
    if (mode === 'day')                        return 60 * 60 * 1000;          // 1 h
    if (mode === 'month')                      return 24 * 60 * 60 * 1000;     // 24 h
    if (mode === 'year' || mode === 'lifetime') return 30 * 24 * 60 * 60 * 1000; // 30 d
    // custom: use day cadence for ranges ≤2 days, month cadence otherwise
    var span = (parseInt((range || {}).endTs, 10) - parseInt((range || {}).startTs, 10));
    return span <= 2 * 86400000 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function ensureRefreshTimer() {
    if (!self._hasRendered) {
        fetchAndRenderAll({ silent: false });
        return;
    }
    var range = getActiveRange();
    if (!rangeIncludesToday(range)) return;

    var intervalMs = getPollIntervalMs(range);

    // If timer is already running for the same interval, leave it
    if (self._refreshTimer && self._refreshTimerInterval === intervalMs) return;

    // Mode changed mid-session → restart with new interval
    clearRefreshTimer();

    self._refreshTimerInterval = intervalMs;
    self._refreshTimer = setInterval(function () {
        if (document.visibilityState === 'hidden') return;
        var cur = getActiveRange();
        if (!rangeIncludesToday(cur)) { clearRefreshTimer(); return; }
        // If range mode changed, restart timer at new cadence on next ensureRefreshTimer call
        var newInterval = getPollIntervalMs(cur);
        if (newInterval !== self._refreshTimerInterval) {
            clearRefreshTimer();
            ensureRefreshTimer();
            return;
        }
        fetchAndRenderAll({ silent: true });
    }, intervalMs);

    if (!self._visibilityHandler) {
        self._visibilityHandler = function () {
            if (document.visibilityState === 'visible' && rangeIncludesToday(getActiveRange()))
                fetchAndRenderAll({ silent: true });
        };
        document.addEventListener('visibilitychange', self._visibilityHandler);
    }
}

function clearRefreshTimer() {
    if (self._refreshTimer) { clearInterval(self._refreshTimer); self._refreshTimer = null; }
    self._refreshTimerInterval = null;
}

// ── Core fetch & render ──────────────────────────────────────────
function fetchAndRenderAll(opts) {
    opts = opts || {};
    var silent  = !!opts.silent;
    var token   = ++self._calcToken;
    var entity  = resolveEntity();
    var range   = getActiveRange();

    renderRangeSelector(range);

    if (!entity || !entity.id) {
        setAllSectionsPlaceholder();
        return;
    }

    var entityKey = (entity.type || 'ASSET') + ':' + entity.id;
    var rangeKey  = range.mode + ':' + range.startTs + ':' + range.endTs;
    var changed   = (self._activeEntityKey !== entityKey) || (self._activeRange !== rangeKey);

    if (!silent && (!self._hasRendered || changed))
        setAllSectionsLoading(range);

    var s = self.ctx.settings || {};
    var useNew = s.useNewLossKeys !== undefined ? s.useNewLossKeys : 'auto';

    function calcForRange(rangeObj, attrs) {
        if (useNew === 'off')   return calculateLossForRange(entity, rangeObj, attrs);
        if (useNew === 'force') return calculateLossForRangePrecomputed(entity, rangeObj, attrs);
        return calculateLossForRangePrecomputed(entity, rangeObj, attrs).then(function (pre) {
            if (pre && pre.ok) return pre;
            if (legacyFallbackAllowed(rangeObj)) return calculateLossForRange(entity, rangeObj, attrs);
            return { ok: false, tooLargeForLegacy: true };
        }).catch(function () {
            return legacyFallbackAllowed(rangeObj)
                ? calculateLossForRange(entity, rangeObj, attrs)
                : { ok: false, tooLargeForLegacy: true };
        });
    }

    function legacyFallbackAllowed(rangeObj) {
        if (!rangeObj) return true;
        if (rangeObj.mode === 'day' || rangeObj.mode === 'month') return true;
        if (rangeObj.mode === 'custom') {
            var span = (parseInt(rangeObj.endTs,10) - parseInt(rangeObj.startTs,10)) / 86400000;
            return span <= 60;
        }
        return false;
    }

    fetchCalculationAttributes(entity).then(function (attrs) {
        if (token !== self._calcToken) return null;
        return calcForRange(range, attrs).then(function (primary) {
            var compRange = getComparatorRange(range);
            if (!compRange) return { attrs: attrs, primary: primary, comp: null, compRange: null };
            return calcForRange(compRange, attrs).then(function (comp) {
                return { attrs: attrs, primary: primary, comp: comp, compRange: compRange };
            }).catch(function () {
                return { attrs: attrs, primary: primary, comp: null, compRange: null };
            });
        });
    }).then(function (result) {
        if (token !== self._calcToken) return;
        self._hasRendered    = true;
        self._activeEntityKey = entityKey;
        self._activeRange    = rangeKey;

        if (!result || !result.primary) { setAllSectionsPlaceholder(); return; }

        var pr = result.primary;
        if (!pr.ok) {
            if (pr.tooLargeForLegacy) setAllSectionsPending(range);
            else setAllSectionsPlaceholder();
            return;
        }
        renderAllSections(result.attrs, pr, result.comp, result.compRange, range);
        detectChanges();
    }).catch(function () {
        if (token !== self._calcToken) return;
        self._hasRendered = true;
        setAllSectionsPlaceholder();
    });
}

// ── Render all four sections ─────────────────────────────────────
function renderAllSections(attrs, primary, comp, compRange, range) {
    var $el = self.ctx.$widget;
    var s   = self.ctx.settings || {};

    // Derive financial values
    if (!isFiniteNumber(primary.revenueLossLkr) || primary.revenueLossLkr < 0)
        primary.revenueLossLkr = isFiniteNumber(attrs.tariffRate) ? primary.grossLossKWh * attrs.tariffRate : NaN;
    if (!isFiniteNumber(primary.curtailRevenueLossLkr) || primary.curtailRevenueLossLkr < 0)
        primary.curtailRevenueLossLkr = isFiniteNumber(attrs.tariffRate) ? primary.curtailLossKWh * attrs.tariffRate : NaN;

    if (comp) {
        if (!isFiniteNumber(comp.revenueLossLkr) || comp.revenueLossLkr < 0)
            comp.revenueLossLkr = isFiniteNumber(attrs.tariffRate) ? comp.grossLossKWh * attrs.tariffRate : NaN;
        if (!isFiniteNumber(comp.curtailRevenueLossLkr) || comp.curtailRevenueLossLkr < 0)
            comp.curtailRevenueLossLkr = isFiniteNumber(attrs.tariffRate) ? comp.curtailLossKWh * attrs.tariffRate : NaN;
    }

    ['grid','curtail','revenue','curtailRevenue'].forEach(function (mode) {
        var $sec = $el.find('.lau-mode-' + mode);
        renderSection($sec, mode, attrs, primary, comp, compRange, range, s);
    });
}

function renderSection($sec, mode, attrs, primary, comp, compRange, range, s) {
    var def  = MODES[mode];
    var rawVal;

    if (mode === 'revenue')        rawVal = primary.revenueLossLkr;
    else if (mode === 'curtailRevenue') rawVal = primary.curtailRevenueLossLkr;
    else rawVal = primary[def.metricKey] / 1000;  // kWh → MWh for non-financial

    if (!isFiniteNumber(rawVal)) {
        $sec.find('.js-value').text('--').removeClass('skeleton');
        $sec.find('.js-dot').removeClass('sev-low sev-moderate sev-high');
        $sec.find('.js-status').text('--');
        $sec.find('.js-footer').text(range && range.label ? range.label : def.footer);
        $sec.find('.js-delta').removeClass('delta-good delta-bad delta-neutral').css('visibility','hidden');
        return;
    }

    var formatted = formatSectionValue(rawVal, def, s);
    var sev       = getSeverity(rawVal, def, s);

    $sec.find('.js-value').text(formatted).removeClass('skeleton');
    $sec.find('.js-sub').text(def.sub);
    $sec.find('.js-dot').removeClass('sev-low sev-moderate sev-high').addClass(sev.cssClass);
    $sec.find('.js-status').text(sev.label);
    $sec.find('.js-footer').text(range && range.label ? range.label : def.footer);

    // Tooltip
    var lossRate = primary.potentialEnergyKWh > 0
        ? ((def.isCurtail ? primary.curtailLossKWh : primary.grossLossKWh) / primary.potentialEnergyKWh * 100).toFixed(2)
        : '--';
    var tip = def.isFinancial
        ? (def.title + '. Value: ' + formatted + '. Tariff: ' + (attrs.tariffRate || '--') + ' LKR/kWh.')
        : (def.title + '. Value: ' + formatted + '. Loss rate: ' + lossRate + '%.');
    $sec.find('.js-tooltip').text(tip);

    // Delta
    renderSectionDelta($sec, def, primary, comp, compRange);
}

function renderSectionDelta($sec, def, primary, comp, compRange) {
    var $delta = $sec.find('.js-delta');
    if (!comp || !comp.ok || !compRange) {
        $delta.css('visibility','hidden'); return;
    }
    var pot1 = primary.potentialEnergyKWh, pot2 = comp.potentialEnergyKWh;
    if (!pot1 || pot1 <= 0 || !pot2 || pot2 <= 0) { $delta.css('visibility','hidden'); return; }
    var r1 = (def.isCurtail ? primary.curtailLossKWh : primary.grossLossKWh) / pot1;
    var r2 = (def.isCurtail ? comp.curtailLossKWh    : comp.grossLossKWh)    / pot2;
    if (!isFiniteNumber(r1) || !isFiniteNumber(r2) || r2 <= 0) { $delta.css('visibility','hidden'); return; }
    var pct = ((r1 - r2) / r2) * 100;
    var abs = Math.abs(pct);
    var cls = 'delta-neutral', arrow = '';
    if (abs >= DELTA_NEUTRAL_PCT) { cls = pct <= 0 ? 'delta-good' : 'delta-bad'; arrow = pct > 0 ? '▲ ' : '▼ '; }
    $delta.removeClass('delta-good delta-bad delta-neutral').addClass(cls);
    $sec.find('.js-delta-arrow').text(arrow);
    $sec.find('.js-delta-val').text(abs.toFixed(1) + '%');
    $sec.find('.js-delta-lbl').text('vs ' + compRange.label);
    $delta.css('visibility','visible');
}

// ── Section state helpers ────────────────────────────────────────
function setAllSectionsLoading(range) {
    var $el = self.ctx.$widget;
    ['grid','curtail','revenue','curtailRevenue'].forEach(function (mode) {
        var $sec = $el.find('.lau-mode-' + mode);
        $sec.find('.js-value').text('--').addClass('skeleton');
        $sec.find('.js-dot').removeClass('sev-low sev-moderate sev-high');
        $sec.find('.js-status').text('CALC');
        $sec.find('.js-footer').text(range && range.label ? range.label : 'Calculating...');
        $sec.find('.js-delta').css('visibility','hidden');
    });
}

function setAllSectionsPlaceholder() {
    var $el = self.ctx.$widget;
    ['grid','curtail','revenue','curtailRevenue'].forEach(function (mode) {
        var $sec = $el.find('.lau-mode-' + mode);
        $sec.find('.js-value').text('--').removeClass('skeleton');
        $sec.find('.js-dot').removeClass('sev-low sev-moderate sev-high');
        $sec.find('.js-status').text('--');
        $sec.find('.js-delta').css('visibility','hidden');
    });
}

function setAllSectionsPending(range) {
    var $el = self.ctx.$widget;
    ['grid','curtail','revenue','curtailRevenue'].forEach(function (mode) {
        var $sec = $el.find('.lau-mode-' + mode);
        $sec.find('.js-value').text('--').removeClass('skeleton');
        $sec.find('.js-dot').removeClass('sev-low sev-moderate sev-high').addClass('sev-low');
        $sec.find('.js-status').text('PENDING');
        $sec.find('.js-footer').text(range && range.label ? range.label : 'Loss Attribution');
        $sec.find('.js-delta').css('visibility','hidden');
    });
}

// ── Range selector ────────────────────────────────────────────────
function initRangeSelector() {
    if (self._rangeBound) return;
    self._rangeBound = true;
    var $el = self.ctx.$widget;

    $el.find('.js-range-mode-select').on('change', function () {
        var mode = $(this).val();
        if (!mode) return;
        if (mode === 'lifetime') {
            buildLifetimeRangeFromEntity().then(pushRange);
        } else if (mode === 'day') {
            var dayVal = $el.find('.js-day-input').val() || formatDateInput(new Date());
            pushRange(buildDayRange(parseDateInput(dayVal)));
        } else if (mode === 'month') {
            var mVal = $el.find('.js-month-input').val() || formatMonthInput(new Date());
            pushRange(buildMonthRange(parseMonthInput(mVal)));
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
        var d = parseDateInput($(this).val()); if (d) pushRange(buildDayRange(d));
    });
    $el.find('.js-month-input').on('change', function () {
        var d = parseMonthInput($(this).val()); if (d) pushRange(buildMonthRange(d));
    });
    $el.find('.js-year-input').on('change', function () {
        var y = parseInt($(this).val(), 10);
        if (isFinite(y) && y > 1990 && y < 2100) pushRange(buildYearRange(new Date(y, 0, 1)));
    });
    $el.find('.js-custom-start, .js-custom-end').on('change', function () {
        var custom = getCustomRangeFromInputs(); if (custom) pushRange(custom);
    });

    renderRangeSelector(getActiveRange());
}

function renderRangeSelector(range) {
    var $el   = self.ctx.$widget;
    var mode  = range && range.mode ? range.mode : 'month';
    var start = new Date(range ? (range.startTs || Date.now()) : Date.now());

    $el.find('.js-range-mode-select').val(mode);
    $el.find('.js-range-label').text(range && range.label ? range.label : 'Current Month');
    $el.find('.lau-range-input').hide();

    if (mode === 'day')         $el.find('.js-day-input').val(formatDateInput(start)).show();
    else if (mode === 'month')  $el.find('.js-month-input').val(formatMonthInput(start)).show();
    else if (mode === 'year')   $el.find('.js-year-input').val(start.getFullYear()).show();
    else if (mode === 'custom') {
        $el.find('.js-custom-start').val(formatDateInput(start)).show();
        $el.find('.js-custom-end').val(formatDateInput(new Date(range.endTs || Date.now()))).show();
    }
    detectChanges();
}

function pushRange(range) {
    if (!range) return;
    range.updatedAt = Date.now();
    storeRangeLocal(range);
    renderRangeSelector(range);
    try { window.dispatchEvent(new CustomEvent('loss-range-changed', { detail: range })); } catch(e) {}

    var sc = self.ctx.stateController;
    if (!sc) return;
    try {
        var params = {};
        var cur = getStateParams();
        for (var k in cur) { if (Object.prototype.hasOwnProperty.call(cur, k)) params[k] = cur[k]; }
        params[LOSS_RANGE_PARAM] = range;
        var stateId = sc.getStateId ? sc.getStateId() : null;
        if (stateId && typeof sc.openState === 'function') sc.openState(stateId, params, false);
        else if (typeof sc.updateState === 'function')     sc.updateState(stateId, params, false);
    } catch(e) {}
}

// ── Value formatting & severity ──────────────────────────────────
function formatSectionValue(val, def, s) {
    var decimals = parseInt(s.decimals, 10);
    if (isNaN(decimals)) decimals = 1;
    if (def.isFinancial) return (s.currencySym || 'LKR') + ' ' + autoScale(val, 0);
    return autoScale(val, decimals) + ' ' + (s.energyUnit || 'MWh');
}

function getSeverity(val, def, s) {
    s = s || {};
    var sevMed  = parseFloat(s.severityMedium);
    var sevHigh = parseFloat(s.severityHigh);
    if (!isFiniteNumber(sevMed))  sevMed  = def.isFinancial ? 50000  : 100;
    if (!isFiniteNumber(sevHigh)) sevHigh = def.isFinancial ? 200000 : 500;
    if (val < sevMed)  return { cssClass: 'sev-low',      label: 'LOW' };
    if (val < sevHigh) return { cssClass: 'sev-moderate', label: 'MODERATE' };
    return { cssClass: 'sev-high', label: 'HIGH' };
}

// ── Entity resolution ────────────────────────────────────────────
function resolveEntity() {
    if (self.ctx.datasources && self.ctx.datasources.length) {
        for (var i = 0; i < self.ctx.datasources.length; i++) {
            var ds = self.ctx.datasources[i];
            if (!ds) continue;
            var eid = ds.entityId, etype = ds.entityType;
            if (eid && etype) {
                return {
                    id:   (typeof eid === 'object') ? eid.id : eid,
                    type: (typeof etype === 'string') ? etype : (eid.entityType || 'ASSET')
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
            if (sel.entityId)             return { id: sel.entityId.id, type: sel.entityId.entityType };
        }
    } catch(e) {}
    return null;
}

// --- CALCULATION ENGINE (from Loss Attribution v1) ---
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
            // §5.8 — ok = hasPotential only; treat negative non-potential keys as 0
            gridKwh    = (isFiniteNumber(gridKwh)    && gridKwh    >= 0) ? gridKwh    : 0;
            curtailKwh = (isFiniteNumber(curtailKwh) && curtailKwh >= 0) ? curtailKwh : 0;
            expKwh     = (isFiniteNumber(expKwh)     && expKwh     >= 0) ? expKwh     : 0;

            // Fall back to kWh × current tariff if LKR key is missing/negative
            if (!isFiniteNumber(revLkr) || revLkr < 0) {
                revLkr = isFiniteNumber(attrs.tariffRate)
                    ? gridKwh * attrs.tariffRate
                    : NaN;
            }
            if (!isFiniteNumber(curtRevLkr) || curtRevLkr < 0) {
                curtRevLkr = isFiniteNumber(attrs.tariffRate)
                    ? curtailKwh * attrs.tariffRate
                    : NaN;
            }

            return {
                ok: hasPotential,
                grossLossKWh:           gridKwh,
                curtailLossKWh:         curtailKwh,
                potentialEnergyKWh:     isFiniteNumber(potKwh) ? potKwh : 0,
                exportedEnergyKWh:      expKwh,
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

            // §5.8 — ok = hasPotential only; treat negative non-potential keys as 0
            var hasPotential = potKwh >= 0;
            gridKwh    = gridKwh    >= 0 ? gridKwh    : 0;
            curtailKwh = curtailKwh >= 0 ? curtailKwh : 0;
            expKwh     = expKwh     >= 0 ? expKwh     : 0;

            // Fall back to kWh × current tariff when LKR key is missing/sentinel
            if (revLkr < 0) {
                revLkr = isFiniteNumber(attrs.tariffRate)
                    ? gridKwh * attrs.tariffRate
                    : NaN;
            }
            if (curtRevLkr < 0) {
                curtRevLkr = isFiniteNumber(attrs.tariffRate)
                    ? curtailKwh * attrs.tariffRate
                    : NaN;
            }

            return {
                ok: hasPotential,
                grossLossKWh:           gridKwh,
                curtailLossKWh:         curtailKwh,
                potentialEnergyKWh:     potKwh >= 0 ? potKwh : 0,
                exportedEnergyKWh:      expKwh,
                revenueLossLkr:         revLkr,
                curtailRevenueLossLkr:  curtRevLkr,
                bucketMs: 0,
                fromPrecomputed: true
            };
        });
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
    var entityKey = (entity.type || 'ASSET') + ':' + entity.id;
    var now = Date.now();

    // §5.6 — Return cached attrs when entity unchanged and TTL not expired
    if (self._cachedAttrs &&
        self._cachedAttrs.entityKey === entityKey &&
        (now - self._cachedAttrs.fetchedAt) < self._ATTR_TTL_MS) {
        return Promise.resolve(self._cachedAttrs);
    }

    var keys = uniqueList([
        s.plantCapacityKey || 'Capacity',
        s.tariffAttributeKey || 'tariff_rate_lkr'
    ]);

    return fetchAttributesWithFallback(entity, keys).then(function (attrs) {
        var out = {
            capacity:   getAttr(attrs, s.plantCapacityKey || 'Capacity'),
            tariffRate: parseFloat(getAttr(attrs, s.tariffAttributeKey || 'tariff_rate_lkr')),
            entityKey:  entityKey,
            fetchedAt:  now
        };
        self._cachedAttrs = out;
        return out;
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
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    var end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
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

