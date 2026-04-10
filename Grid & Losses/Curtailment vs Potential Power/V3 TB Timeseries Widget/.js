/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V5 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   ════════════════════════════════════════════════════

   ARCHITECTURE OVERVIEW
   ─────────────────────
   Dataset 0 — "Potential Power"  (dashed white line, OPTIONAL)
     Half-sine bell fitted between sunrise/sunset buckets.
     Toggled via showPotentialCurve setting.

   Dataset 1 — "Exported Power"  (solid cyan + fill to zero)
     Raw active_power averaged into 5-min buckets (day view)
     or coarser buckets (week/month views).

   Dataset 2 — "Curtailment Ceiling"  (orange dashed line)
     When setpoint < 100%:  ceiling = capacity × setpoint%/100
     When setpoint >= 100%: ceiling = capacity (flat cap line)
     Visible line shows the limit. Red fill between ceiling
     and exported shows the curtailed energy.

   Dataset 3 — "Curtailment Markers"  (orange dots)
     Marks the first and last bucket of each curtailment event.

   Bucket strategy
   ───────────────
   Day views  (today/yesterday/day_before): 5-minute intervals
   Week views (this_week/prev_week):       15-minute intervals
   Month view (this_month):                60-minute intervals

   Display window
   ──────────────
   Day views:   5:00 AM → 7:00 PM (solar production hours)
   Multi-day:   Full 00:00 → 23:59

   Energy-loss calculation
   ───────────────────────
   For every curtailed bucket:
     loss[b] = max(0, capacity − ceiling[b]) × bucketHours
       (only when setpoint < 100% and ceiling < capacity)
   This is the energy the plant was prevented from producing.
   ════════════════════════════════════════════════════ */

var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $summaryBar, $modal;
var $legendPotentialWrap, $legendPotential, $legendExported, $legendCurtailed;
var $settingsBtn;
var isLiveData = false;

/* ── Timeframe display labels ── */
var TF_LABELS = {
    today: 'Today', yesterday: 'Yesterday', day_before: 'Day Before',
    this_week: 'This Week', prev_week: 'Prev Week', this_month: 'This Month'
};

/* ────────────────────────────────────────────────────
   SETTINGS
   ──────────────────────────────────────────────────── */
function loadSettings() {
    var def = {
        timeframe:         'today',
        actualPowerKeys:   'active_power',
        setpointKeys:      'setpoint_active_power, curtailment_limit',
        plantCapacityKey:  'Capacity',
        capacityUnit:      'kW',
        displayUnit:       'kW',
        theoreticalMargin: 10,
        fallbackPower:     1000,
        decimals:          1,
        showPotentialCurve: true
    };
    try {
        var stored = localStorage.getItem('tb_curt_settings_' + self.ctx.widgetConfig.id);
        if (stored) Object.assign(def, JSON.parse(stored));
    } catch (e) {}
    s = def;
}

function saveSettings() {
    s.actualPowerKeys   = $('#set-actual-keys').val();
    s.setpointKeys      = $('#set-setpoint-keys').val();
    s.plantCapacityKey  = $('#set-capacity-key').val();
    s.capacityUnit      = $('#set-cap-unit').val();
    s.theoreticalMargin = parseFloat($('#set-err-margin').val())     || 10;
    s.fallbackPower     = parseFloat($('#set-fallback-power').val()) || 1000;
    s.decimals          = parseInt($('#set-decimals').val())          || 1;
    s.showPotentialCurve = ($('#set-show-potential').val() === 'yes');
    try {
        localStorage.setItem('tb_curt_settings_' + self.ctx.widgetConfig.id, JSON.stringify(s));
    } catch (e) {}
}

