// ════════════════════════════════════════════════════
// Forecast vs. Actual Energy (30-Day MWh)
// ThingsBoard v4.2.1.1 PE | Latest Values Widget
// Requires: Chart.js via resources.txt
// ════════════════════════════════════════════════════

var myChart = null;
var baseFontSize = 16;
var isLiveData = false;
var dataMode = 'nodata';   // 'live' | 'derived' | 'simulated' | 'nodata'

/* ────────── LIFECYCLE: INIT ────────── */
self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;

    initChart();
    self.onResize();
    fetchLiveData();
};

/* ────────── LIFECYCLE: DATA UPDATED ────────── */
self.onDataUpdated = function () {
    // Re-fetch on every TB data subscription tick
    fetchLiveData();
};

/* ────────── LIFECYCLE: RESIZE ────────── */
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.fvae-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget:
    //   header(0.65) + gap(0.1) + chart(flex) + gap(0.15) + footer(0.5) + padding(0.6)
    //   ≈ 6.5 em total chrome
    var fromH = (h - 8) / 7.0;
    var fromW = w / 16;

    baseFontSize = Math.min(fromH, fromW);
    if (baseFontSize < 8) baseFontSize = 8;
    if (baseFontSize > 30) baseFontSize = 30;

    $card.css('font-size', baseFontSize + 'px');

    if (myChart) {
        var tickFont = Math.max(8, Math.min(14, baseFontSize * 0.50));
        myChart.options.scales.x.ticks.font.size = tickFont;
        myChart.options.scales.y.ticks.font.size = tickFont;
        myChart.resize();
    }
};

/* ────────── LIFECYCLE: DESTROY ────────── */
self.onDestroy = function () {
    if (myChart) {
        myChart.destroy();
        myChart = null;
    }
};

/* ═══════════════════════════════════════════════════
   CHART INITIALISATION
   ═══════════════════════════════════════════════════ */
