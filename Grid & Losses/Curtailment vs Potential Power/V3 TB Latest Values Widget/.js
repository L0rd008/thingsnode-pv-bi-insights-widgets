/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V3
   ThingsBoard v4.2.1.1 PE | Latest Values Widget
   Chart.js envelope chart with simulation fallback
   ════════════════════════════════════════════════════ */

var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $tooltip;
var $legendPotential, $legendExported, $legendCurtailed;
var isLiveData = false;

/* ────────── LIFECYCLE: INIT ────────── */
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;

    /* ── cache DOM ── */
    $title = $el.find('.js-title');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $yTitle = $el.find('.js-y-title');
    $tooltip = $el.find('.js-tooltip');
    $legendPotential = $el.find('.js-legend-potential');
    $legendExported = $el.find('.js-legend-exported');
    $legendCurtailed = $el.find('.js-legend-curtailed');

    updateDom();
    initChart();
    self.onResize();

    /* ── Attempt live data fetch ── */
    fetchLiveData();
};

/* ────────── DOM SETUP ────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');

    var unitLabel = s.unitLabel || 'kW';
    $yTitle.text('POWER (' + unitLabel + ')');

    $legendPotential.text(s.potentialLineLabel || 'Potential Power');
    $legendExported.text(s.exportedAreaLabel || 'Exported Power');
    $legendCurtailed.text(s.curtailmentLabel || 'Curtailed Energy');

    /* ── accent override ── */
    var accent = s.accentColor;
    if (accent) {
        $el.find('.curt-card').css({
            'border-color': accent,
            'box-shadow': '0 0 12px ' + accent + '33, inset 0 0 15px rgba(0,0,0,0.4)'
        });
    }

    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