function populateModal() {
    $('#set-actual-keys').val(s.actualPowerKeys);
    $('#set-setpoint-keys').val(s.setpointKeys);
    $('#set-capacity-key').val(s.plantCapacityKey);
    $('#set-cap-unit').val(s.capacityUnit);
    $('#set-err-margin').val(s.theoreticalMargin);
    $('#set-fallback-power').val(s.fallbackPower);
    $('#set-decimals').val(s.decimals !== undefined ? s.decimals : 1);
    $('#set-show-potential').val(s.showPotentialCurve ? 'yes' : 'no');
}

/* ────────────────────────────────────────────────────
   LIFECYCLE
   ──────────────────────────────────────────────────── */
self.onInit = function () {
    $el = self.ctx.$container;
    loadSettings();

    $title              = $el.find('.js-title');
    $statusDot          = $el.find('.js-status-dot');
    $statusText         = $el.find('.js-status-text');
    $yTitle             = $el.find('.js-y-title');
    $summaryBar         = $el.find('.js-summary-bar');
    $modal              = $el.find('#settings-modal');
    $legendPotentialWrap= $el.find('.js-legend-potential-wrap');
    $legendPotential    = $el.find('.js-legend-potential');
    $legendExported     = $el.find('.js-legend-exported');
    $legendCurtailed    = $el.find('.js-legend-curtailed');
    $settingsBtn        = $el.find('.js-settings-btn');

    applyRoleVisibility();
    updateDom();
    bindSettingsUI();
    bindCustomerDropdowns();
    initChart();
    self.onResize();
    fetchLiveData();
};

/* ────────────────────────────────────────────────────
   ROLE-BASED VISIBILITY
   ──────────────────────────────────────────────────── */
function isTenantAdmin() {
    try {
        var auth = self.ctx.currentUser && self.ctx.currentUser.authority;
        return (auth === 'TENANT_ADMIN' || auth === 'SYS_ADMIN');
    } catch (e) { return false; }
}

function applyRoleVisibility() {
    if (!isTenantAdmin()) {
        $settingsBtn.addClass('hidden');
    }
}

/* ────────────────────────────────────────────────────
   DOM
   ──────────────────────────────────────────────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');
    if ($yTitle.length) $yTitle.text('POWER (' + (s.displayUnit || 'kW') + ')');

    /* Potential power legend visibility — only on day views when enabled */
    if ($legendPotentialWrap.length) {
        $legendPotentialWrap.css('display', shouldShowPotential() ? 'flex' : 'none');
    }

    /* Sync customer dropdown labels */
    $el.find('.js-dd-tf-btn').text((TF_LABELS[s.timeframe] || 'Today') + ' ▾');
    $el.find('.js-dd-du-btn').text((s.displayUnit || 'kW') + ' ▾');

    /* Mark active items */
    $el.find('#dd-timeframe .cust-dropdown-item').removeClass('active')
       .filter('[data-value="' + s.timeframe + '"]').addClass('active');
    $el.find('#dd-dispunit .cust-dropdown-item').removeClass('active')
       .filter('[data-value="' + s.displayUnit + '"]').addClass('active');
}

function bindSettingsUI() {
    $settingsBtn.on('click', function () { populateModal(); $modal.fadeIn(200); });
    $el.find('#btn-cancel').on('click', function () { $modal.fadeOut(200); });
    $el.find('#btn-save').on('click', function () {
        saveSettings();
        updateDom();
        $modal.fadeOut(200);
        rebuildAndFetch();
    });
}

function bindCustomerDropdowns() {
    /* Timeframe dropdown */
    var $tfBtn  = $el.find('.js-dd-tf-btn');
    var $tfMenu = $el.find('.js-dd-tf-menu');
    $tfBtn.on('click', function (e) {
        e.stopPropagation();
        $el.find('.cust-dropdown-menu').not($tfMenu).hide();
        $tfMenu.toggle();
    });
    $tfMenu.on('click', '.cust-dropdown-item', function () {
        s.timeframe = $(this).data('value');
        persistSetting();
        updateDom();
        $tfMenu.hide();
        rebuildAndFetch();
    });

    /* Display Unit dropdown */
    var $duBtn  = $el.find('.js-dd-du-btn');
    var $duMenu = $el.find('.js-dd-du-menu');
    $duBtn.on('click', function (e) {
        e.stopPropagation();
        $el.find('.cust-dropdown-menu').not($duMenu).hide();
        $duMenu.toggle();
    });
    $duMenu.on('click', '.cust-dropdown-item', function () {
        s.displayUnit = $(this).data('value');
        persistSetting();
        updateDom();
        $duMenu.hide();
        rebuildAndFetch();
    });

    /* Click outside closes dropdowns */
    $(document).on('click', function () {
        $el.find('.cust-dropdown-menu').hide();
    });
}