function initChart() {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    /* ── Apply settings to DOM ── */
    $el.find('.js-title').text(s.widgetTitle || 'FORECAST vs. ACTUAL ENERGY (30-DAY MWh)');
    $el.find('.js-y-title').text('ENERGY (' + (s.unitLabel || 'MWh') + ')');

    if (s.accentColor) {
        $el.find('.fvae-card').css({
            'border-color': s.accentColor,
            'box-shadow': '0 0 12px ' + s.accentColor
        });
    }

    /* ── Canvas ── */
    var canvasEl = $el.find('.js-canvas')[0];
    if (!canvasEl) return;
    var ctx = canvasEl.getContext('2d');

    /* ── Settings cache ── */
    var decimals = parseInt(s.decimals) || 1;
    var unit = s.unitLabel || 'MWh';

    /* ── Crosshair Plugin ── */
    var crosshairPlugin = {
        id: 'fvaeCrosshair',
        afterDraw: function (chart) {
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                var activePoint = chart.tooltip._active[0];
                var x = activePoint.element.x;
                var yTop = chart.scales.y.top;
                var yBot = chart.scales.y.bottom;
                var cCtx = chart.ctx;
                cCtx.save();
                cCtx.beginPath();
                cCtx.moveTo(x, yTop);
                cCtx.lineTo(x, yBot);
                cCtx.lineWidth = 1;
                cCtx.strokeStyle = 'rgba(6, 245, 255, 0.25)';
                cCtx.setLineDash([3, 3]);
                cCtx.stroke();
                cCtx.setLineDash([]);
                cCtx.restore();
            }
        }
    };

    /* ── Chart.js Configuration ── */
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                /* DS 0: P50 Forecast — blue dashed */
                {
                    label: 'P50 Forecast',
                    data: [],
                    borderColor: '#448AFF',
                    borderWidth: 1.8,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#448AFF',
                    fill: false,
                    tension: 0.25,
                    order: 4,
                    spanGaps: true
                },
                /* DS 1: P75 Forecast — amber dashed */
                {
                    label: 'P75 Forecast',
                    data: [],
                    borderColor: '#FFC107',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FFC107',
                    fill: false,
                    tension: 0.25,
                    order: 3,
                    spanGaps: true
                },
                /* DS 2: P90 Forecast — red dashed */
                {
                    label: 'P90 Forecast',
                    data: [],
                    borderColor: '#FF5252',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FF5252',
                    fill: false,
                    tension: 0.25,
                    order: 2,
                    spanGaps: true
                },
                /* DS 3: Confidence Band (invisible line at P50 level, fills down to DS 2 P90) */
                {
                    label: 'Forecast Confidence Band (P50-P90)',
                    data: [],
                    borderColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: {
                        target: 2,   /* fills toward dataset index 2 (P90) */
                        above: 'rgba(68, 138, 255, 0.12)',
                        below: 'rgba(0, 0, 0, 0)'
                    },
                    tension: 0.25,
                    order: 5,
                    spanGaps: true
                },
                /* DS 4: Actual Energy — cyan solid, drawn on top */
                {
                    label: 'Actual Energy',
                    data: [],
                    borderColor: '#06F5FF',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#06F5FF',
                    pointHoverBorderColor: '#FFFFFF',
                    pointHoverBorderWidth: 2,
                    fill: false,
                    tension: 0.2,
                    order: 1,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            layout: {
                padding: { top: 4, right: 6, bottom: 0, left: 0 }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#90A4AE',
                        font: { size: 10, family: 'Roboto, sans-serif' },
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 15
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#90A4AE',
                        font: { size: 10, family: 'Roboto, sans-serif' },
                        callback: function (val) {
                            return val.toFixed(0);
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(2, 10, 67, 0.95)',
                    titleColor: '#90A4AE',
                    bodyColor: '#FFFFFF',
                    bodyFont: { weight: '600', family: 'Roboto, sans-serif' },
                    borderColor: 'rgba(6, 245, 255, 0.3)',
                    borderWidth: 1,
                    cornerRadius: 4,
                    padding: { top: 8, right: 12, bottom: 8, left: 12 },
                    displayColors: true,
                    usePointStyle: true,
                    filter: function (tooltipItem) {
                        // Hide the invisible confidence band dataset from tooltip
                        return tooltipItem.datasetIndex !== 3;
                    },
                    callbacks: {
                        title: function (items) {
                            if (items.length > 0) {
                                return items[0].label;
                            }
                            return '';
                        },
                        label: function (context) {
                            var label = context.dataset.label || '';
                            var val = context.parsed.y;
                            if (val !== null && val !== undefined) {
                                return label + ': ' + val.toFixed(decimals) + ' ' + unit;
                            }
                            return label + ': --';
                        },
                        afterBody: function (items) {
                            // Show deviation between Actual and P50
                            var actualItem = items.find(function (i) { return i.datasetIndex === 4; });
                            var p50Item = items.find(function (i) { return i.datasetIndex === 0; });
                            if (actualItem && p50Item &&
                                actualItem.parsed.y != null && p50Item.parsed.y != null &&
                                p50Item.parsed.y > 0) {
                                var dev = ((actualItem.parsed.y - p50Item.parsed.y) / p50Item.parsed.y * 100).toFixed(1);
                                var sign = dev >= 0 ? '+' : '';
                                return ['───────────', 'Deviation: ' + sign + dev + '%'];
                            }
                            return [];
                        }
                    }
                }
            }
        },
        plugins: [crosshairPlugin]
    });
}

/* ═══════════════════════════════════════════════════
   DATA PIPELINE — 3-TIER AUTO-DETECTION
   ═══════════════════════════════════════════════════ */

/* DOM shorthand */
var $el, $statusDot, $statusText, $tooltip;

function cacheDom() {
    $el = self.ctx.$widget;
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $tooltip = $el.find('.js-tooltip');
}

/* ────────── ENTRY POINT ────────── */
function fetchLiveData() {
    cacheDom();
    var s = self.ctx.settings;

    /* Guard: no datasource? */
    if (!self.ctx.datasources || self.ctx.datasources.length === 0) {
        renderNoData();
        return;
    }

    var ds = self.ctx.datasources[0];
    var entityId = ds.entityId;
    var entityType = ds.entityType;

    if (!entityId || !entityType) {
        renderNoData();
        return;
    }

    var entIdStr = (typeof entityId === 'object') ? entityId.id : entityId;
    var entTypeStr = (typeof entityType === 'string') ? entityType : entityId.entityType;

    if (!entIdStr) {
        renderNoData();
        return;
    }

    var windowDays = parseInt(s.windowDays) || 30;
    var now = Date.now();
    var startTs = now - (windowDays * 24 * 60 * 60 * 1000);

    /* ── Tier 1: Try fetching real forecast telemetry ── */
    var p50Key = s.forecastP50Key || 'forecast_p50_daily';
    var p75Key = s.forecastP75Key || 'forecast_p75_daily';
    var p90Key = s.forecastP90Key || 'forecast_p90_daily';
    var actKey = s.actualEnergyKey || 'total_generation';

    var allKeys = [actKey, p50Key, p75Key, p90Key].join(',');

    var url = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr +
        '/values/timeseries?keys=' + allKeys +
        '&startTs=' + startTs + '&endTs=' + now +
        '&limit=10000&agg=NONE';

    try {
        self.ctx.http.get(url).subscribe(
            function (data) {
                handleTelemetryResponse(data, entIdStr, entTypeStr, s);
            },
            function () {
                /* Telemetry fetch failed entirely — try attributes next */
                tryAttributeFallback(entIdStr, entTypeStr, s);
            }
        );
    } catch (e) {
        tryAttributeFallback(entIdStr, entTypeStr, s);
    }
}

