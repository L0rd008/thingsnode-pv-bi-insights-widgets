/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V3 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   Chart.js envelope chart with dynamic bounds & settings memory
   ════════════════════════════════════════════════════ */

var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $tooltip, $modal;
var $legendPotential, $legendExported, $legendCurtailed;
var isLiveData = false;

/* ────────── LOCAL STORAGE CONFIG ────────── */
function loadSettings() {
    var defaultSettings = {
        timeframe: 'today',
        actualPowerKeys: 'active_power',
        setpointKeys: 'setpoint_active_power, curtailment_limit',
        plantCapacityKey: 'Plant Total Capacity',
        capacityUnit: 'MW',
        displayUnit: 'kW',
        theoreticalMargin: 10,
        fallbackPower: 1000
    };
    try {
        var key = 'tb_curt_settings_' + self.ctx.widgetConfig.id;
        var saved = localStorage.getItem(key);
        if (saved) {
            var parsed = JSON.parse(saved);
            Object.assign(defaultSettings, parsed);
        }
    } catch (e) {}
    s = defaultSettings;
}

function saveSettings() {
    s.timeframe = $('#set-timeframe').val();
    s.actualPowerKeys = $('#set-actual-keys').val();
    s.setpointKeys = $('#set-setpoint-keys').val();
    s.plantCapacityKey = $('#set-capacity-key').val();
    s.capacityUnit = $('#set-cap-unit').val();
    s.displayUnit = $('#set-disp-unit').val();
    s.theoreticalMargin = parseFloat($('#set-err-margin').val()) || 10;
    s.fallbackPower = parseFloat($('#set-fallback-power').val()) || 1000;

    try {
        var key = 'tb_curt_settings_' + self.ctx.widgetConfig.id;
        localStorage.setItem(key, JSON.stringify(s));
    } catch (e) {}
}

function populateModal() {
    $('#set-timeframe').val(s.timeframe || 'today');
    $('#set-actual-keys').val(s.actualPowerKeys);
    $('#set-setpoint-keys').val(s.setpointKeys);
    $('#set-capacity-key').val(s.plantCapacityKey);
    $('#set-cap-unit').val(s.capacityUnit);
    $('#set-disp-unit').val(s.displayUnit);
    $('#set-err-margin').val(s.theoreticalMargin);
    $('#set-fallback-power').val(s.fallbackPower);
}

/* ────────── LIFECYCLE: INIT ────────── */
self.onInit = function () {
    $el = self.ctx.$container;
    loadSettings();

    /* ── cache DOM ── */
    $title = $el.find('.js-title');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $yTitle = $el.find('.js-y-title');
    $tooltip = $el.find('.js-tooltip');
    $modal = $el.find('#settings-modal');
    $legendPotential = $el.find('.js-legend-potential');
    $legendExported = $el.find('.js-legend-exported');
    $legendCurtailed = $el.find('.js-legend-curtailed');

    updateDom();
    bindSettingsUI();
    initChart();
    self.onResize();

    /* ── Initial data fetch ── */
    fetchLiveData();
};

/* ────────── DOM SETUP ────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');

    var unitLabel = s.displayUnit || 'kW';
    if ($yTitle.length) {
        $yTitle.text('POWER (' + unitLabel + ')');
    }

    if ($legendPotential.length) $legendPotential.text(s.potentialLineLabel || 'Potential Power');
    if ($legendExported.length) $legendExported.text(s.exportedAreaLabel || 'Exported Power');
    if ($legendCurtailed.length) $legendCurtailed.text(s.curtailmentLabel || 'Curtailed Energy');
}

function bindSettingsUI() {
    $el.find('#settings-btn').on('click', function() {
        populateModal();
        $modal.fadeIn(200);
    });

    $el.find('#btn-cancel').on('click', function() {
        $modal.fadeOut(200);
    });

    $el.find('#btn-save').on('click', function() {
        saveSettings();
        updateDom();
        $modal.fadeOut(200);
        fetchLiveData(); /* Reload completely */
    });
}