function persistSetting() {
    try {
        localStorage.setItem('tb_curt_settings_' + self.ctx.widgetConfig.id, JSON.stringify(s));
    } catch (e) {}
}

function rebuildAndFetch() {
    if (myChart) { myChart.destroy(); myChart = null; }
    initChart();
    fetchLiveData();
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
            var expD = ds[1].data, ceilD = ds[2].data;
            if (!ceilD || !ceilD.length) return;
            var area = chart.chartArea; if (!area) return;
            var xs = chart.scales.x, ys = chart.scales.y, cc = chart.ctx;

            var maxLoss = 0, maxIdx = -1;
            for (var i = 0; i < ceilD.length; i++) {
                if (expD[i] == null || ceilD[i] == null) continue;
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

    /* ─── outlier-resistant Y-axis plugin ─── */
    var yClampPlugin = {
        id: 'yAxisOutlierClamp',
        beforeLayout: function (chart) {
            /* Collect all non-null values from datasets 0-2 */
            var vals = [];
            for (var di = 0; di <= 2 && di < chart.data.datasets.length; di++) {
                var arr = chart.data.datasets[di].data;
                if (!arr) continue;
                for (var vi = 0; vi < arr.length; vi++) {
                    if (arr[vi] != null && isFinite(arr[vi]) && arr[vi] >= 0) vals.push(arr[vi]);
                }
            }
            if (vals.length < 3) return;   /* not enough data to clamp */

            vals.sort(function (a, b) { return a - b; });
            var p99Idx = Math.floor(vals.length * 0.99);
            var p99    = vals[Math.min(p99Idx, vals.length - 1)];
            var yCapP99 = p99 * 1.15;

            /* Also cap at capacity if known */
            var yCap = yCapP99;
            if (chart._curtCapacity && chart._curtCapacity > 0) {
                var capCeil = chart._curtCapacity * 1.2;
                yCap = Math.min(yCapP99, capCeil);
            }

            /* Use suggestedMax so truly large values still render (aren't clipped) */
            if (chart.options.scales && chart.options.scales.y) {
                chart.options.scales.y.suggestedMax = Math.max(yCap, 1);
            }
        }
    };

    /* Dynamic tick limit based on timeframe */
    var tf = s.timeframe || 'today';
    var xTickLimit = 12;
    if (tf === 'this_week' || tf === 'prev_week') xTickLimit = 7;
    else if (tf === 'this_month') xTickLimit = 15;

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                /* 0 — Potential Power (optional) */
                {
                    label: 'Potential Power',
                    data: [],
                    borderColor: 'rgba(255,255,255,0.55)',
                    borderWidth: 1.5,
                    segment: { borderDash: function () { return [6, 4]; } },
                    pointRadius: 0, pointHoverRadius: 3,
                    pointHoverBackgroundColor: 'rgba(255,255,255,0.7)',
                    tension: 0.35,
                    fill: { target: 1, above: 'rgba(255,193,7,0.35)', below: 'transparent' },
                    spanGaps: false, order: 4,
                    hidden: !shouldShowPotential()
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
                    spanGaps: true, order: 3
                },
                /* 2 — Curtailment Ceiling (visible orange dashed + red fill above ds1) */
                {
                    label: 'Curtailment Limit',
                    data: [],
                    borderColor: '#FF9800',
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    pointRadius: 0, pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FF9800',
                    tension: 0.35, spanGaps: false,
                    fill: { target: 1, above: 'rgba(229,57,53,0.38)', below: 'transparent' },
                    order: 2
                },
                /* 3 — Curtailment Markers (start/end dots) */
                {
                    label: '_markers',
                    data: [],
                    borderColor: '#FF9800',
                    backgroundColor: '#FF9800',
                    borderWidth: 2,
                    pointRadius: 5,
                    pointStyle: 'circle',
                    pointHoverRadius: 7,
                    showLine: false,
                    fill: false,
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
                    ticks: { color: '#90A4AE', font: { size: 9, family: 'Roboto,sans-serif' }, maxTicksLimit: xTickLimit, maxRotation: 0 }
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
                    filter: function (item) { return item.datasetIndex <= 2; },
                    callbacks: {
                        title: function (items) { return items.length ? items[0].label : ''; },
                        label: function (ctx2) {
                            if (ctx2.datasetIndex === 3) return null;
                            if (ctx2.parsed.y == null) return null;
                            return ctx2.dataset.label + ': ' + ctx2.parsed.y.toFixed(dec) + ' ' + unitLabel;
                        },
                        afterBody: function (items) {
                            if (!items.length) return '';
                            var cd   = items[0].chart.data;
                            var idx  = items[0].dataIndex;
                            var potV = cd.datasets[0].data[idx];
                            var eVal = cd.datasets[1].data[idx];
                            var ceil = cd.datasets[2].data[idx];
                            var lines = [];
                            /* Total Loss (potential - actual) — day views only */
                            if (shouldShowPotential() && potV != null && eVal != null) {
                                var tl = Math.max(potV - eVal, 0);
                                if (tl >= 0.01) lines.push('⚡ Total Loss: ' + tl.toFixed(dec) + ' ' + unitLabel);
                            }
                            /* Curtailed Loss (ceiling - exported) */
                            if (eVal != null && ceil != null) {
                                var cl = Math.max(ceil - eVal, 0);
                                if (cl >= 0.01) lines.push('⚠ Curtailed Loss: ' + cl.toFixed(dec) + ' ' + unitLabel);
                            }
                            return lines.length ? lines.join('\n') : '';
                        }
                    }
                }
            }
        },
        plugins: [labelPlugin, xhairPlugin, yClampPlugin]
    });
}