/* ────────── TIER 1: HANDLE TELEMETRY RESPONSE ────────── */
function handleTelemetryResponse(data, entIdStr, entTypeStr, s) {
    var actKey = s.actualEnergyKey || 'total_generation';
    var p50Key = s.forecastP50Key || 'forecast_p50_daily';

    var hasActuals = data && data[actKey] && data[actKey].length > 2;
    var hasForecasts = data && data[p50Key] && data[p50Key].length > 2;

    if (hasActuals && hasForecasts) {
        /* Full live mode — real actuals + real forecasts */
        processLiveData(data, s);
    } else if (hasActuals) {
        /* Actuals exist but no forecast telemetry — try attribute derivation */
        tryAttributeFallback(entIdStr, entTypeStr, s, data[actKey]);
    } else {
        /* No actuals either — try attributes then simulate */
        tryAttributeFallback(entIdStr, entTypeStr, s);
    }
}

/* ────────── TIER 2: ATTRIBUTE FALLBACK (DERIVED MODE) ────────── */
function tryAttributeFallback(entIdStr, entTypeStr, s, actualTelemetry) {
    try {
        var attrService = self.ctx.attributeService;
        if (!attrService) {
            loadSimulation(s);
            return;
        }

        var entityObj = { id: entIdStr, entityType: entTypeStr };
        var p50Attr = s.p50AttributeKey || 'p50_energy';
        var p75Attr = s.p75AttributeKey || 'p75_energy';
        var p90Attr = s.p90AttributeKey || 'p90_energy';

        attrService.getEntityAttributes(entityObj, 'SERVER_SCOPE', [p50Attr, p75Attr, p90Attr])
            .subscribe(
                function (attrs) {
                    if (!attrs || attrs.length === 0) {
                        loadSimulation(s);
                        return;
                    }

                    var attrMap = {};
                    for (var i = 0; i < attrs.length; i++) {
                        attrMap[attrs[i].key] = parseFloat(attrs[i].value);
                    }

                    var p50Val = attrMap[p50Attr];
                    var p75Val = attrMap[p75Attr];
                    var p90Val = attrMap[p90Attr];

                    if (isNaN(p50Val)) {
                        loadSimulation(s);
                        return;
                    }

                    /* Derive daily from annual */
                    loadDerived(s, p50Val, p75Val || p50Val * 0.947, p90Val || p50Val * 0.900, actualTelemetry);
                },
                function () {
                    loadSimulation(s);
                }
            );
    } catch (e) {
        loadSimulation(s);
    }
}

/* ═══════════════════════════════════════════════════
   DATA PROCESSING
   ═══════════════════════════════════════════════════ */

/* ────────── TIER 1: LIVE MODE ────────── */
function processLiveData(data, s) {
    dataMode = 'live';
    updateStatusBadge();

    var actKey = s.actualEnergyKey || 'total_generation';
    var p50Key = s.forecastP50Key || 'forecast_p50_daily';
    var p75Key = s.forecastP75Key || 'forecast_p75_daily';
    var p90Key = s.forecastP90Key || 'forecast_p90_daily';
    var unit = s.unitLabel || 'MWh';

    /* ── Parse each key into daily buckets ── */
    var actuals = parseTsToDailyMap(data[actKey] || []);
    var p50Vals = parseTsToDailyMap(data[p50Key] || []);
    var p75Vals = parseTsToDailyMap(data[p75Key] || []);
    var p90Vals = parseTsToDailyMap(data[p90Key] || []);

    /* ── Build aligned date labels ── */
    var allDates = mergeKeys(actuals, p50Vals, p75Vals, p90Vals);
    allDates.sort();

    var labels = [];
    var dataActual = [];
    var dataP50 = [];
    var dataP75 = [];
    var dataP90 = [];
    var dataBand = [];

    for (var i = 0; i < allDates.length; i++) {
        var day = allDates[i];
        labels.push(formatDateLabel(day));
        dataActual.push(actuals[day] != null ? actuals[day] : null);
        dataP50.push(p50Vals[day] != null ? p50Vals[day] : null);
        dataP75.push(p75Vals[day] != null ? p75Vals[day] : null);
        dataP90.push(p90Vals[day] != null ? p90Vals[day] : null);
        dataBand.push(p50Vals[day] != null ? p50Vals[day] : null);
    }

    renderChart(labels, dataP50, dataP75, dataP90, dataBand, dataActual);
    updateRiskState(dataActual, dataP50, dataP75, s);
    updateTooltipSummary(dataActual, dataP50, dataP75, dataP90, s);
}

