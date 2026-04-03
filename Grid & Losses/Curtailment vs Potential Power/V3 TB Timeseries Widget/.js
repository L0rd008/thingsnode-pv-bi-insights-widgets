/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V4 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   ════════════════════════════════════════════════════

   ARCHITECTURE OVERVIEW
   ─────────────────────
   Dataset 0 — "Potential Power"  (dashed white line)
     Derived from actual active_power data.
     A half-sine bell is fitted between the first and last
     bucket where the plant was generating (> 0.5 % of rated
     capacity).  Outside those bounds the value is null so
     Chart.js renders nothing (no line at night).

   Dataset 1 — "Exported Power"  (solid cyan + fill to zero)
     Raw active_power bucketed into 96 equal intervals,
     averaged correctly (sum / count).

   Dataset 2 — "Curtailment Ceiling"  (invisible line)
     When setpoint < 100 %:  ceiling = capacity × setpoint%/100
     Otherwise:              ceiling = potential (no red fill)
     The fill between datasets 1 and 2 is red above → shows
     the power that was curtailed.

   Energy-loss calculation
   ───────────────────────
   For every curtailed bucket:
     loss[b] = max(0, potential[b] − ceiling[b]) × bucketHours
   This is the kWh the plant could have produced but was
   prevented from producing by the curtailment order.
   ════════════════════════════════════════════════════ */

var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $summaryBar, $modal;
var $legendPotential, $legendExported, $legendCurtailed;
var isLiveData = false;

/* ────────────────────────────────────────────────────
   SETTINGS
   ──────────────────────────────────────────────────── */
function loadSettings() {
    var def = {
        timeframe:         'today',
        actualPowerKeys:   'active_power',
        setpointKeys:      'setpoint_active_power, curtailment_limit',
        plantCapacityKey:  'Plant Total Capacity',
        capacityUnit:      'MW',
        displayUnit:       'kW',
        theoreticalMargin: 10,
        fallbackPower:     1000,
        decimals:          1
    };
    try {
        var stored = localStorage.getItem('tb_curt_settings_' + self.ctx.widgetConfig.id);
        if (stored) Object.assign(def, JSON.parse(stored));
    } catch (e) {}
    s = def;
}

function saveSettings() {
    s.timeframe         = $('#set-timeframe').val();
    s.actualPowerKeys   = $('#set-actual-keys').val();
    s.setpointKeys      = $('#set-setpoint-keys').val();
    s.plantCapacityKey  = $('#set-capacity-key').val();
    s.capacityUnit      = $('#set-cap-unit').val();
    s.displayUnit       = $('#set-disp-unit').val();
    s.theoreticalMargin = parseFloat($('#set-err-margin').val())     || 10;
    s.fallbackPower     = parseFloat($('#set-fallback-power').val()) || 1000;
    s.decimals          = parseInt($('#set-decimals').val())          || 1;
    try {
        localStorage.setItem('tb_curt_settings_' + self.ctx.widgetConfig.id, JSON.stringify(s));
    } catch (e) {}
}

function populateModal() {
    $('#set-timeframe').val(s.timeframe       || 'today');
    $('#set-actual-keys').val(s.actualPowerKeys);
    $('#set-setpoint-keys').val(s.setpointKeys);
    $('#set-capacity-key').val(s.plantCapacityKey);
    $('#set-cap-unit').val(s.capacityUnit);
    $('#set-disp-unit').val(s.displayUnit);
    $('#set-err-margin').val(s.theoreticalMargin);
    $('#set-fallback-power').val(s.fallbackPower);
    $('#set-decimals').val(s.decimals !== undefined ? s.decimals : 1);
}

/* ────────────────────────────────────────────────────
   LIFECYCLE
   ──────────────────────────────────────────────────── */