/* ────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────── */
function parseCommaList(str) {
    if (!str) return [];
    return str.split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
}

function isDayView(tf) {
    return (tf === 'today' || tf === 'yesterday' || tf === 'day_before');
}

/* Potential curve is only physically meaningful for single-day views */
function shouldShowPotential() {
    return s.showPotentialCurve && isDayView(s.timeframe || 'today');
}

function getTimeBounds(tf) {
    var now = new Date();
    var y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    var st, et;

    if (tf === 'today') {
        st = new Date(y, mo, d, 5, 0, 0).getTime();   /* 5 AM */
        et = new Date(y, mo, d, 19, 0, 0).getTime();   /* 7 PM */
    }
    else if (tf === 'yesterday') {
        st = new Date(y, mo, d-1, 5, 0, 0).getTime();
        et = new Date(y, mo, d-1, 19, 0, 0).getTime();
    }
    else if (tf === 'day_before') {
        st = new Date(y, mo, d-2, 5, 0, 0).getTime();
        et = new Date(y, mo, d-2, 19, 0, 0).getTime();
    }
    else if (tf === 'this_week') {
        var dow = now.getDay() || 7;
        st = new Date(y, mo, d-dow+1, 0, 0, 0).getTime();
        et = now.getTime();
    }
    else if (tf === 'prev_week') {
        var off = (now.getDay() || 7) - 1;
        var thisMon = new Date(y, mo, d-off, 0, 0, 0);
        st = thisMon.getTime() - 7*86400000;
        et = thisMon.getTime() - 1000;
    }
    else if (tf === 'this_month') {
        st = new Date(y, mo, 1, 0, 0, 0).getTime();
        et = now.getTime();
    }
    else {
        st = new Date(y, mo, d, 5, 0, 0).getTime();
        et = new Date(y, mo, d, 19, 0, 0).getTime();
    }

    if (et > now.getTime()) et = now.getTime();
    return { minTime: st, maxTime: Math.max(st + 1, et) };
}