/* ────────── TIER 2: DERIVED MODE ────────── */
function loadDerived(s, annualP50, annualP75, annualP90, actualTelemetry) {
    dataMode = 'derived';
    updateStatusBadge();

    var windowDays = parseInt(s.windowDays) || 30;
    var unit = s.unitLabel || 'MWh';

    /* Daily baseline from annual kWh → MWh */
    var dailyP50 = (annualP50 / 365) / 1000;
    var dailyP75 = (annualP75 / 365) / 1000;
    var dailyP90 = (annualP90 / 365) / 1000;

    /* Deterministic seeded random for consistent results */
    var seed = 137;
    function seededRandom() {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    }

    var labels = [];
    var dataP50 = [];
    var dataP75 = [];
    var dataP90 = [];
    var dataBand = [];
    var dataActual = [];

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* Parse actual telemetry if available */
    var actualMap = {};
    if (actualTelemetry && actualTelemetry.length > 0) {
        actualMap = parseTsToDailyMap(actualTelemetry);
    }

    for (var d = 0; d < windowDays; d++) {
        var date = new Date(today.getTime() - (windowDays - 1 - d) * 86400000);
        var dayStr = formatDateObj(date);
        labels.push(formatDateLabel(dayStr));

        /* Add seasonal and weather-like variance */
        var dayOfYear = getDayOfYear(date);
        var seasonal = 1.0 + 0.12 * Math.sin((dayOfYear - 80) / 365 * 2 * Math.PI);  // peak mid-year
        var cloudNoise = 1.0 + (seededRandom() - 0.5) * 0.08;

        var p50 = dailyP50 * seasonal * cloudNoise;
        var p75 = dailyP75 * seasonal * (1.0 + (seededRandom() - 0.5) * 0.06);
        var p90 = dailyP90 * seasonal * (1.0 + (seededRandom() - 0.5) * 0.05);

        /* Ensure ordering P50 >= P75 >= P90 */
        if (p75 > p50) p75 = p50 * 0.95;
        if (p90 > p75) p90 = p75 * 0.95;

        dataP50.push(round(p50, 2));
        dataP75.push(round(p75, 2));
        dataP90.push(round(p90, 2));
        dataBand.push(round(p50, 2));

        /* Actual: from telemetry if available, else generate */
        if (actualMap[dayStr] != null) {
            dataActual.push(actualMap[dayStr]);
        } else {
            /* Simulate actual: between P90 and slightly above P50, with weather outliers */
            var actualBase = p50 * (0.92 + seededRandom() * 0.16);  // ~P50 ± 8%
            /* Occasional underperformance event (~15% of days) */
            if (seededRandom() < 0.15) {
                actualBase *= (0.75 + seededRandom() * 0.15);
            }
            dataActual.push(round(Math.max(0, actualBase), 2));
        }
    }

    renderChart(labels, dataP50, dataP75, dataP90, dataBand, dataActual);
    updateRiskState(dataActual, dataP50, dataP75, s);
    updateTooltipSummary(dataActual, dataP50, dataP75, dataP90, s);
}