self.onInit = function () {
    $el = self.ctx.$container;
    loadSettings();

    $title           = $el.find('.js-title');
    $statusDot       = $el.find('.js-status-dot');
    $statusText      = $el.find('.js-status-text');
    $yTitle          = $el.find('.js-y-title');
    $summaryBar      = $el.find('.js-summary-bar');
    $modal           = $el.find('#settings-modal');
    $legendPotential = $el.find('.js-legend-potential');
    $legendExported  = $el.find('.js-legend-exported');
    $legendCurtailed = $el.find('.js-legend-curtailed');

    updateDom();
    bindSettingsUI();
    initChart();
    self.onResize();
    fetchLiveData();
};

/* ────────────────────────────────────────────────────
   DOM
   ──────────────────────────────────────────────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');
    if ($yTitle.length)          $yTitle.text('POWER (' + (s.displayUnit || 'kW') + ')');
    if ($legendPotential.length) $legendPotential.text('Potential Power');
    if ($legendExported.length)  $legendExported.text('Exported Power');
    if ($legendCurtailed.length) $legendCurtailed.text('Curtailment Loss');
}

function bindSettingsUI() {
    $el.find('#settings-btn').on('click', function () { populateModal(); $modal.fadeIn(200); });
    $el.find('#btn-cancel').on('click',   function () { $modal.fadeOut(200); });
    $el.find('#btn-save').on('click',     function () {
        saveSettings();
        updateDom();
        $modal.fadeOut(200);
        if (myChart) { myChart.destroy(); myChart = null; }
        initChart();
        fetchLiveData();
    });
}

function updateStatusBadge(state) {
    if (!$statusDot.length) return;
    $statusDot.removeClass('live simulated nodata');
    var MAP = { live: ['live','LIVE'], simulated: ['simulated','SIMULATED'], nodata: ['nodata','NO DATA'] };
    var pair = MAP[state] || MAP.nodata;
    $statusDot.addClass(pair[0]);
    $statusText.text(pair[1]);
}

/* ────────────────────────────────────────────────────
   CHART INIT
   ──────────────────────────────────────────────────── */