/* ────────── CHART INITIALIZATION ────────── */
function initChart() {
    var canvasEl = $el.find('.js-canvas')[0];
    if (!canvasEl) return;
    var ctx = canvasEl.getContext('2d');

    var unitLabel = s.unitLabel || 'kW';
    var dec = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var showCurtLabel = (s.showCurtailmentLabel !== undefined) ? s.showCurtailmentLabel : true;
    var curtLabelText = s.curtailmentLabel || 'Curtailed Energy';

    /* ── Plugin: Curtailment Label Overlay ── */
    var curtailmentLabelPlugin = {
        id: 'curtailmentLabel',
        afterDraw: function (chart) {
            if (!showCurtLabel) return;
            var datasets = chart.data.datasets;
            if (datasets.length < 3) return;

            var potentialData = datasets[0].data;
            var exportedData = datasets[1].data;
            var envData = datasets[2].data;
            if (!potentialData || !exportedData || potentialData.length === 0) return;

            var area = chart.chartArea;
            if (!area) return;
            var xScale = chart.scales.x;
            var yScale = chart.scales.y;
            var cCtx = chart.ctx;

            /* find the point of maximum actual curtailment */
            var maxCurt = 0;
            var maxIdx = -1;
            for (var i = 0; i < envData.length; i++) {
                var pVal = potentialData[i];
                var eVal = exportedData[i];
                var envVal = envData[i];
                if (pVal == null || eVal == null || envVal == null) continue;
                var curtVal = envVal - eVal;
                if (curtVal > maxCurt) {
                    maxCurt = curtVal;
                    maxIdx = i;
                }
            }

            if (maxIdx < 0 || maxCurt < 1) return;

            var pY = yScale.getPixelForValue(envData[maxIdx]);
            var eY = yScale.getPixelForValue(exportedData[maxIdx]);
            var labelX = xScale.getPixelForValue(maxIdx);
            var labelY = (pY + eY) / 2;

            /* clamp within chart area */
            labelX = Math.max(area.left + 30, Math.min(area.right - 30, labelX));
            labelY = Math.max(area.top + 10, Math.min(area.bottom - 10, labelY));

            cCtx.save();
            var fontSize = Math.max(10, Math.min(16, baseFontSize * 0.55));
            cCtx.font = '700 ' + fontSize + 'px Roboto, sans-serif';
            cCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            cCtx.textAlign = 'center';
            cCtx.textBaseline = 'middle';

            /* text shadow for readability */
            cCtx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            cCtx.shadowBlur = 4;
            cCtx.shadowOffsetX = 1;
            cCtx.shadowOffsetY = 1;
            cCtx.fillText(curtLabelText, labelX, labelY);
            cCtx.restore();
        }
    };

    /* ── Plugin: Crosshair ── */
    var crosshairPlugin = {
        id: 'crosshair',
        afterDraw: function (chart) {
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                var activePoint = chart.tooltip._active[0];
                var x = activePoint.element.x;
                var yAxis = chart.scales.y;
                var cCtx = chart.ctx;
                cCtx.save();
                cCtx.beginPath();
                cCtx.moveTo(x, yAxis.top);
                cCtx.lineTo(x, yAxis.bottom);
                cCtx.lineWidth = 1;
                cCtx.strokeStyle = 'rgba(6, 245, 255, 0.25)';
                cCtx.setLineDash([3, 3]);
                cCtx.stroke();
                cCtx.setLineDash([]);
                cCtx.restore();
            }
        }
    };

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                /* Dataset 0: Potential Power (dashed line, no fill) */
                {
                    label: s.potentialLineLabel || 'Potential Power',
                    data: [],
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: 'rgba(255,255,255,0.7)',
                    tension: 0.4,
                    fill: false,
                    order: 3
                },
                /* Dataset 1: Exported Power (visible line, cyan fill to origin) */
                {
                    label: s.exportedAreaLabel || 'Exported Power',
                    data: [],
                    borderColor: '#06F5FF',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#06F5FF',
                    pointHoverBorderColor: '#FFFFFF',
                    pointHoverBorderWidth: 2,
                    tension: 0.4,
                    fill: 'origin',
                    backgroundColor: 'rgba(6, 245, 255, 0.18)',
                    order: 2
                },
                /* Dataset 2: Curtailment Area (invisible line, red fill to dataset 1) */
                {
                    label: '_curtailed_envelope',
                    data: [],
                    borderColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.4,
                    fill: {
                        target: 1,
                        above: 'rgba(229, 57, 53, 0.4)',
                        below: 'rgba(229, 57, 53, 0.4)'
                    },
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                axis: 'x',
                intersect: false
            },
            layout: {
                padding: { top: 4, right: 6, bottom: 0, left: 0 }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.06)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#90A4AE',
                        font: { size: 10, family: 'Roboto, sans-serif' },
                        maxTicksLimit: 9,
                        maxRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.06)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#90A4AE',
                        font: { size: 10, family: 'Roboto, sans-serif' },
                        callback: function (val) { return val; }
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
                    padding: { top: 6, right: 10, bottom: 6, left: 10 },
                    displayColors: false,
                    filter: function (tooltipItem) {
                        /* hide the invisible envelope dataset from tooltip */
                        return tooltipItem.datasetIndex !== 2;
                    },
                    callbacks: {
                        title: function (items) {
                            if (items.length > 0) return items[0].label;
                            return '';
                        },
                        label: function (context) {
                            var val = (context.parsed.y || 0).toFixed(dec);
                            return context.dataset.label + ': ' + val + ' ' + unitLabel;
                        },
                        afterBody: function (items) {
                            if (items.length < 1) return '';
                            var chartData = items[0].chart.data;
                            var dataIdx = items[0].dataIndex;
                            var eVal  = chartData.datasets[1].data[dataIdx] || 0;
                            var envVal = chartData.datasets[2].data[dataIdx];
                            if (envVal == null) envVal = eVal;

                            var curtailed = Math.max(envVal - eVal, 0);
                            if (curtailed > 0) {
                                return 'Curtailed Gap: ' + curtailed.toFixed(dec) + ' ' + unitLabel;
                            }
                            return '';
                        }
                    }
                }
            }
        },
        plugins: [curtailmentLabelPlugin, crosshairPlugin]
    });
}

/* ────────── HELPER ────────── */
function parseCommaList(str) {
    if (!str) return [];
    return str.split(',').map(function(k) { return k.trim() }).filter(function(k) { return k.length > 0 });
}