function updateStatusBadge(state) {
    if (!$statusDot.length) return;
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

/* ────────── CHART INITIALIZATION ────────── */
function initChart() {
    var canvasEl = $el.find('.js-canvas')[0];
    if (!canvasEl) return;
    var ctx = canvasEl.getContext('2d');

    var unitLabel = s.displayUnit || 'kW';
    var dec = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var showCurtLabel = (s.showCurtailmentLabel !== undefined) ? s.showCurtailmentLabel : true;
    var curtLabelText = s.curtailmentLabel || 'Curtailed Energy';

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

            labelX = Math.max(area.left + 30, Math.min(area.right - 30, labelX));
            labelY = Math.max(area.top + 10, Math.min(area.bottom - 10, labelY));

            cCtx.save();
            var fontSize = Math.max(10, Math.min(16, (baseFontSize || 14) * 0.55));
            cCtx.font = '700 ' + fontSize + 'px Roboto, sans-serif';
            cCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            cCtx.textAlign = 'center';
            cCtx.textBaseline = 'middle';

            cCtx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            cCtx.shadowBlur = 4;
            cCtx.shadowOffsetX = 1;
            cCtx.shadowOffsetY = 1;
            cCtx.fillText(curtLabelText, labelX, labelY);
            cCtx.restore();
        }
    };

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
                    grid: { color: 'rgba(255, 255, 255, 0.06)', drawBorder: false },
                    ticks: { color: '#90A4AE', font: { size: 10, family: 'Roboto, sans-serif' }, maxTicksLimit: 9, maxRotation: 0 }
                },
                y: {
                    beginAtZero: true,
                    min: 0,
                    grid: { color: 'rgba(255, 255, 255, 0.06)', drawBorder: false },
                    ticks: { color: '#90A4AE', font: { size: 10, family: 'Roboto, sans-serif' } }
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
                    filter: function (tooltipItem) { return tooltipItem.datasetIndex !== 2; },
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
                                return 'Loss Power: ' + curtailed.toFixed(dec) + ' ' + unitLabel;
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

function parseCommaList(str) {
    if (!str) return [];
    return str.split(',').map(function(k) { return k.trim() }).filter(function(k) { return k.length > 0 });
}

function getTimeBounds(timeframeStr) {
    var now = new Date();
    var startTs, endTs;
    var y = now.getFullYear();
    var m = now.getMonth();
    var d = now.getDate();

    if (timeframeStr === 'today') {
        startTs = new Date(y, m, d, 5, 0, 0).getTime();
        endTs = new Date(y, m, d, 19, 0, 0).getTime();
    } 
    else if (timeframeStr === 'yesterday') {
        startTs = new Date(y, m, d - 1, 5, 0, 0).getTime();
        endTs = new Date(y, m, d - 1, 19, 0, 0).getTime();
    }
    else if (timeframeStr === 'day_before') {
        startTs = new Date(y, m, d - 2, 5, 0, 0).getTime();
        endTs = new Date(y, m, d - 2, 19, 0, 0).getTime();
    }
    else if (timeframeStr === 'this_week') {
        var dayOfWeek = now.getDay() || 7; // make Sunday=7, Monday=1
        startTs = new Date(y, m, d - dayOfWeek + 1, 0, 0, 0).getTime();
        endTs = now.getTime();
    }
    else if (timeframeStr === 'prev_week') {
        var dayOfWeek2 = now.getDay() || 7;
        startTs = new Date(y, m, d - dayOfWeek2 - 6, 0, 0, 0).getTime();
        endTs = new Date(y, m, d - dayOfWeek2 + 1, 23, 59, 59).getTime();
    }
    else if (timeframeStr === 'this_month') {
        startTs = new Date(y, m, 1, 0, 0, 0).getTime();
        endTs = now.getTime();
    }
    else {
        startTs = new Date(y, m, d, 5, 0, 0).getTime();
        endTs = new Date(y, m, d, 19, 0, 0).getTime();
    }

    if (endTs > now.getTime()) {
        endTs = now.getTime(); /* Cap future intervals to now for live accuracy */
    }

    return { minTime: startTs, maxTime: Math.max(startTs + 1, endTs) };
}

/* ────────── LIVE DATA FETCH ────────── */
function fetchLiveData() {
    if (!self.ctx.datasources || self.ctx.datasources.length === 0) {
        renderNoData(); return;
    }

    var ds = self.ctx.datasources[0];
    var entityId = ds.entityId;
    var entityType = ds.entityType;

    if (!entityId || !entityType) { renderNoData(); return; }

    var entIdStr = (typeof entityId === 'object') ? entityId.id : entityId;
    var entTypeStr = (typeof entityType === 'string') ? entityType : entityId.entityType;

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var setpointKeys = parseCommaList(s.setpointKeys);
    var capacityKey = s.plantCapacityKey;
    var tsKeys = actualKeys.concat(setpointKeys).join(',');

    /* Manual timeframe override computation */
    var bounds = getTimeBounds(s.timeframe || 'today');
    var startTs = bounds.minTime;
    var endTs = bounds.maxTime;

    var fetchTs = function() {
        var url = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr +
            '/values/timeseries?keys=' + tsKeys +
            '&startTs=' + (startTs - 24*3600*1000) + '&endTs=' + endTs + /* lookback for setpoint steps */
            '&limit=50000&agg=NONE';
        
        try {
            self.ctx.http.get(url).subscribe(
                function (data) {
                    if (data && Object.keys(data).length > 0) {
                        processLiveTimeSeries(data, startTs, endTs);
                    } else {
                        loadSimulation(startTs, endTs);
                    }
                },
                function () { loadSimulation(startTs, endTs); }
            );
        } catch (e) { loadSimulation(startTs, endTs); }
    };

    var attrService = self.ctx.attributeService;
    if (attrService && capacityKey) {
        var entityObj = { id: entIdStr, entityType: entTypeStr };
        try {
            attrService.getEntityAttributes(entityObj, 'SERVER_SCOPE', [capacityKey])
                .subscribe(
                    function (data) {
                        try {
                            if (data && Array.isArray(data)) {
                                var found = data.find(function (a) { return a.key === capacityKey; });
                                if (found) self._capacityVal = found.value;
                            }
                        } catch (e) {}
                        fetchTs();
                    },
                    function () { fetchTs(); }
                );
        } catch (e) { fetchTs(); }
    } else {
        fetchTs();
    }
}

/* ────────── DATA PROCESSING ────────── */
function processLiveTimeSeries(rawData, minTime, maxTime) {
    isLiveData = true;
    updateStatusBadge('live');

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var setpointKeys = parseCommaList(s.setpointKeys);

    var rawActual = null;
    for (var i = 0; i < actualKeys.length; i++) {
        if (rawData[actualKeys[i]] && rawData[actualKeys[i]].length > 0) {
            rawActual = rawData[actualKeys[i]]; break;
        }
    }
    
    var rawSetpoint = null;
    for (var j = 0; j < setpointKeys.length; j++) {
        if (rawData[setpointKeys[j]] && rawData[setpointKeys[j]].length > 0) {
            rawSetpoint = rawData[setpointKeys[j]]; break;
        }
    }

    if (!rawActual) {
        loadSimulation(minTime, maxTime); return;
    }

    if (rawSetpoint) {
        rawSetpoint.sort(function(a, b) { return a.ts - b.ts; });
    }

    var getSetpointAtTime = function(ts) {
        if (!rawSetpoint || rawSetpoint.length === 0) return 100;
        var lastVal = 100; // Assumption
        for (var k = 0; k < rawSetpoint.length; k++) {
            if (rawSetpoint[k].ts <= ts) lastVal = parseFloat(rawSetpoint[k].value);
            else break;
        }
        return isNaN(lastVal) ? 100 : lastVal;
    };

    /* Dynamic Capacity */
    var capacity = parseFloat(self._capacityVal);
    if (isNaN(capacity) || capacity <= 0) capacity = parseFloat(s.fallbackPower) || 1000;
    
    var powUnit = s.displayUnit || 'kW';
    var capUnit = s.capacityUnit || 'MW';
    if (capUnit === 'MW' && powUnit === 'kW') capacity *= 1000;
    if (capUnit === 'kW' && powUnit === 'MW') capacity *= 0.001;

    /* Generate Time Buckets */
    var bucketCount = 96; /* Constant resolution */
    var bucketSizeMs = (maxTime - minTime) / bucketCount;

    var labels = [];
    var dataExported = new Array(bucketCount).fill(null);
    var dataCurtailedEnv = new Array(bucketCount).fill(null);
    
    var timeDiffHours = (maxTime - minTime) / (3600*1000);
    var formatOptions = (timeDiffHours > 36) ? 
        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } :
        { hour: '2-digit', minute: '2-digit' };

    for (var idx = 0; idx < bucketCount; idx++) {
        var bTs = minTime + (idx * bucketSizeMs);
        var labelStr = new Intl.DateTimeFormat('default', formatOptions).format(new Date(bTs));
        labels.push(labelStr);
    }

    /* Sine Potential mapped continuously per day in the interval! */
    var dataPotential = [];
    for (var i2 = 0; i2 < bucketCount; i2++) {
        var bT = minTime + (i2 * bucketSizeMs);
        var d = new Date(bT);
        var hrFrac = d.getHours() + (d.getMinutes() / 60);
        var sunrise = 5; var sunset = 19;
        if (hrFrac < sunrise || hrFrac > sunset) {
            dataPotential.push(0);
        } else {
            /* Squeeze sin curve tightly into 5:00 to 19:00 boundary */
            var frac = (hrFrac - sunrise) / (sunset - sunrise);
            dataPotential.push(capacity * Math.sin(frac * Math.PI));
        }
    }

    /* Map actual to buckets */
    for (var p = 0; p < rawActual.length; p++) {
        var tStamp = parseInt(rawActual[p].ts);
        var val = parseFloat(rawActual[p].value);
        if (isNaN(val)) continue;

        var tIdx = Math.floor((tStamp - minTime) / bucketSizeMs);
        if (tIdx >= 0 && tIdx < bucketCount) {
            if (dataExported[tIdx] === null) dataExported[tIdx] = val;
            else dataExported[tIdx] = (dataExported[tIdx] + val) / 2;
        }
    }

    /* Curtailment Envelope Step */
    for (var b = 0; b < bucketCount; b++) {
        if (dataExported[b] === null) continue;
        
        var midIdxTs = minTime + (b + 0.5) * bucketSizeMs;
        var setpointPct = getSetpointAtTime(midIdxTs);
        var allowedPower = capacity * (setpointPct / 100);

        if (setpointPct < 99 && dataPotential[b] > allowedPower) {
            dataCurtailedEnv[b] = Math.max(dataPotential[b], dataExported[b]);
        } else {
            dataCurtailedEnv[b] = dataExported[b];
        }
    }

    renderChartData(labels, dataPotential, dataExported, dataCurtailedEnv);
    updateSummary(dataPotential, dataExported, dataCurtailedEnv, bucketSizeMs);
}