function initChart() {
    var canvasEl = $el.find('.js-canvas')[0];
    if (!canvasEl) return;
    var ctx       = canvasEl.getContext('2d');
    var unitLabel = s.displayUnit || 'kW';
    var dec       = parseInt(s.decimals) || 1;

    /* ─── inline canvas label plugin ─── */
    var labelPlugin = {
        id: 'curtLossLabel',
        afterDraw: function (chart) {
            var ds = chart.data.datasets;
            if (ds.length < 3) return;
            var potD = ds[0].data, expD = ds[1].data, ceilD = ds[2].data;
            if (!potD || !potD.length) return;
            var area = chart.chartArea; if (!area) return;
            var xs = chart.scales.x, ys = chart.scales.y, cc = chart.ctx;

            var maxLoss = 0, maxIdx = -1;
            for (var i = 0; i < ceilD.length; i++) {
                if (potD[i] == null || expD[i] == null || ceilD[i] == null) continue;
                var loss = ceilD[i] - expD[i];
                if (loss > maxLoss) { maxLoss = loss; maxIdx = i; }
            }
            if (maxIdx < 0 || maxLoss < 1) return;

            var topY = ys.getPixelForValue(ceilD[maxIdx]);
            var botY = ys.getPixelForValue(expD[maxIdx]);
            var lx   = xs.getPixelForValue(maxIdx);
            var ly   = (topY + botY) / 2;
            lx = Math.max(area.left + 36, Math.min(area.right - 36, lx));
            ly = Math.max(area.top + 10,  Math.min(area.bottom - 10, ly));

            var fs = Math.max(9, Math.min(13, (baseFontSize || 14) * 0.5));
            cc.save();
            cc.font         = '700 ' + fs + 'px Roboto,sans-serif';
            cc.fillStyle    = 'rgba(255,255,255,0.88)';
            cc.textAlign    = 'center';
            cc.textBaseline = 'middle';
            cc.shadowColor  = 'rgba(0,0,0,0.75)';
            cc.shadowBlur   = 4;
            cc.fillText('Curtailment Loss', lx, ly);
            cc.restore();
        }
    };

    /* ─── crosshair plugin ─── */
    var xhairPlugin = {
        id: 'crosshair',
        afterDraw: function (chart) {
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                var x  = chart.tooltip._active[0].element.x;
                var ya = chart.scales.y;
                var cc = chart.ctx;
                cc.save();
                cc.beginPath();
                cc.moveTo(x, ya.top); cc.lineTo(x, ya.bottom);
                cc.lineWidth = 1; cc.strokeStyle = 'rgba(6,245,255,0.3)';
                cc.setLineDash([3, 3]); cc.stroke(); cc.setLineDash([]);
                cc.restore();
            }
        }
    };

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                /* 0 — Potential Power */
                {
                    label: 'Potential Power',
                    data: [],
                    borderColor: 'rgba(255,255,255,0.55)',
                    borderWidth: 1.5,
                    segment: { borderDash: function () { return [6, 4]; } },
                    pointRadius: 0, pointHoverRadius: 3,
                    pointHoverBackgroundColor: 'rgba(255,255,255,0.7)',
                    tension: 0.35, fill: false, spanGaps: false, order: 3
                },
                /* 1 — Exported Power */
                {
                    label: 'Exported Power',
                    data: [],
                    borderColor: '#06F5FF', borderWidth: 2,
                    pointRadius: 0, pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#06F5FF',
                    pointHoverBorderColor: '#FFFFFF', pointHoverBorderWidth: 2,
                    tension: 0.35, fill: 'origin',
                    backgroundColor: 'rgba(6,245,255,0.15)',
                    spanGaps: true, order: 2
                },
                /* 2 — Curtailment Ceiling (invisible; fills red above dataset 1) */
                {
                    label: '_ceil',
                    data: [],
                    borderColor: 'transparent', borderWidth: 0,
                    pointRadius: 0, pointHoverRadius: 0,
                    tension: 0.35, spanGaps: false,
                    fill: { target: 1, above: 'rgba(229,57,53,0.38)', below: 'transparent' },
                    order: 1
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', axis: 'x', intersect: false },
            layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
            scales: {
                x: {
                    grid:  { color: 'rgba(255,255,255,0.06)', drawBorder: false },
                    ticks: { color: '#90A4AE', font: { size: 9, family: 'Roboto,sans-serif' }, maxTicksLimit: 10, maxRotation: 0 }
                },
                y: {
                    beginAtZero: true, min: 0,
                    grid:  { color: 'rgba(255,255,255,0.06)', drawBorder: false },
                    ticks: { color: '#90A4AE', font: { size: 9, family: 'Roboto,sans-serif' }, maxTicksLimit: 7 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(2,10,67,0.96)',
                    titleColor: '#90A4AE', bodyColor: '#FFFFFF',
                    bodyFont: { weight: '600', family: 'Roboto,sans-serif' },
                    borderColor: 'rgba(6,245,255,0.3)', borderWidth: 1,
                    cornerRadius: 4,
                    padding: { top: 6, right: 10, bottom: 6, left: 10 },
                    displayColors: false,
                    filter: function (item) { return item.datasetIndex !== 2; },
                    callbacks: {
                        title: function (items) { return items.length ? items[0].label : ''; },
                        label: function (ctx2) {
                            if (ctx2.parsed.y == null) return null;
                            return ctx2.dataset.label + ': ' + ctx2.parsed.y.toFixed(dec) + ' ' + unitLabel;
                        },
                        afterBody: function (items) {
                            if (!items.length) return '';
                            var cd   = items[0].chart.data;
                            var idx  = items[0].dataIndex;
                            var eVal = cd.datasets[1].data[idx];
                            var ceil = cd.datasets[2].data[idx];
                            var pot  = cd.datasets[0].data[idx];
                            if (pot == null || ceil == null) return '';
                            var loss = Math.max(pot - ceil, 0);
                            if (loss < 0.01) return '';
                            return '⚠ Curtailment Loss: ' + loss.toFixed(dec) + ' ' + unitLabel;
                        }
                    }
                }
            }
        },
        plugins: [labelPlugin, xhairPlugin]
    });
}