/* ────────── TIER 3: PURE SIMULATION ────────── */
function loadSimulation(s) {
    dataMode = 'simulated';
    updateStatusBadge();

    var windowDays = parseInt(s.windowDays) || 30;
    var baseDailyKwh = parseFloat(s.baseDailyEnergy) || 4110;
    var dailyP50 = baseDailyKwh / 1000;    // Convert kWh → MWh
    var dailyP75 = dailyP50 * 0.947;
    var dailyP90 = dailyP50 * 0.900;

    var seed = 42;
    function seededRandom() {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    }

    var labels = [];
    var dataP50 = [];
    var dataP75 = [];
    var dataP90 = [];
    var dataBand = [];
    var dataActual = [];

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (var d = 0; d < windowDays; d++) {
        var date = new Date(today.getTime() - (windowDays - 1 - d) * 86400000);
        var dayStr = formatDateObj(date);
        labels.push(formatDateLabel(dayStr));

        var dayOfYear = getDayOfYear(date);
        var seasonal = 1.0 + 0.12 * Math.sin((dayOfYear - 80) / 365 * 2 * Math.PI);
        var cloudNoise = 1.0 + (seededRandom() - 0.5) * 0.08;

        var p50 = dailyP50 * seasonal * cloudNoise;
        var p75 = dailyP75 * seasonal * (1.0 + (seededRandom() - 0.5) * 0.06);
        var p90 = dailyP90 * seasonal * (1.0 + (seededRandom() - 0.5) * 0.05);

        if (p75 > p50) p75 = p50 * 0.95;
        if (p90 > p75) p90 = p75 * 0.95;

        dataP50.push(round(p50, 2));
        dataP75.push(round(p75, 2));
        dataP90.push(round(p90, 2));
        dataBand.push(round(p50, 2));

        /* Simulate actual with realistic patterns */
        var actualBase = p50 * (0.92 + seededRandom() * 0.16);
        if (seededRandom() < 0.15) {
            actualBase *= (0.75 + seededRandom() * 0.15);
        }
        /* One "recovery spike" around day 25 */
        if (d >= 23 && d <= 25) {
            actualBase = p50 * (1.02 + seededRandom() * 0.05);
        }
        dataActual.push(round(Math.max(0, actualBase), 2));
    }

    renderChart(labels, dataP50, dataP75, dataP90, dataBand, dataActual);
    updateRiskState(dataActual, dataP50, dataP75, s);
    updateTooltipSummary(dataActual, dataP50, dataP75, dataP90, s);
}

/* ────────── NO DATA STATE ────────── */
function renderNoData() {
    dataMode = 'nodata';
    updateStatusBadge();
    if (myChart) {
        myChart.data.datasets.forEach(function (ds) { ds.data = []; });
        myChart.data.labels = [];
        myChart.update();
    }
    cacheDom();
    $tooltip.html('No datasource configured.<br>Please add an entity with energy telemetry.');
}

/* ═══════════════════════════════════════════════════
   CHART RENDERING
   ═══════════════════════════════════════════════════ */

function renderChart(labels, p50, p75, p90, band, actual) {
    if (!myChart) return;

    var s = self.ctx.settings;
    var showBand = (s.showConfidenceBand !== false);

    myChart.data.labels = labels;
    myChart.data.datasets[0].data = p50;      // P50
    myChart.data.datasets[1].data = p75;      // P75
    myChart.data.datasets[2].data = p90;      // P90
    myChart.data.datasets[3].data = showBand ? band : [];   // Confidence Band
    myChart.data.datasets[4].data = actual;   // Actual

    myChart.update('none');
}

/* ═══════════════════════════════════════════════════
   RISK STATE DETECTION
   ═══════════════════════════════════════════════════ */

function updateRiskState(actual, p50, p75, s) {
    cacheDom();

    /* Find last non-null actual value */
    var latestActual = null;
    var latestP50 = null;
    var latestP75 = null;

    for (var i = actual.length - 1; i >= 0; i--) {
        if (actual[i] != null) {
            latestActual = actual[i];
            latestP50 = p50[i];
            latestP75 = p75[i];
            break;
        }
    }

    if (latestActual == null || latestP50 == null) return;

    /* Classify risk state */
    var riskState;
    if (latestActual >= latestP50) {
        riskState = 'good';
    } else if (latestActual >= latestP75) {
        riskState = 'warning';
    } else {
        riskState = 'critical';
    }

    /* Update risk badge */
    $statusDot.removeClass('good warning critical nodata derived simulated');
    $statusDot.addClass(riskState);

    var riskLabels = { good: 'ON TRACK', warning: 'WARNING', critical: 'CRITICAL' };
    $statusText.text(riskLabels[riskState] || '--');
}

/* ═══════════════════════════════════════════════════
   STATUS BADGE (data mode indicator)
   ═══════════════════════════════════════════════════ */