/* ────────── FALLBACK SIMULATION ────────── */
function loadSimulation(minTime, maxTime) {
    isLiveData = false;
    updateStatusBadge('simulated');
    var capacity = parseFloat(s.fallbackPower) || 1000;
    var labels = [], potential = [], exported = [], curtailedEnv = [];
    
    var bCount = 96; var bSizeMs = (maxTime - minTime) / bCount;
    var timeDiffHours = (maxTime - minTime) / (3600*1000);
    var formatOptions = (timeDiffHours > 36) ? 
        { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } :
        { hour: '2-digit', minute: '2-digit' };
        
    for (var i = 0; i < bCount; i++) {
        var bt = minTime + i*bSizeMs;
        labels.push(new Intl.DateTimeFormat('default', formatOptions).format(new Date(bt)));
        
        var d = new Date(bt); var hrFrac = d.getHours() + (d.getMinutes()/60);
        var p = (hrFrac < 5 || hrFrac > 19) ? 0 : capacity * Math.sin(((hrFrac-5)/14)*Math.PI);
        potential.push(p);

        var exp = p * (1 - 0.1 * Math.random());
        var limit = capacity * 0.7;
        var isCurtailed = (exp > limit);
        if (isCurtailed) exp = limit * (1 - 0.05 * Math.random());
        
        exported.push(exp);
        curtailedEnv.push(isCurtailed ? Math.max(p, exp) : exp);
    }
    
    renderChartData(labels, potential, exported, curtailedEnv);
    updateSummary(potential, exported, curtailedEnv, bSizeMs);
}