/* ────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────── */
function parseCommaList(str) {
    if (!str) return [];
    return str.split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
}

function getTimeBounds(tf) {
    var now = new Date();
    var y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    var st, et;
    if      (tf === 'today')      { st = new Date(y,mo,d,0,0,0).getTime();     et = new Date(y,mo,d,23,59,59).getTime(); }
    else if (tf === 'yesterday')  { st = new Date(y,mo,d-1,0,0,0).getTime();   et = new Date(y,mo,d-1,23,59,59).getTime(); }
    else if (tf === 'day_before') { st = new Date(y,mo,d-2,0,0,0).getTime();   et = new Date(y,mo,d-2,23,59,59).getTime(); }
    else if (tf === 'this_week')  {
        var dow = now.getDay() || 7;
        st = new Date(y,mo,d-dow+1,0,0,0).getTime(); et = now.getTime();
    }
    else if (tf === 'prev_week')  {
        var off = (now.getDay() || 7) - 1;
        var thisMon = new Date(y,mo,d-off,0,0,0);
        st = thisMon.getTime() - 7*86400000; et = thisMon.getTime() - 1000;
    }
    else if (tf === 'this_month') { st = new Date(y,mo,1,0,0,0).getTime(); et = now.getTime(); }
    else                          { st = new Date(y,mo,d,0,0,0).getTime(); et = new Date(y,mo,d,23,59,59).getTime(); }

    if (et > now.getTime()) et = now.getTime();
    return { minTime: st, maxTime: Math.max(st + 1, et) };
}

/* ────────────────────────────────────────────────────
   LIVE DATA FETCH
   ──────────────────────────────────────────────────── */
function fetchLiveData() {
    if (!self.ctx.datasources || !self.ctx.datasources.length) { renderNoData(); return; }

    var ds         = self.ctx.datasources[0];
    var rawId      = ds.entityId;
    var entIdStr   = (rawId && typeof rawId === 'object') ? rawId.id : rawId;
    var entTypeStr = ds.entityType || (rawId && typeof rawId === 'object' && rawId.entityType) || null;
    if (!entIdStr || !entTypeStr) { renderNoData(); return; }

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var spKeys     = parseCommaList(s.setpointKeys);
    var capKey     = s.plantCapacityKey;
    var tsKeys     = actualKeys.concat(spKeys).join(',');
    var bounds     = getTimeBounds(s.timeframe || 'today');
    var startTs    = bounds.minTime;
    var endTs      = bounds.maxTime;

    var doFetch = function () {
        var url = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr +
            '/values/timeseries?keys=' + encodeURIComponent(tsKeys) +
            '&startTs=' + (startTs - 2592000000) + '&endTs=' + endTs +
            '&limit=50000&agg=NONE';
        try {
            self.ctx.http.get(url).subscribe(
                function (data) {
                    if (data && Object.keys(data).length > 0) processLiveTimeSeries(data, startTs, endTs);
                    else loadSimulation(startTs, endTs);
                },
                function () { loadSimulation(startTs, endTs); }
            );
        } catch (e) { loadSimulation(startTs, endTs); }
    };

    var attrSvc = self.ctx.attributeService;
    if (attrSvc && capKey) {
        var entObj = { id: entIdStr, entityType: entTypeStr };
        try {
            attrSvc.getEntityAttributes(entObj, 'SERVER_SCOPE', [capKey]).subscribe(
                function (data) {
                    try {
                        if (data && Array.isArray(data)) {
                            var found = data.find(function (a) { return a.key === capKey; });
                            if (found) self._capacityVal = found.value;
                        }
                    } catch (e2) {}
                    doFetch();
                },
                function () { doFetch(); }
            );
        } catch (e) { doFetch(); }
    } else {
        doFetch();
    }
}

