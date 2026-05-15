// ════════════════════════════════════════════════════
// Forecast Deviation Card (FDI) — v4.0
// ThingsBoard v4.3.0 PE | Latest Values
// 3-tier: Live → Derived → Manual Simulation
// Compact horizontal layout — no gauge
// v4.0: client-side MTD summation of daily rows.
//   forecastDailyKey rows + actualDailyKey rows + today partial.
//   Eliminates v2.x endpoint-alignment bias (forecast_p*_mtd
//   was today-stamped; actual_mtd_energy_kwh was yesterday-stamped).
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

    // ── MTD mode: fetch daily P50 + actual timeseries for current month ──
    var fdiMode = (s.fdiMode || 'mtd').toLowerCase();
    if (fdiMode === 'mtd') {
        fetchMtdData();
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
//  MTD mode: fetch daily timeseries for current month (v4.0)
//
//  Three REST calls (sequential chaining):
//    1. forecastDailyKey  — daily MWh rows, month-start → now
//    2. actualDailyKey    — daily kWh rows, month-start → today-start
//    3. actualPartialKey  — today's partial via agg=SUM, kW-min → /60 = kWh
//
//  All three are summed client-side.
//  Sentinel rule: filter value < 0 before summing (service writes -1 on error).
// ──────────────────────────────────────────────────
function fetchMtdData() {
    try {
        if (!self.ctx.datasources || self.ctx.datasources.length === 0) {
            showPlaceholder(); return;
        }
        var ds         = self.ctx.datasources[0];
        var entityId   = ds.entityId;
        var entityType = ds.entityType;
        var entIdStr   = (typeof entityId   === 'object') ? entityId.id        : entityId;
        var entTypeStr = (typeof entityType === 'string')  ? entityType         : entityId.entityType;
        if (!entIdStr) { showPlaceholder(); return; }

        // Asia/Colombo UTC+5:30 — explicit offset, never derived from host clock
        var offsetMs        = 330 * 60 * 1000;
        var nowUtcMs        = Date.now();
        var nowLocal        = new Date(nowUtcMs + offsetMs);

        // Month start: 1st of current month, 00:00 Colombo
        var monthStartLocal = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), 1));
        var monthStartMs    = monthStartLocal.getTime() - offsetMs;

        // Today start: current day 00:00 Colombo
        var todayStartLocal = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate()));
        var todayStartMs    = todayStartLocal.getTime() - offsetMs;

        var endTs  = nowUtcMs;
        var DAY_MS = 86400000;

        // Settings: new primary keys with legacy fallback chain
        var fcKey     = s.forecastDailyKey || s.forecastP50DailyKey || 'forecast_p50_daily';
        var actDayKey = s.actualDailyKey   || 'actual_daily_energy_kwh';
        var actRtKey  = s.actualPartialKey || 'active_power';

        var base = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr + '/values/timeseries?';

        // Call 1: forecast daily rows — month-start to now (day-1..today, each row in MWh)
        var fcUrl = base + 'keys=' + fcKey +
            '&startTs=' + monthStartMs + '&endTs=' + endTs +
            '&limit=40&agg=NONE';

        // Call 2: actual pre-computed daily rows — month-start to today-start (excludes today)
        var actDayUrl = base + 'keys=' + actDayKey +
            '&startTs=' + monthStartMs + '&endTs=' + todayStartMs +
            '&limit=40&agg=NONE';

        // Call 3: today's partial — realtime key agg=SUM over today's window only
        var actTodayUrl = base + 'keys=' + actRtKey +
            '&startTs=' + todayStartMs + '&endTs=' + endTs +
            '&limit=1&agg=SUM&interval=' + DAY_MS;

        self.ctx.http.get(fcUrl).subscribe(
            function (fcData) {
                var fcRows = fcData[fcKey] || [];

                // No forecast rows for this month → fall to attribute-derived mode
                if (fcRows.length === 0) {
                    tryAttributeDerived(0, s);
                    return;
                }

                // Sum forecast daily MWh; skip sentinel rows (value < 0)
                var fcMwh = 0;
                for (var i = 0; i < fcRows.length; i++) {
                    var fv = parseFloat(fcRows[i].value);
                    if (!isNaN(fv) && fv >= 0) fcMwh += fv;
                }
                if (fcMwh <= 0) { showPlaceholder(); return; }

                // Call 2: actual pre-computed daily
                self.ctx.http.get(actDayUrl).subscribe(
                    function (actDayData) {
                        var actDayRows = actDayData[actDayKey] || [];

                        // Sum actual daily kWh; skip sentinel rows (value < 0)
                        var actDayKwh = 0;
                        for (var j = 0; j < actDayRows.length; j++) {
                            var av = parseFloat(actDayRows[j].value);
                            if (!isNaN(av) && av >= 0) actDayKwh += av;
                        }

                        // Call 3: today's partial
                        self.ctx.http.get(actTodayUrl).subscribe(
                            function (actTodayData) {
                                var todayRows = actTodayData[actRtKey] || [];
                                var todayKwh  = 0;
                                if (todayRows.length > 0) {
                                    var tv = parseFloat(todayRows[0].value);
                                    // agg=SUM on active_power (kW) × 1-min interval = kW-min → /60 = kWh
                                    if (!isNaN(tv) && tv >= 0) todayKwh = tv / 60.0;
                                }
                                computeAndRender(fcMwh, actDayKwh, todayKwh, actDayRows.length);
                            },
                            function () {
                                // Today partial failed — render with what we have
                                computeAndRender(fcMwh, actDayKwh, 0, actDayRows.length);
                            }
                        );
                    },
                    function () {
                        // Pre-computed daily failed — try today's partial only
                        self.ctx.http.get(actTodayUrl).subscribe(
                            function (actTodayData) {
                                var todayRows = actTodayData[actRtKey] || [];
                                var todayKwh  = 0;
                                if (todayRows.length > 0) {
                                    var tv = parseFloat(todayRows[0].value);
                                    if (!isNaN(tv) && tv >= 0) todayKwh = tv / 60.0;
                                }
                                computeAndRender(fcMwh, 0, todayKwh, 0);
                            },
                            function () {
                                computeAndRender(fcMwh, 0, 0, 0);
                            }
                        );
                    }
                );
            },
            function () {
                // Forecast fetch failed entirely → derived fallback
                tryAttributeDerived(0, s);
            }
        );
    } catch (e) { showPlaceholder(); }
}