/* ────────── LIVE DATA FETCH ────────── */
function fetchLiveData() {
    /* Get entity from datasource */
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
    if (!entIdStr) { renderNoData(); return; }

    var actualKeys = parseCommaList(s.actualPowerKeys || 'active_power');
    var setpointKeys = parseCommaList(s.setpointKeys || 'setpoint_active_power, curtailment_limit, power_limit');
    var capacityKey = s.plantCapacityKey || 'Plant Total Capacity';

    var tsKeys = actualKeys.concat(setpointKeys).join(',');
    var now = new Date();
    var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var endTs = now.getTime();

    var fetchTs = function() {
        var url = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr +
            '/values/timeseries?keys=' + tsKeys +
            '&startTs=' + startOfDay + '&endTs=' + endTs +
            '&limit=50000&agg=NONE';
        
        try {
            self.ctx.http.get(url).subscribe(
                function (data) {
                    if (data && Object.keys(data).length > 0) {
                        processLiveTimeSeries(data);
                    } else {
                        loadSimulation();
                    }
                },
                function () { loadSimulation(); }
            );
        } catch (e) { loadSimulation(); }
    };

    var attrService = self.ctx.attributeService;
    if (attrService && capacityKey) {
        var entityObj = { id: entIdStr, entityType: entTypeStr };
        attrService.getEntityAttributes(entityObj, 'SERVER_SCOPE', [capacityKey])
            .subscribe(
                function (data) {
                    var found = data.find(function (a) { return a.key === capacityKey; });
                    if (found) self._capacityVal = found.value;
                    fetchTs();
                },
                function () { fetchTs(); }
            );
    } else {
        fetchTs();
    }
}

/* ────────── PROCESS LIVE TIME SERIES ────────── */
function processLiveTimeSeries(rawData) {
    isLiveData = true;
    updateStatusBadge('live');

    var actualKeys = parseCommaList(s.actualPowerKeys || 'active_power');
    var setpointKeys = parseCommaList(s.setpointKeys || 'setpoint_active_power, curtailment_limit, power_limit');

    var rawActual = null;
    for (var i = 0; i < actualKeys.length; i++) {
        if (rawData[actualKeys[i]] && rawData[actualKeys[i]].length > 0) {
            rawActual = rawData[actualKeys[i]]; 
            break;
        }
    }
    
    var rawSetpoint = null;
    for (var j = 0; j < setpointKeys.length; j++) {
        if (rawData[setpointKeys[j]] && rawData[setpointKeys[j]].length > 0) {
            rawSetpoint = rawData[setpointKeys[j]]; 
            break;
        }
    }

    if (!rawActual) {
        loadSimulation();
        return;
    }

    /* Setpoint data acts as a step function. Sort to ensure chronological order */
    if (rawSetpoint) {
        rawSetpoint.sort(function(a, b) { return a.ts - b.ts; });
    }

    var getSetpointAtTime = function(ts) {
        if (!rawSetpoint || rawSetpoint.length === 0) return 100;
        var lastVal = 100; // Assumption: Not curtailed if no state yet
        for (var k = 0; k < rawSetpoint.length; k++) {
            if (rawSetpoint[k].ts <= ts) {
                lastVal = parseFloat(rawSetpoint[k].value);
            } else { break; }
        }
        return isNaN(lastVal) ? 100 : lastVal;
    };

    /* Capacity configuration */
    var capacity = parseFloat(self._capacityVal);
    if (isNaN(capacity) || capacity <= 0) capacity = parseFloat(s.maxPower) || 1000;
    
    var capUnit = s.capacityUnit || 'MW';
    var powUnit = s.unitLabel || 'kW';
    if (capUnit === 'MW' && powUnit === 'kW') capacity *= 1000;
    if (capUnit === 'kW' && powUnit === 'MW') capacity *= 0.001;

    var labels = [];
    var dataExported = new Array(96).fill(null);
    var dataPotential = generatePotentialCurve(capacity);
    var dataCurtailedEnv = new Array(96).fill(null);

    var now = new Date();
    var startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    for (var idx = 0; idx < 96; idx++) {
        var totalMin = idx * 15;
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        labels.push((h < 10 ? '0' : '') + h + ':' + (m === 0 ? '00' : (m < 10 ? '0' + m : m)));
    }

    /* Map telemetry to 15-min buckets */
    for (var p = 0; p < rawActual.length; p++) {
        var ts = parseInt(rawActual[p].ts);
        var val = parseFloat(rawActual[p].value);
        if (isNaN(val)) continue;

        var date = new Date(ts);
        var tIdx = Math.floor((date.getHours() * 60 + date.getMinutes()) / 15);
        if (tIdx >= 0 && tIdx < 96) {
            if (dataExported[tIdx] === null) dataExported[tIdx] = val;
            else dataExported[tIdx] = (dataExported[tIdx] + val) / 2;
        }
    }

    /* Calculate curtailment envelope based on setpoint step-functions */
    for (var b = 0; b < 96; b++) {
        if (dataExported[b] === null) {
            dataCurtailedEnv[b] = null;
            continue;
        }
        
        /* Check the setpoint at the middle of this 15-min bucket to be representative */
        var bucketTs = startOfDay + (b * 15 + 7.5) * 60 * 1000;
        var setpointPct = getSetpointAtTime(bucketTs);
        var allowedPower = capacity * (setpointPct / 100);

        /* 
         * Important Logic:
         * We only render the red area if the grid command restricted the plant (setpointPct < 99)
         * AND the theoretical potential power is actually higher than the allowed constraint.
         */
        if (setpointPct < 99 && dataPotential[b] > allowedPower) {
            dataCurtailedEnv[b] = Math.max(dataPotential[b], dataExported[b]);
        } else {
            /* Not curtailed: Envelope matches exported line perfectly (no red gap) */
            dataCurtailedEnv[b] = dataExported[b];
        }
    }

    var startIdx = 20;
    var endIdx = 77;
    labels = labels.slice(startIdx, endIdx);
    dataPotential = dataPotential.slice(startIdx, endIdx);
    dataExported = dataExported.slice(startIdx, endIdx);
    dataCurtailedEnv = dataCurtailedEnv.slice(startIdx, endIdx);

    renderChartData(labels, dataPotential, dataExported, dataCurtailedEnv);
    updateTooltipSummary(dataPotential, dataExported, dataCurtailedEnv);
}