/* ────────────────────────────────────────────────────
   DATA PROCESSING — LIVE
   ──────────────────────────────────────────────────── */
function processLiveTimeSeries(rawData, minTime, maxTime) {
    isLiveData = true;
    updateStatusBadge('live');

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var spKeys     = parseCommaList(s.setpointKeys);

    /* first matching actual-power series */
    var rawActual = null;
    for (var i = 0; i < actualKeys.length; i++) {
        if (rawData[actualKeys[i]] && rawData[actualKeys[i]].length) {
            rawActual = rawData[actualKeys[i]]; break;
        }
    }
    if (!rawActual) { loadSimulation(minTime, maxTime); return; }

    /* first matching setpoint series */
    var rawSP = null;
    for (var j = 0; j < spKeys.length; j++) {
        if (rawData[spKeys[j]] && rawData[spKeys[j]].length) {
            rawSP = rawData[spKeys[j]]; break;
        }
    }
    if (rawSP) rawSP.sort(function (a, b) { return a.ts - b.ts; });

    /* step-hold interpolation for setpoint */
    var getSetpointPct = function (ts) {
        if (!rawSP || !rawSP.length) return 100;
        var last = 100;
        for (var k = 0; k < rawSP.length; k++) {
            if (rawSP[k].ts <= ts) last = parseFloat(rawSP[k].value);
            else break;
        }
        return isNaN(last) ? 100 : last;
    };

    /* capacity in display units */
    var capacity = parseFloat(self._capacityVal);
    if (isNaN(capacity) || capacity <= 0) capacity = parseFloat(s.fallbackPower) || 1000;
    var powUnit = s.displayUnit || 'kW';
    var capUnit = s.capacityUnit || 'MW';
    if (capUnit === 'MW' && powUnit === 'kW') capacity *= 1000;
    if (capUnit === 'kW' && powUnit === 'MW') capacity *= 0.001;

    /* 96 equal buckets */
    var N        = 96;
    var bucketMs = (maxTime - minTime) / N;
    var labels   = [];
    var bucketSum  = new Array(N).fill(0);
    var bucketHits = new Array(N).fill(0);
    var dataExported    = new Array(N).fill(null);
    var dataPotential   = new Array(N).fill(null);
    var dataCurtailCeil = new Array(N).fill(null);

    var timeDiffH = (maxTime - minTime) / 3600000;
    var fmtOpts   = (timeDiffH > 36)
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    var fmt = new Intl.DateTimeFormat('default', fmtOpts);
    for (var li = 0; li < N; li++) labels.push(fmt.format(new Date(minTime + li * bucketMs)));

    /* bucket the actual readings */
    rawActual.sort(function (a, b) { return a.ts - b.ts; });
    for (var p = 0; p < rawActual.length; p++) {
        var ts  = parseInt(rawActual[p].ts);
        var val = parseFloat(rawActual[p].value);
        if (isNaN(val) || ts < minTime || ts > maxTime) continue;
        var bi = Math.min(Math.floor((ts - minTime) / bucketMs), N - 1);
        bucketSum[bi]  += val;
        bucketHits[bi] += 1;
    }
    for (var bm = 0; bm < N; bm++) {
        dataExported[bm] = bucketHits[bm] > 0 ? bucketSum[bm] / bucketHits[bm] : null;
    }

    /* ── Potential power curve ─────────────────────────────────────────────
       We derive the potential curve entirely from the actual production data:
       - Find the FIRST bucket where exported > 0.5% rated capacity  (sunrise)
       - Find the LAST  bucket where exported > 0.5% rated capacity  (sunset)
       - Fit a half-sine bell between those two points, peak = capacity
       - Clamp from below: potential ≥ exported at every point
       This represents "what this plant COULD produce under clear-sky conditions"
       during the hours when it was actually operating today.
       ───────────────────────────────────────────────────────────────────── */
    var THRESHOLD = capacity * 0.005;   /* 0.5 % of rated = "sun is up" */
    var firstOn = -1, lastOn = -1;
    for (var fi = 0; fi < N; fi++) {
        if (dataExported[fi] !== null && dataExported[fi] > THRESHOLD) {
            if (firstOn === -1) firstOn = fi;
            lastOn = fi;
        }
    }

    if (firstOn >= 0 && lastOn > firstOn) {
        var span = lastOn - firstOn;
        for (var pi = firstOn; pi <= lastOn; pi++) {
            var frac = (pi - firstOn) / span;
            dataPotential[pi] = capacity * Math.sin(frac * Math.PI);
        }
        /* ensure potential ≥ exported (cloud-enhancement can briefly push
           actual above the smooth model — clamp prevents inverted red zone) */
        for (var ci2 = firstOn; ci2 <= lastOn; ci2++) {
            if (dataExported[ci2] !== null && dataPotential[ci2] < dataExported[ci2]) {
                dataPotential[ci2] = dataExported[ci2];
            }
        }
    } else if (firstOn >= 0 && firstOn === lastOn) {
        /* Only one active bucket (edge of day or very short window) */
        dataPotential[firstOn] = Math.max(dataExported[firstOn] || 0, capacity * 0.01);
    }
    /* All null outside → Chart.js draws nothing at night */

    /* ── Curtailment ceiling ───────────────────────────────────────────────
       ceiling[b] = capacity × (setpointPct / 100)  when setpoint < 99 %
                  = potential[b]                     otherwise (no red fill)

       Example: 10 MW plant, setpoint 10% → ceiling = 1 MW.
       If potential at that hour = 6 MW, loss = 5 MW.
       ───────────────────────────────────────────────────────────────────── */
    for (var b = 0; b < N; b++) {
        if (dataPotential[b] === null) { dataCurtailCeil[b] = null; continue; }
        var midTs  = minTime + (b + 0.5) * bucketMs;
        var spPct  = getSetpointPct(midTs);
        var ceiling = capacity * (spPct / 100);

        dataCurtailCeil[b] = (spPct < 99.0 && dataPotential[b] > ceiling)
            ? ceiling                 /* curtailed: red fill visible */
            : dataPotential[b];       /* not curtailed: ceiling = potential, no fill */
    }

    renderChartData(labels, dataPotential, dataExported, dataCurtailCeil);
    updateSummary(dataPotential, dataExported, dataCurtailCeil, bucketMs, capacity);
}