// ──────────────────────────────────────────────────
//  computeAndRender — called after all 3 REST calls resolve.
//  fcMwh      : cumulative forecast MWh, days 1..today
//  actDayKwh  : sum of pre-computed actual daily kWh, days 1..yesterday
//  todayKwh   : today's partial kWh (active_power agg=SUM / 60)
//  actDayCount: number of pre-computed daily rows returned (0 = day-1 grace)
// ──────────────────────────────────────────────────
function computeAndRender(fcMwh, actDayKwh, todayKwh, actDayCount) {
    var actMwh = (actDayKwh + todayKwh) / 1000.0;
    var unit   = s.unitLabel || 'MWh';

    var displayForecast = unit === 'MWh' ? fcMwh  : fcMwh  * 1000;
    var displayActual   = unit === 'MWh' ? actMwh : actMwh * 1000;

    // Day-1 grace: daily_job has not yet written and no realtime partial either
    if (actDayCount === 0 && todayKwh === 0) {
        applyDeviation(0, 0, displayForecast, 'mtd');
        return;
    }

    if (fcMwh <= 0) { showPlaceholder(); return; }

    var fdiPct = ((actMwh - fcMwh) / fcMwh) * 100;
    applyDeviation(fdiPct, displayActual, displayForecast, 'mtd');
}

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