function renderNoData() {
    isLiveData = false;
    updateStatusBadge('nodata');
    if (myChart) { myChart.data.datasets.forEach(function (ds) { ds.data = []; }); myChart.update(); }
    if ($tooltip && $tooltip.length) {
        $tooltip.html('No datasource configured. Select an Entity alias with timeseries capability.');
    }
}

function renderChartData(labels, p, e, c) {
    if (!myChart) return;
    myChart.data.labels = labels;
    myChart.data.datasets[0].data = p;
    myChart.data.datasets[1].data = e;
    myChart.data.datasets[2].data = c;
    myChart.update('none');
}

function updateSummary(potential, exported, curtailedEnv, bucketSizeMs) {
    if (!$tooltip || !$tooltip.length) return;
    
    var totalCurtEnergy = 0;
    var fractionOfHour = bucketSizeMs / (1000 * 3600);

    for (var i=0; i<curtailedEnv.length; i++) {
        var cVal = curtailedEnv[i]; var eVal = exported[i];
        if (cVal!=null && eVal!=null && cVal > eVal) {
            totalCurtEnergy += (cVal - eVal) * fractionOfHour;
        }
    }

    var divisor = 1; var unit = s.displayUnit || 'kW';
    if (totalCurtEnergy > 1000) { divisor = 1000; unit = (unit==='kW')?'MWh':'GWh'; }
    else { unit = unit + 'h'; }

    var errorMarg = totalCurtEnergy * ((parseFloat(s.theoreticalMargin) || 10) / 100);

    var res = isLiveData ? 'Live Data Analyzed' : 'Simulated Data';
    $tooltip.html(res + ' | <b>Total Curtailed Energy in View: ' + 
        (totalCurtEnergy/divisor).toFixed(2) + ' ' + unit + 
        ' (± ' + (errorMarg/divisor).toFixed(2) + ')</b>');
}

self.onResize = function () {
    if (myChart && $el) { 
        var cardHeight = $el.find('.curt-card').height() || 300;
        baseFontSize = Math.max(10, cardHeight * 0.05);
        myChart.resize(); 
    }
};

self.onDestroy = function () {
    if (myChart) myChart.destroy();
};