/* ────────────────────────────────────────────────────
   FALLBACK SIMULATION
   ──────────────────────────────────────────────────── */
function loadSimulation(minTime, maxTime) {
    isLiveData = false;
    updateStatusBadge('simulated');

    var capacity  = parseFloat(s.fallbackPower) || 1000;
    var N         = 96;
    var bMs       = (maxTime - minTime) / N;
    var timeDiffH = (maxTime - minTime) / 3600000;
    var fmtOpts   = (timeDiffH > 36)
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    var fmt = new Intl.DateTimeFormat('default', fmtOpts);

    var labels = [], potential = [], exported = [], ceiling = [];
    var SUN_RISE = 6.0, SUN_SET = 18.5;  /* realistic PV operating hours */

    for (var i = 0; i < N; i++) {
        var bt   = minTime + i * bMs;
        var dObj = new Date(bt);
        var hf   = dObj.getHours() + dObj.getMinutes() / 60;
        labels.push(fmt.format(dObj));

        if (hf < SUN_RISE || hf > SUN_SET) {
            potential.push(null); exported.push(null); ceiling.push(null); continue;
        }
        var frac = (hf - SUN_RISE) / (SUN_SET - SUN_RISE);
        var pot  = capacity * Math.sin(frac * Math.PI);
        potential.push(pot);

        /* Simulate curtailment 10:00 – 14:00, setpoint 40 % → ceiling = 0.40 × capacity */
        var curtailed = (hf >= 10.0 && hf <= 14.0);
        var cap40     = capacity * 0.40;
        var exp       = curtailed
            ? Math.min(pot, cap40) * (0.97 + 0.03 * Math.random())
            : pot * (0.92 + 0.05 * Math.random());
        exported.push(exp);
        ceiling.push(curtailed ? cap40 : pot);
    }

    renderChartData(labels, potential, exported, ceiling);
    updateSummary(potential, exported, ceiling, bMs, capacity);
}

