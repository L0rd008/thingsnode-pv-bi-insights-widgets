/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V3 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   Chart.js envelope chart with dynamic bounds & settings memory
   ════════════════════════════════════════════════════ */

var $el, s, myChart;
var $title, $statusDot, $statusText;
var $yTitle, $tooltip, $modal;
var isLiveData = false;

/* ────────── LOCAL STORAGE CONFIG ────────── */
function loadSettings() {
    var defaultSettings = {
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
    $statusDot = $el.find('#status-dot');
    $statusText = $el.find('#status-text');
    $yTitle = $el.find('.js-y-title');
    $tooltip = $el.find('#custom-tooltip');
    $modal = $el.find('#settings-modal');

    updateDom();
    bindSettingsUI();
    initChart();
    self.onResize();

    /* ── Initial data fetch ── */
    fetchLiveData();
};

/* ────────── DOM SETUP ────────── */
function updateDom() {
    var unitLabel = s.displayUnit || 'kW';
    if ($yTitle.length) {
        $yTitle.text('POWER (' + unitLabel + ')');
    }
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
    var canvasEl = $el.find('#curtailment-chart')[0];
    if (!canvasEl) return;
    var ctx = canvasEl.getContext('2d');

    var crosshairPlugin = {
        id: 'crosshair',
        afterDraw: function (chart) {
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                var activePoint = chart.tooltip._active[0];
                var x = activePoint.element.x;
                var yAxis = chart.scales.y;
                var cCtx = chart.ctx;
                cCtx.save(); cCtx.beginPath();
                cCtx.moveTo(x, yAxis.top); cCtx.lineTo(x, yAxis.bottom);
                cCtx.lineWidth = 1; cCtx.strokeStyle = 'rgba(6, 245, 255, 0.25)';
                cCtx.setLineDash([3, 3]); cCtx.stroke(); cCtx.setLineDash([]); cCtx.restore();
            }
        }
    };

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Potential Power',
                    data: [],
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    borderWidth: 2, borderDash: [5, 5],
                    pointRadius: 0, pointHoverRadius: 0,
                    tension: 0.4, fill: false, order: 2
                },
                {
                    label: 'Exported Power',
                    data: [],
                    borderColor: '#06F5FF',
                    backgroundColor: 'rgba(6, 245, 255, 0.2)',
                    borderWidth: 2, pointRadius: 0,
                    pointHoverRadius: 4, pointHoverBackgroundColor: '#06F5FF',
                    tension: 0.4, fill: 'origin', order: 0
                },
                {
                    label: '_curtailed_envelope',
                    data: [],
                    borderColor: 'transparent',
                    borderWidth: 0, pointRadius: 0, pointHoverRadius: 0,
                    tension: 0.4, fill: {
                        target: 1,
                        above: 'rgba(229, 57, 53, 0.4)',
                        below: 'rgba(229, 57, 53, 0.4)'
                    }, order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: false,
                    external: function(context) { /* Using completely custom HTML tooltip overlay */ }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { color: '#90A4AE', autoSkip: true, maxTicksLimit: 8, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { color: '#90A4AE', font: { size: 10 } }
                }
            }
        },
        plugins: [crosshairPlugin]
    });
}

function parseCommaList(str) {
    if (!str) return [];
    return str.split(',').map(function(k) { return k.trim() }).filter(function(k) { return k.length > 0 });
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

    /* Uses Dashboard Timeseries Window */
    var timeWindow = self.ctx.timeWindow || {};
    var endTs = timeWindow.maxTime || Date.now();
    var startTs = timeWindow.minTime || (endTs - 24*3600*1000);

    var fetchTs = function() {
        var url = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr +
            '/values/timeseries?keys=' + tsKeys +
            '&startTs=' + startTs + '&endTs=' + endTs +
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
    var bucketCount = 96; /* Constant resolution to prevent chart lagging */
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
        var sunrise = 6; var sunset = 18;
        if (hrFrac < sunrise || hrFrac > sunset) {
            dataPotential.push(0);
        } else {
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
        var p = (hrFrac < 6 || hrFrac > 18) ? 0 : capacity * Math.sin(((hrFrac-6)/12)*Math.PI);
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
    $tooltip.html('No datasource configured. Select an Entity alias with timeseries capability.');
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

    var errorMarg = totalCurtEnergy * (s.theoreticalMargin / 100);

    var res = isLiveData ? 'Live Data Analyzed' : 'Simulated Data';
    $tooltip.html(res + ' | <b>Curtailed Energy in Window: ' + 
        (totalCurtEnergy/divisor).toFixed(2) + ' ' + unit + 
        ' (± ' + (errorMarg/divisor).toFixed(2) + ')</b>');
}

self.onResize = function () {
    if (myChart && $el) { myChart.resize(); }
};

self.onDestroy = function () {
    if (myChart) myChart.destroy();
};