function getBucketMs(tf) {
    if (isDayView(tf))                                      return 5  * 60 * 1000;  /* 5 min */
    if (tf === 'this_week' || tf === 'prev_week')           return 15 * 60 * 1000;  /* 15 min */
    return 60 * 60 * 1000;                                                           /* 1 hour */
}

/* ────────────────────────────────────────────────────
   LIVE DATA FETCH  (parallel capacity + telemetry)
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
    var bounds     = getTimeBounds(s.timeframe || 'today');
    var startTs    = bounds.minTime;
    var endTs      = bounds.maxTime;
    var bucketMs   = getBucketMs(s.timeframe || 'today');

    var baseUrl = '/api/plugins/telemetry/' + entTypeStr + '/' + entIdStr;

    /* ── We fire up to 3 requests in parallel ── */
    var capacityDone = false, powerDone = false, setpointDone = false;
    var powerData = null, setpointData = null;

    var tryProcess = function () {
        if (!capacityDone || !powerDone || !setpointDone) return;
        var merged = {};
        if (powerData)    Object.assign(merged, powerData);
        if (setpointData) Object.assign(merged, setpointData);
        if (merged && Object.keys(merged).length > 0) {
            processLiveTimeSeries(merged, startTs, endTs, bucketMs);
        } else {
            loadSimulation(startTs, endTs, bucketMs);
        }
    };

    /* 1) Capacity attribute */
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
                    capacityDone = true; tryProcess();
                },
                function () { capacityDone = true; tryProcess(); }
            );
        } catch (e) { capacityDone = true; tryProcess(); }
    } else {
        capacityDone = true;
    }

    /* 2) Power telemetry — use server-side aggregation */
    var powerKeys = actualKeys.join(',');
    var powerUrl = baseUrl + '/values/timeseries?keys=' + encodeURIComponent(powerKeys) +
        '&startTs=' + startTs + '&endTs=' + endTs +
        '&interval=' + bucketMs + '&agg=AVG&limit=50000';
    try {
        self.ctx.http.get(powerUrl).subscribe(
            function (data) { powerData = data; powerDone = true; tryProcess(); },
            function ()     { powerDone = true; tryProcess(); }
        );
    } catch (e) { powerDone = true; tryProcess(); }

    /* 3) Setpoint telemetry — raw with lookback (small dataset) */
    var spKeysStr = spKeys.join(',');
    if (spKeysStr) {
        var spUrl = baseUrl + '/values/timeseries?keys=' + encodeURIComponent(spKeysStr) +
            '&startTs=' + (startTs - 2592000000) + '&endTs=' + endTs +
            '&limit=10000&agg=NONE';
        try {
            self.ctx.http.get(spUrl).subscribe(
                function (data) { setpointData = data; setpointDone = true; tryProcess(); },
                function ()     { setpointDone = true; tryProcess(); }
            );
        } catch (e) { setpointDone = true; tryProcess(); }
    } else {
        setpointDone = true;
    }

    /* If both capacity and setpoint were synchronous, kick off */
    tryProcess();
}

/* ────────────────────────────────────────────────────
   DATA PROCESSING — LIVE
   ──────────────────────────────────────────────────── */