/* ────────────────────────────────────────────────────
   RENDER / SUMMARY
   ──────────────────────────────────────────────────── */
function renderNoData() {
    isLiveData = false;
    updateStatusBadge('nodata');
    if (myChart) { myChart.data.datasets.forEach(function (ds) { ds.data = []; }); myChart.update(); }
    if ($summaryBar && $summaryBar.length) {
        $summaryBar.html('<span class="sb-item sb-warn">No datasource configured — assign an Entity alias with timeseries data.</span>');
    }
}

function renderChartData(labels, p, e, c) {
    if (!myChart) return;
    myChart.data.labels          = labels;
    myChart.data.datasets[0].data = p;
    myChart.data.datasets[1].data = e;
    myChart.data.datasets[2].data = c;
    myChart.update('none');
}

function updateSummary(potential, exported, ceiling, bucketMs, capacity) {
    if (!$summaryBar || !$summaryBar.length) return;

    var hPerBucket = bucketMs / 3600000;
    var dec        = parseInt(s.decimals) || 1;
    var unit       = s.displayUnit || 'kW';
    var eUnit      = unit + 'h';    /* kWh or MWh */

    var totalPotential = 0, totalExported = 0, totalLoss = 0, curtBuckets = 0;

    for (var i = 0; i < ceiling.length; i++) {
        var potV  = potential[i], expV = exported[i], ceilV = ceiling[i];
        if (potV  == null) continue;
        totalPotential += potV * hPerBucket;
        if (expV  != null) totalExported += expV * hPerBucket;
        if (ceilV != null) {
            /* Loss = potential that was blocked by the setpoint ceiling */
            var loss = Math.max(potV - ceilV, 0);
            if (loss > 0) { totalLoss += loss * hPerBucket; curtBuckets++; }
        }
    }

    var margin    = totalLoss * ((parseFloat(s.theoreticalMargin) || 10) / 100);
    var curtHours = (curtBuckets * bucketMs / 3600000).toFixed(1);
    var pctLost   = totalPotential > 0 ? ((totalLoss / totalPotential) * 100).toFixed(1) : '0.0';

    /* Auto-scale: kW → show in kWh; if huge, promote to MWh */
    var dispScale = 1, dispUnit = eUnit;
    if (unit === 'kW' && totalLoss > 9999) { dispScale = 1000; dispUnit = 'MWh'; }

    var statusStr = isLiveData ? 'Live' : 'Simulated';
    var html = '<span class="sb-item sb-label">' + statusStr + '</span>';

    if (totalLoss > 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-loss">⚠ Loss: <b>' +
                (totalLoss / dispScale).toFixed(dec) + ' ' + dispUnit + '</b>' +
                ' <span class="sb-muted">(±' + (margin / dispScale).toFixed(dec) + ')</span></span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-pct"><b>' + pctLost + '%</b> of potential</span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-muted">' + curtHours + ' h curtailed</span>';
    } else {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-ok">✔ No curtailment</span>';
    }

    html += '<span class="sb-sep">|</span>';
    html += '<span class="sb-item sb-muted">Potential: ' + (totalPotential / dispScale).toFixed(dec) + ' ' + dispUnit + '</span>';
    html += '<span class="sb-sep">|</span>';
    html += '<span class="sb-item sb-muted">Exported: '  + (totalExported  / dispScale).toFixed(dec) + ' ' + dispUnit + '</span>';

    $summaryBar.html(html);
}

self.onResize = function () {
    if (myChart && $el) {
        baseFontSize = Math.max(10, ($el.find('.curt-card').height() || 300) * 0.05);
        myChart.resize();
    }
};

self.onDestroy = function () { if (myChart) myChart.destroy(); };