/* ────────── SIMULATION ────────── */
function loadSimulation() {
    isLiveData = false;
    updateStatusBadge('simulated');

    var capacity = parseFloat(s.maxPower) || 1000;
    var exportLimit = parseFloat(s.exportLimitKw) || 800;
    
    var labels = [];
    var dataPotential = generatePotentialCurve(capacity);
    var dataExported = [];
    var dataCurtailedEnv = [];

    /* Seed for deterministic noise */
    var seed = 42;
    function seededRandom() {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    }

    for (var i = 0; i < 96; i++) {
        var totalMin = i * 15;
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        labels.push((h < 10 ? '0' : '') + h + ':' + (m === 0 ? '00' : (m < 10 ? '0' + m : m)));

        var hourFrac = totalMin / 60;
        var potential = dataPotential[i];
        
        /* simulate base clouds */
        var clouds = (1 + (seededRandom() - 0.5) * 0.06);
        potential *= clouds;
        dataPotential[i] = potential; /* update the ideal curve to match */

        var exported = potential;
        var isCurtailedRule = false;

        if (exported > exportLimit) {
            isCurtailedRule = true;
            var rampZone = exportLimit * 0.05;
            if (exported > exportLimit + rampZone) {
                exported = exportLimit;
            } else {
                var t = (exported - exportLimit) / rampZone;
                exported = exportLimit - rampZone * (1 - t) * 0.1;
            }
            exported += (seededRandom() - 0.5) * exportLimit * 0.01;
            exported = Math.min(exported, exportLimit);
        }

        if (hourFrac >= 15.5 && hourFrac <= 16.0 && potential > exportLimit * 0.5) {
            isCurtailedRule = true;
            exported = Math.min(exported, exportLimit * 0.85);
        }

        if (hourFrac >= 13.0 && hourFrac <= 13.25) {
            var cloudFactor = 0.7 + seededRandom() * 0.15;
            exported = Math.min(exported, potential * cloudFactor);
            /* This is a natural cloud, not curtailment */
        }

        exported = Math.max(0, exported);
        dataExported.push(exported);

        if (isCurtailedRule && potential > exported) {
            dataCurtailedEnv.push(Math.max(potential, exported));
        } else {
            dataCurtailedEnv.push(exported);
        }
    }

    var startIdx = 20;
    var endIdx = 77;
    labels = labels.slice(startIdx, endIdx);
    dataPotential = dataPotential.slice(startIdx, endIdx);
    dataExported = dataExported.slice(startIdx, endIdx);
    dataCurtailedEnv = dataCurtailedEnv.slice(startIdx, endIdx);

    renderChartData(labels, dataPotential, dataExported, dataCurtailedEnv);
    updateTooltipSummary(dataPotential, dataExported, dataCurtailedEnv);
}

/* ────────── NO DATA STATE ────────── */
function renderNoData() {
    isLiveData = false;
    updateStatusBadge('nodata');
    if (myChart) {
        myChart.data.datasets.forEach(function (ds) { ds.data = []; });
        myChart.update();
    }
    $tooltip.html('No datasource configured.<br>Please add a telemetry source.');
}