function processLiveTimeSeries(rawData, minTime, maxTime, bucketMs) {
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
    if (!rawActual) { loadSimulation(minTime, maxTime, bucketMs); return; }

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
    var capUnit = s.capacityUnit || 'kW';
    if (capUnit === 'MW' && powUnit === 'kW') capacity *= 1000;
    if (capUnit === 'kW' && powUnit === 'MW') capacity *= 0.001;

    /* Scale factor for telemetry values (always reported in kW from TB) */
    var dataScale = (powUnit === 'MW') ? 0.001 : 1;

    /* dynamic buckets */
    var N = Math.max(1, Math.floor((maxTime - minTime) / bucketMs));
    var labels      = [];
    var bucketSum   = new Array(N).fill(0);
    var bucketHits  = new Array(N).fill(0);
    var dataExported    = new Array(N).fill(null);
    var dataPotential   = new Array(N).fill(null);
    var dataCurtailCeil = new Array(N).fill(null);
    var dataMarkers     = new Array(N).fill(null);

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
        dataExported[bm] = bucketHits[bm] > 0 ? (bucketSum[bm] / bucketHits[bm]) * dataScale : null;
    }

    /* ── Potential power curve (only on day views when enabled) ──────────── */
    if (shouldShowPotential()) {
        var THRESHOLD = capacity * 0.005;
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
            for (var ci2 = firstOn; ci2 <= lastOn; ci2++) {
                if (dataExported[ci2] !== null && dataPotential[ci2] < dataExported[ci2]) {
                    dataPotential[ci2] = dataExported[ci2];
                }
            }
        } else if (firstOn >= 0 && firstOn === lastOn) {
            dataPotential[firstOn] = Math.max(dataExported[firstOn] || 0, capacity * 0.01);
        }
    }

    /* ── Curtailment ceiling ───────────────────────────────────────────────
       ceiling[b] = capacity × (setpointPct / 100)   when setpoint < 100%
                  = null                              otherwise (no ceiling drawn)

       The ceiling is always relative to full capacity (not the sine curve),
       because curtailment is a hard limit from the grid operator.
       ───────────────────────────────────────────────────────────────────── */
    var curtailActive = false;
    for (var b = 0; b < N; b++) {
        if (dataExported[b] === null) { dataCurtailCeil[b] = null; continue; }
        var midTs  = minTime + (b + 0.5) * bucketMs;
        var spPct  = getSetpointPct(midTs);

        if (spPct < 100.0) {
            var ceiling = capacity * (spPct / 100);
            dataCurtailCeil[b] = ceiling;

            /* Mark start/end of curtailment events */
            if (!curtailActive) {
                dataMarkers[b] = ceiling;   /* curtailment start */
                curtailActive = true;
            }
        } else {
            if (curtailActive && b > 0) {
                dataMarkers[b - 1] = dataCurtailCeil[b - 1];   /* curtailment end */
            }
            dataCurtailCeil[b] = null;
            curtailActive = false;
        }
    }
    /* If curtailment was active at the very last bucket, mark it as end */
    if (curtailActive && N > 0 && dataCurtailCeil[N - 1] !== null) {
        dataMarkers[N - 1] = dataCurtailCeil[N - 1];
    }

    renderChartData(labels, dataPotential, dataExported, dataCurtailCeil, dataMarkers, capacity);
    updateSummary(dataPotential, dataExported, dataCurtailCeil, bucketMs, capacity);
}

/* ────────────────────────────────────────────────────
   FALLBACK SIMULATION
   ──────────────────────────────────────────────────── */