function updateStatusBadge() {
    cacheDom();
    /* Only show data mode badge initially; risk state overrides later */
    $statusDot.removeClass('good warning critical nodata derived simulated');

    switch (dataMode) {
        case 'live':
            $statusDot.addClass('good');
            $statusText.text('LIVE');
            break;
        case 'derived':
            $statusDot.addClass('derived');
            $statusText.text('DERIVED');
            break;
        case 'simulated':
            $statusDot.addClass('simulated');
            $statusText.text('SIMULATED');
            break;
        default:
            $statusDot.addClass('nodata');
            $statusText.text('NO DATA');
            break;
    }
}

/* ═══════════════════════════════════════════════════
   DYNAMIC TOOLTIP
   ═══════════════════════════════════════════════════ */

function updateTooltipSummary(actual, p50, p75, p90, s) {
    cacheDom();
    var unit = s.unitLabel || 'MWh';
    var decimals = parseInt(s.decimals) || 1;

    /* Skip if user provided a static tooltip */
    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
        return;
    }

    /* Calculate averages over the window */
    var sumActual = 0, sumP50 = 0, cntActual = 0, cntP50 = 0;
    for (var i = 0; i < actual.length; i++) {
        if (actual[i] != null) { sumActual += actual[i]; cntActual++; }
        if (p50[i] != null) { sumP50 += p50[i]; cntP50++; }
    }

    if (cntActual === 0 || cntP50 === 0) {
        $tooltip.text('Insufficient data for risk summary.');
        return;
    }

    var avgActual = sumActual / cntActual;
    var avgP50 = sumP50 / cntP50;
    var deviation = ((avgActual - avgP50) / avgP50 * 100);
    var sign = deviation >= 0 ? '+' : '';
    var modeLabel = dataMode.charAt(0).toUpperCase() + dataMode.slice(1);

    var tipParts = [];
    tipParts.push(modeLabel + ' | Avg Actual: ' + avgActual.toFixed(decimals) + ' ' + unit);
    tipParts.push('Avg P50: ' + avgP50.toFixed(decimals) + ' ' + unit);
    tipParts.push('Deviation: ' + sign + deviation.toFixed(1) + '%');

    /* MAPE calculation */
    var apeSum = 0, apeCnt = 0;
    for (var j = 0; j < actual.length; j++) {
        if (actual[j] != null && p50[j] != null && p50[j] > 0) {
            apeSum += Math.abs((actual[j] - p50[j]) / p50[j]);
            apeCnt++;
        }
    }
    if (apeCnt > 0) {
        var mape = (apeSum / apeCnt * 100).toFixed(1);
        tipParts.push('MAPE: ' + mape + '%');
    }

    $tooltip.text(tipParts.join(' | '));
}

/* ═══════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════ */

/* Parse raw TB telemetry [{ts, value}] into { 'YYYY-MM-DD': avgValue } */
function parseTsToDailyMap(rawArr) {
    var buckets = {};
    var counts = {};
    for (var i = 0; i < rawArr.length; i++) {
        var ts = parseInt(rawArr[i].ts);
        var val = parseFloat(rawArr[i].value);
        if (isNaN(val)) continue;
        var d = new Date(ts);
        var key = formatDateObj(d);
        if (buckets[key] == null) {
            buckets[key] = val;
            counts[key] = 1;
        } else {
            buckets[key] += val;
            counts[key]++;
        }
    }
    /* Average per day */
    for (var k in buckets) {
        if (counts[k] > 1) {
            buckets[k] = buckets[k] / counts[k];
        }
    }
    return buckets;
}

/* Merge keys from multiple maps */
function mergeKeys() {
    var s = {};
    for (var a = 0; a < arguments.length; a++) {
        var obj = arguments[a];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) s[k] = true;
        }
    }
    return Object.keys(s);
}

/* Format Date object → 'YYYY-MM-DD' */
function formatDateObj(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/* Format 'YYYY-MM-DD' → 'YYYY-MM-DD' for display (short locale) */
function formatDateLabel(dateStr) {
    return dateStr;  // Keep ISO for Chart.js x-axis readability
}

/* Get day of year 1-365 */
function getDayOfYear(date) {
    var start = new Date(date.getFullYear(), 0, 0);
    var diff = date - start;
    return Math.floor(diff / 86400000);
}

/* Rounding helper */
function round(val, dec) {
    var f = Math.pow(10, dec);
    return Math.round(val * f) / f;
}