/* ────────── GENERATE POTENTIAL CURVE ────────── */
function generatePotentialCurve(capacityVal) {
    var maxPower = capacityVal || parseFloat(s.maxPower) || 1000;
    var sunrise = parseFloat(s.sunriseHour) || 6;
    var sunset = parseFloat(s.sunsetHour) || 18;
    var curve = [];

    for (var i = 0; i < 96; i++) {
        var hourFrac = (i * 15) / 60;
        var val = 0;
        if (hourFrac > sunrise && hourFrac < sunset) {
            var x = (hourFrac - sunrise) / (sunset - sunrise) * Math.PI;
            val = Math.sin(x) * maxPower;
        }
        curve.push(Math.max(0, val));
    }
    return curve;
}

/* ────────── RENDER CHART DATA ────────── */
function renderChartData(labels, potential, exported, curtailedEnv) {
    if (!myChart) return;

    myChart.data.labels = labels;
    myChart.data.datasets[0].data = potential;
    myChart.data.datasets[1].data = exported;
    myChart.data.datasets[2].data = curtailedEnv;
    myChart.update('none');
}

/* ────────── STATUS BADGE ────────── */
function updateStatusBadge(state) {
    $statusDot.removeClass('live simulated nodata');

    if (state === 'live') {
        $statusDot.addClass('live');
        $statusText.text('LIVE');
    } else if (state === 'simulated') {
        $statusDot.addClass('simulated');
        $statusText.text('SIMULATED');
    } else {
        $statusDot.addClass('nodata');
        $statusText.text('NO DATA');
    }
}

/* ────────── DYNAMIC TOOLTIP ────────── */
function updateTooltipSummary(potential, exported, curtailedEnv) {
    if (s.tooltipText) return;

    var dec = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var unitLabel = s.unitLabel || 'kW';
    var marginPct = (s.theoreticalMargin !== undefined) ? parseFloat(s.theoreticalMargin) : 10;
    var intervalHours = 0.25; /* 15 minutes */

    var totalPotentialEnergy = 0;
    var totalExportedEnergy = 0;
    var totalCurtailedEnergy = 0;
    var peakPotential = 0;
    var peakExported = 0;

    for (var i = 0; i < potential.length; i++) {
        var pVal = potential[i] || 0;
        var eVal = (exported[i] !== null && exported[i] !== undefined) ? exported[i] : 0;
        var envVal = (curtailedEnv && curtailedEnv[i] !== null) ? curtailedEnv[i] : eVal;
        
        var curtailed = Math.max(envVal - eVal, 0);

        totalPotentialEnergy += pVal * intervalHours;
        totalExportedEnergy += eVal * intervalHours;
        totalCurtailedEnergy += curtailed * intervalHours;

        if (pVal > peakPotential) peakPotential = pVal;
        if (eVal > peakExported) peakExported = eVal;
    }

    var energyUnit = 'kWh';
    var energyDivisor = 1;
    if (totalPotentialEnergy > 1000) {
        energyUnit = 'MWh';
        energyDivisor = 1000;
    }

    var errorMargin = totalCurtailedEnergy * (marginPct / 100);

    var curtainPct = totalPotentialEnergy > 0 
        ? ((totalCurtailedEnergy / totalPotentialEnergy) * 100).toFixed(1) : '0.0';

    var lines = [
        'Peak Potential: ' + peakPotential.toFixed(dec) + ' ' + unitLabel +
        ' | Peak Exported: ' + peakExported.toFixed(dec) + ' ' + unitLabel,
        'Curtailed Energy: ' + (totalCurtailedEnergy / energyDivisor).toFixed(dec) +
        ' ' + energyUnit + ' (± ' + (errorMargin / energyDivisor).toFixed(dec) + ')',
        isLiveData ? 'Live telemetry evaluated.' : 'Simulated data for demonstration.'
    ];

    $tooltip.html(lines.join('<br>'));
}

/* ────────── LIFECYCLE: DATA UPDATED ────────── */
self.onDataUpdated = function () {
    fetchLiveData();
};

/* ────────── LIFECYCLE: RESIZE ────────── */
self.onResize = function () {
    var w = $el.width();
    var h = $el.height();
    if (!w || !h) return;

    var fromH = (h - 8) / 7.5;
    var fromW = w / 14;

    baseFontSize = Math.min(fromH, fromW);
    if (baseFontSize < 8) baseFontSize = 8;
    if (baseFontSize > 32) baseFontSize = 32;

    $el.find('.curt-card').css('font-size', baseFontSize + 'px');

    if (myChart) {
        var tickFont = Math.max(8, Math.min(14, baseFontSize * 0.5));
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