function loadSimulation(minTime, maxTime, bucketMs) {
    isLiveData = false;
    updateStatusBadge('simulated');

    var capacity  = parseFloat(s.fallbackPower) || 1000;
    var N         = Math.max(1, Math.floor((maxTime - minTime) / bucketMs));
    var timeDiffH = (maxTime - minTime) / 3600000;
    var fmtOpts   = (timeDiffH > 36)
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    var fmt = new Intl.DateTimeFormat('default', fmtOpts);

    var labels = [], potential = [], exported = [], ceiling = [], markers = [];
    var SUN_RISE = 5.0, SUN_SET = 19.0;

    var prevCurt = false;
    for (var i = 0; i < N; i++) {
        var bt   = minTime + i * bucketMs;
        var dObj = new Date(bt);
        var hf   = dObj.getHours() + dObj.getMinutes() / 60;
        labels.push(fmt.format(dObj));

        if (hf < SUN_RISE || hf > SUN_SET) {
            potential.push(null); exported.push(null); ceiling.push(null); markers.push(null);
            prevCurt = false;
            continue;
        }
        var frac = (hf - SUN_RISE) / (SUN_SET - SUN_RISE);
        var pot  = capacity * Math.sin(frac * Math.PI);
        potential.push(shouldShowPotential() ? pot : null);

        var curtailed = (hf >= 10.0 && hf <= 14.0);
        var cap40     = capacity * 0.40;
        var exp       = curtailed
            ? Math.min(pot, cap40) * (0.97 + 0.03 * Math.random())
            : pot * (0.92 + 0.05 * Math.random());
        exported.push(exp);

        if (curtailed) {
            ceiling.push(cap40);
            if (!prevCurt) { markers.push(cap40); } else { markers.push(null); }
            prevCurt = true;
        } else {
            if (prevCurt && i > 0) { markers[i - 1] = ceiling[i - 1]; }
            ceiling.push(null);
            markers.push(null);
            prevCurt = false;
        }
    }
    /* end marker if curtailment active at last bucket */
    if (prevCurt && N > 0 && ceiling[N - 1] !== null) {
        markers[N - 1] = ceiling[N - 1];
    }

    renderChartData(labels, potential, exported, ceiling, markers, capacity);
    updateSummary(potential, exported, ceiling, bucketMs, capacity);
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

function renderChartData(labels, p, e, c, m, capacity) {
    if (!myChart) return;
    myChart.data.labels           = labels;
    myChart.data.datasets[0].data = p;
    myChart.data.datasets[1].data = e;
    myChart.data.datasets[2].data = c;
    myChart.data.datasets[3].data = m;

    var showPot = shouldShowPotential();
    myChart.data.datasets[0].hidden = !showPot;

    /* Red fill: between ceiling and potential (day) or ceiling and exported (multi-day) */
    myChart.data.datasets[2].fill = {
        target: showPot ? 0 : 1,
        above: 'rgba(229,57,53,0.38)',
        below: 'transparent'
    };

    /* Total-loss legend visibility (yellow block only meaningful when potential is shown) */
    var $tlWrap = $el.find('.js-legend-total-loss-wrap');
    if ($tlWrap.length) $tlWrap.css('display', showPot ? 'flex' : 'none');

    /* Store capacity on chart instance for the Y-axis outlier clamp plugin */
    myChart._curtCapacity = capacity || 0;
    myChart.update('none');
}

function updateSummary(potential, exported, ceiling, bucketMs, capacity) {
    if (!$summaryBar || !$summaryBar.length) return;

    var hPerBucket = bucketMs / 3600000;
    var dec        = parseInt(s.decimals) || 1;
    var unit       = s.displayUnit || 'kW';
    var eUnit      = unit + 'h';
    var hasPot     = shouldShowPotential();

    var totalExported = 0, curtailedLoss = 0, totalLoss = 0, curtBuckets = 0;
    var totalPotentialEnergy = 0;
    var activeBuckets = 0;

    var N = Math.max(exported.length, ceiling.length);
    for (var i = 0; i < N; i++) {
        var expV  = (i < exported.length)  ? exported[i]  : null;
        var ceilV = (i < ceiling.length)   ? ceiling[i]   : null;
        var potV  = (potential && i < potential.length) ? potential[i] : null;

        if (expV != null) {
            totalExported += expV * hPerBucket;
            activeBuckets++;
        }

        /* Curtailed Loss: energy lost due to grid curtailment = (capacity - ceiling) per curtailed bucket */
        if (ceilV != null && expV != null) {
            var cLoss = Math.max(capacity - ceilV, 0);
            if (cLoss > 0) { curtailedLoss += cLoss * hPerBucket; curtBuckets++; }
        }

        /* Total Loss: energy lost relative to potential = (potential - actual) per bucket (day views only) */
        if (hasPot && potV != null && expV != null) {
            var tLoss = Math.max(potV - expV, 0);
            totalLoss += tLoss * hPerBucket;
        }

        if (hasPot && potV != null) {
            totalPotentialEnergy += potV * hPerBucket;
        }
    }

    var totalCapacityEnergy = capacity * activeBuckets * hPerBucket;
    var curtMargin    = curtailedLoss * ((parseFloat(s.theoreticalMargin) || 10) / 100);
    var curtHours     = (curtBuckets * bucketMs / 3600000).toFixed(1);

    /* ── Curtailed Loss % ── */
    var curtPct, curtPctLabel;
    if (hasPot && totalPotentialEnergy > 0) {
        curtPct = ((curtailedLoss / totalPotentialEnergy) * 100).toFixed(1);
        curtPctLabel = 'of potential';
    } else if (totalCapacityEnergy > 0) {
        curtPct = ((curtailedLoss / totalCapacityEnergy) * 100).toFixed(1);
        curtPctLabel = 'of capacity';
    } else {
        curtPct = '0.0';
        curtPctLabel = 'of capacity';
    }

    /* ── Display scaling for large numbers ── */
    var cDispScale = 1, cDispUnit = eUnit;
    if (unit === 'kW' && curtailedLoss > 9999) { cDispScale = 1000; cDispUnit = 'MWh'; }

    var tDispScale = 1, tDispUnit = eUnit;
    if (unit === 'kW' && totalLoss > 9999) { tDispScale = 1000; tDispUnit = 'MWh'; }

    var expDispScale = 1, expDispUnit = eUnit;
    if (unit === 'kW' && totalExported > 9999) { expDispScale = 1000; expDispUnit = 'MWh'; }

    /* ── Build HTML ── */
    var statusStr = isLiveData ? 'Live' : 'Simulated';
    var html = '<span class="sb-item sb-label">' + statusStr + '</span>';

    /* Total Loss — only on day views where potential is available */
    if (hasPot && totalLoss > 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item" style="color:#FFC107;">Total Loss: <b>' +
                (totalLoss / tDispScale).toFixed(dec) + ' ' + tDispUnit + '</b></span>';
        if (totalPotentialEnergy > 0) {
            var totalPct = ((totalLoss / totalPotentialEnergy) * 100).toFixed(1);
            html += '<span class="sb-sep">|</span>';
            html += '<span class="sb-item sb-pct" style="color:#FFD54F;"><b>' + totalPct + '%</b> of potential</span>';
        }
    }

    /* Curtailed Loss — always shown when curtailment exists */
    if (curtailedLoss > 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-loss">Curtailed Loss: <b>' +
                (curtailedLoss / cDispScale).toFixed(dec) + ' ' + cDispUnit + '</b>' +
                ' <span class="sb-muted">(±' + (curtMargin / cDispScale).toFixed(dec) + ')</span></span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-pct"><b>' + curtPct + '%</b> ' + curtPctLabel + '</span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-muted">' + curtHours + ' h curtailed</span>';
    }

    /* No losses at all */
    if (curtailedLoss <= 0.001 && (!hasPot || totalLoss <= 0.001)) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-ok">✔ No losses detected</span>';
    }

    html += '<span class="sb-sep">|</span>';
    html += '<span class="sb-item sb-muted">Exported: ' + (totalExported / expDispScale).toFixed(dec) + ' ' + expDispUnit + '</span>';

    $summaryBar.html(html);
}

self.onResize = function () {
    if (myChart && $el) {
        baseFontSize = Math.max(10, ($el.find('.curt-card').height() || 300) * 0.05);
        myChart.resize();
    }
};

self.onDestroy = function () { if (myChart) myChart.destroy(); };
