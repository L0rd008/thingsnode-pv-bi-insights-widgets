/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V4
   ThingsBoard v4.2.1.1 PE | Latest Values Widget
   Chart.js envelope chart with simulation fallback
   + Setpoint limit line (amber dashed/stepped)
   + Multi-key fix with debounce
   ════════════════════════════════════════════════════ */

var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $tooltip;
var $legendPotential, $legendExported, $legendCurtailed, $legendSetpoint;
var $dateLabel, $datePicker, $datePrev, $dateNext, $interval;
var isLiveData = false;
var _fetchTimer = null;
var _selectedDate = null; /* null = today */

/* ────────── LIFECYCLE: INIT ────────── */
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;

    /* ── cache DOM ── */
    $title          = $el.find('.js-title');
    $statusDot      = $el.find('.js-status-dot');
    $statusText     = $el.find('.js-status-text');
    $yTitle         = $el.find('.js-y-title');
    $tooltip        = $el.find('.js-tooltip');
    $legendPotential = $el.find('.js-legend-potential');
    $legendExported  = $el.find('.js-legend-exported');
    $legendCurtailed = $el.find('.js-legend-curtailed');
    $legendSetpoint  = $el.find('.js-legend-setpoint');
    $dateLabel       = $el.find('.js-date-label');
    $datePicker      = $el.find('.js-date-picker');
    $datePrev        = $el.find('.js-date-prev');
    $dateNext        = $el.find('.js-date-next');
    $interval        = $el.find('.js-interval');

    updateDom();
    initChart();
    initDateNav();
    initIntervalNav();
    self.onResize();

    /* ── Attempt live data fetch ── */
    debouncedFetch();
};

/* ────────── DEBOUNCED FETCH ────────── */
/* Prevents rapid re-fetches when ThingsBoard fires
   onDataUpdated multiple times for multi-key datasources */
function debouncedFetch() {
    if (_fetchTimer) clearTimeout(_fetchTimer);
    _fetchTimer = setTimeout(function () {
        _fetchTimer = null;
        fetchLiveData();
    }, 250);
}

/* ────────── DOM SETUP ────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');

    var unitLabel = s.unitLabel || 'kW';
    $yTitle.text('POWER (' + unitLabel + ')');

    $legendPotential.text(s.potentialLineLabel || 'Potential Power');
    $legendExported.text(s.exportedAreaLabel  || 'Exported Power');
    $legendCurtailed.text(s.curtailmentLabel  || 'Curtailed Energy');
    $legendSetpoint.text(s.setpointLineLabel  || 'Setpoint Limit');

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

/* ────────── DATE NAVIGATION ────────── */
function initDateNav() {
    _selectedDate = null; /* start with today */
    updateDateLabel();

    /* Previous day */
    $datePrev.on('click', function () {
        var d = getSelectedDateObj();
        d.setDate(d.getDate() - 1);
        _selectedDate = d;
        updateDateLabel();
        debouncedFetch();
    });

    /* Next day */
    $dateNext.on('click', function () {
        var d = getSelectedDateObj();
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 1);
        /* Don't go past today */
        if (d.getTime() > today.getTime()) {
            _selectedDate = null; /* back to today */
        } else {
            _selectedDate = d;
        }
        updateDateLabel();
        debouncedFetch();
    });

    /* Click on label opens date picker */
    $dateLabel.on('click', function () {
        var pickerEl = $datePicker[0];
        if (pickerEl) {
            pickerEl.value = formatDateISO(getSelectedDateObj());
            pickerEl.showPicker ? pickerEl.showPicker() : pickerEl.click();
        }
    });

    /* Date picker change */
    $datePicker.on('change', function () {
        var val = $(this).val();
        if (!val) return;
        var parts = val.split('-');
        var picked = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        if (picked.getTime() >= today.getTime()) {
            _selectedDate = null;
        } else {
            _selectedDate = picked;
        }
        updateDateLabel();
        debouncedFetch();
    });
}

function getSelectedDateObj() {
    if (_selectedDate) return new Date(_selectedDate);
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDateISO(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function updateDateLabel() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var sel = getSelectedDateObj();
    var isToday = (sel.getTime() === today.getTime());

    if (isToday) {
        $dateLabel.text('Today \u2014 ' + formatDateISO(sel)).addClass('is-today');
        $dateNext.prop('disabled', true);
    } else {
        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        $dateLabel.text(dayNames[sel.getDay()] + ' \u2014 ' + formatDateISO(sel)).removeClass('is-today');
        $dateNext.prop('disabled', false);
    }

    /* Set max date on picker */
    $datePicker.attr('max', formatDateISO(today));
}

/* ────────── INTERVAL SELECTOR ────────── */
function getInterval() {
    if (!$interval || !$interval.length) return 5;
    return parseInt($interval.val()) || 5;
}

function initIntervalNav() {
    $interval.on('change', function () {
        debouncedFetch();
    });
}

/* Also update daylight slice indices dynamically */
function getDaylightSlice(bucketMin) {
    var buckets = Math.floor(1440 / bucketMin);
    var start   = Math.floor(300 / bucketMin);  /* 05:00 = 300 min */
    var end     = Math.floor(1155 / bucketMin); /* 19:15 = 1155 min */
    return { start: start, end: Math.min(end, buckets) };
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
    var lineTension   = (s.smoothLines !== undefined && s.smoothLines === false) ? 0 : 0.4;

    /* ── Plugin: Curtailment Label Overlay ── */
    var curtailmentLabelPlugin = {
        id: 'curtailmentLabel',
        afterDraw: function (chart) {
            if (!showCurtLabel) return;
            var datasets = chart.data.datasets;
            if (datasets.length < 3) return;

            var potentialData = datasets[0].data;
            var exportedData  = datasets[1].data;
            var envData       = datasets[2].data;
            if (!potentialData || !exportedData || potentialData.length === 0) return;

            var area = chart.chartArea;
            if (!area) return;
            var xScale = chart.scales.x;
            var yScale = chart.scales.y;
            var cCtx   = chart.ctx;

            /* find the point of maximum actual curtailment */
            var maxCurt = 0;
            var maxIdx  = -1;
            for (var i = 0; i < envData.length; i++) {
                var pVal   = potentialData[i];
                var eVal   = exportedData[i];
                var envVal = envData[i];
                if (pVal == null || eVal == null || envVal == null) continue;
                var curtVal = envVal - eVal;
                if (curtVal > maxCurt) {
                    maxCurt = curtVal;
                    maxIdx  = i;
                }
            }

            if (maxIdx < 0 || maxCurt < 1) return;

            var pY     = yScale.getPixelForValue(envData[maxIdx]);
            var eY     = yScale.getPixelForValue(exportedData[maxIdx]);
            var labelX = xScale.getPixelForValue(maxIdx);
            var labelY = (pY + eY) / 2;

            /* clamp within chart area */
            labelX = Math.max(area.left + 30, Math.min(area.right - 30, labelX));
            labelY = Math.max(area.top + 10, Math.min(area.bottom - 10, labelY));

            cCtx.save();
            var fontSize = Math.max(10, Math.min(16, baseFontSize * 0.55));
            cCtx.font          = '700 ' + fontSize + 'px Roboto, sans-serif';
            cCtx.fillStyle     = 'rgba(255, 255, 255, 0.85)';
            cCtx.textAlign     = 'center';
            cCtx.textBaseline  = 'middle';
            cCtx.shadowColor   = 'rgba(0, 0, 0, 0.6)';
            cCtx.shadowBlur    = 4;
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
                var x     = activePoint.element.x;
                var yAxis = chart.scales.y;
                var cCtx  = chart.ctx;
                cCtx.save();
                cCtx.beginPath();
                cCtx.moveTo(x, yAxis.top);
                cCtx.lineTo(x, yAxis.bottom);
                cCtx.lineWidth    = 1;
                cCtx.strokeStyle  = 'rgba(6, 245, 255, 0.25)';
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
                /* ── Dataset 0: Potential Power (white dashed) ── */
                {
                    label: s.potentialLineLabel || 'Potential Power',
                    data: [],
                    borderColor: 'rgba(255, 255, 255, 0.5)',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: 'rgba(255,255,255,0.7)',
                    tension: lineTension,
                    fill: false,
                    order: 4
                },
                /* ── Dataset 1: Exported Power (cyan solid, fill to origin) ── */
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
                    tension: lineTension,
                    fill: 'origin',
                    backgroundColor: 'rgba(6, 245, 255, 0.18)',
                    order: 2
                },
                /* ── Dataset 2: Curtailment Envelope (invisible, red fill to ds1) ── */
                {
                    label: '_curtailed_envelope',
                    data: [],
                    borderColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: lineTension,
                    fill: {
                        target: 1,
                        above: 'rgba(229, 57, 53, 0.4)',
                        below: 'rgba(229, 57, 53, 0.4)'
                    },
                    order: 1
                },
                /* ── Dataset 3: Setpoint Limit (amber dashed, stepped) ── */
                {
                    label: s.setpointLineLabel || 'Setpoint Limit',
                    data: [],
                    borderColor: '#FFA726',
                    borderWidth: 2,
                    borderDash: [5, 3],
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FFA726',
                    tension: 0,
                    stepped: 'before',
                    fill: false,
                    spanGaps: true,
                    order: 3
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
                        /* hide the invisible envelope dataset (index 2) */
                        return tooltipItem.datasetIndex !== 2;
                    },
                    callbacks: {
                        title: function (items) {
                            if (items.length > 0) return items[0].label;
                            return '';
                        },
                        label: function (context) {
                            var val = (context.parsed.y != null ? context.parsed.y : 0).toFixed(dec);
                            return context.dataset.label + ': ' + val + ' ' + unitLabel;
                        },
                        afterBody: function (items) {
                            if (items.length < 1) return '';
                            var chartData = items[0].chart.data;
                            var dataIdx   = items[0].dataIndex;
                            var eVal   = chartData.datasets[1].data[dataIdx] || 0;
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
    return str.split(',').map(function (k) { return k.trim(); }).filter(function (k) { return k.length > 0; });
}

/* ────────── RESOLVE ENTITY FROM DATASOURCES ────────── */
/* Works regardless of how many data keys are added to the widget */
function resolveEntity() {
    if (!self.ctx.datasources || self.ctx.datasources.length === 0) return null;

    for (var i = 0; i < self.ctx.datasources.length; i++) {
        var ds = self.ctx.datasources[i];
        if (!ds) continue;

        var eid  = ds.entityId;
        var etype = ds.entityType;

        if (eid && etype) {
            return {
                id:   (typeof eid === 'object') ? eid.id : eid,
                type: (typeof etype === 'string') ? etype : (eid.entityType || 'ASSET')
            };
        }
    }

    /* Fallback: try stateController for SelectedAsset */
    try {
        var sc = self.ctx.stateController;
        if (sc) {
            var params = sc.getStateParams() || {};
            var sel = params.SelectedAsset;
            if (sel) {
                if (sel.entityType && sel.id) return { id: sel.id, type: sel.entityType };
                if (sel.entityId)             return { id: sel.entityId.id, type: sel.entityId.entityType };
            }
        }
    } catch (e) {}

    return null;
}

/* ────────── LIVE DATA FETCH ────────── */
function fetchLiveData() {
    var entity = resolveEntity();
    if (!entity || !entity.id) {
        renderNoData();
        return;
    }

    /* Build key lists */
    var aKeysStr   = s.actualPowerKeys || s.actualPowerKey || 'active_power';
    var setKeysStr = s.setpointKeys    || s.setpointKey    || 'setpoint_active_power, curtailment_limit, power_limit';

    var actualKeys   = parseCommaList(aKeysStr);
    var setpointKeys = parseCommaList(setKeysStr);
    var capacityKey  = s.plantCapacityKey || 'Plant Total Capacity';

    /* URL-encode each key individually, then join with commas */
    var encodedKeys = actualKeys.concat(setpointKeys).map(function (k) {
        return encodeURIComponent(k);
    }).join(',');

    var selDate    = getSelectedDateObj();
    var startOfDay = selDate.getTime();
    var endTs;
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selDate.getTime() === today.getTime()) {
        /* Today: fetch up to now */
        endTs = new Date().getTime();
    } else {
        /* Historical: full 24h */
        endTs = startOfDay + 86400000;
    }

    var fetchTs = function () {
        var url = '/api/plugins/telemetry/' + entity.type + '/' + entity.id +
            '/values/timeseries?keys=' + encodedKeys +
            '&startTs=' + startOfDay + '&endTs=' + endTs +
            '&limit=50000&agg=NONE';

        try {
            self.ctx.http.get(url).subscribe(
                function (data) {
                    if (data && Object.keys(data).length > 0) {
                        processLiveTimeSeries(data, entity);
                    } else {
                        loadSimulation();
                    }
                },
                function () { loadSimulation(); }
            );
        } catch (e) { loadSimulation(); }
    };

    /* Fetch plant capacity attribute first */
    var attrService = self.ctx.attributeService;
    if (attrService && capacityKey) {
        var entityObj = { id: entity.id, entityType: entity.type };
        try {
            attrService.getEntityAttributes(entityObj, 'SERVER_SCOPE', [capacityKey])
                .subscribe(
                    function (data) {
                        try {
                            if (data && Array.isArray(data)) {
                                var found = data.find(function (a) { return a.key === capacityKey; });
                                if (found) self._capacityVal = found.value;
                            }
                        } catch (e) { console.warn('[CurtChart] capacity parse error', e); }
                        fetchTs();
                    },
                    function () { fetchTs(); }
                );
        } catch (e) { fetchTs(); }
    } else {
        fetchTs();
    }
}

/* ────────── PROCESS LIVE TIME SERIES ────────── */
function processLiveTimeSeries(rawData, entity) {
    isLiveData = true;
    updateStatusBadge('live');

    var aKeysStr   = s.actualPowerKeys || s.actualPowerKey || 'active_power';
    var setKeysStr = s.setpointKeys    || s.setpointKey    || 'setpoint_active_power, curtailment_limit, power_limit';

    var actualKeys   = parseCommaList(aKeysStr);
    var setpointKeys = parseCommaList(setKeysStr);

    /* Find first matching actual power key */
    var rawActual = null;
    for (var i = 0; i < actualKeys.length; i++) {
        if (rawData[actualKeys[i]] && rawData[actualKeys[i]].length > 0) {
            rawActual = rawData[actualKeys[i]];
            break;
        }
    }

    /* Find first matching setpoint key */
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

    /* Sort setpoint chronologically for step-function lookup */
    if (rawSetpoint) {
        rawSetpoint.sort(function (a, b) { return a.ts - b.ts; });
    }

    var getSetpointAtTime = function (ts) {
        if (!rawSetpoint || rawSetpoint.length === 0) return 100;
        var lastVal = 100;
        for (var k = 0; k < rawSetpoint.length; k++) {
            if (rawSetpoint[k].ts <= ts) {
                lastVal = parseFloat(rawSetpoint[k].value);
            } else { break; }
        }
        return isNaN(lastVal) ? 100 : lastVal;
    };

    /* Capacity configuration */
    var capacity = parseFloat(self._capacityVal);
    var usedAttr = (!isNaN(capacity) && capacity > 0);

    if (!usedAttr) {
        /* maxPower fallback is already in the display unit (kW/MW) */
        capacity = parseFloat(s.maxPower) || 1000;
    } else {
        /* Only convert units when using the attribute value */
        var capUnit = s.capacityUnit || 'MW';
        var powUnit = s.unitLabel    || 'kW';
        if (capUnit === 'MW' && powUnit === 'kW') capacity *= 1000;
        if (capUnit === 'kW' && powUnit === 'MW') capacity *= 0.001;
    }
    console.log('[CurtChart] capacity=' + capacity + (usedAttr ? ' (attribute)' : ' (maxPower fallback)'));

    var BUCKET_MIN = getInterval();
    var BUCKETS    = Math.floor(1440 / BUCKET_MIN);

    var labels           = [];
    var dataExported     = new Array(BUCKETS).fill(null);
    var dataPotential    = generatePotentialCurve(capacity);
    var dataCurtailedEnv = new Array(BUCKETS).fill(null);
    var dataSetpoint     = new Array(BUCKETS).fill(null);

    var selDate    = getSelectedDateObj();
    var startOfDay = selDate.getTime();

    for (var idx = 0; idx < BUCKETS; idx++) {
        var totalMin = idx * BUCKET_MIN;
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        labels.push((h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);
    }

    /* Map telemetry to buckets (use latest value per bucket) */
    var _mappedCount = 0;
    var _minVal = Infinity, _maxVal = -Infinity;
    for (var p = 0; p < rawActual.length; p++) {
        var ts  = parseInt(rawActual[p].ts);
        var val = parseFloat(rawActual[p].value);
        if (isNaN(val)) continue;

        var date = new Date(ts);
        var tIdx = Math.floor((date.getHours() * 60 + date.getMinutes()) / BUCKET_MIN);
        if (tIdx >= 0 && tIdx < BUCKETS) {
            dataExported[tIdx] = val;  /* last-write-wins, no averaging */
            _mappedCount++;
            if (val < _minVal) _minVal = val;
            if (val > _maxVal) _maxVal = val;
        }
    }
    console.log('[CurtChart] mapped ' + _mappedCount + ' points, range: ' + _minVal + ' – ' + _maxVal + ', interval=' + BUCKET_MIN + 'min');

    /* Auto-detect capacity from data if attribute/fallback is too small */
    if (_mappedCount > 0 && _maxVal > capacity) {
        capacity = Math.ceil(_maxVal * 1.1 / 100) * 100;  /* round up to nearest 100, +10% headroom */
        dataPotential = generatePotentialCurve(capacity);
        console.log('[CurtChart] auto-scaled capacity to ' + capacity + ' (data exceeded previous value)');
    }

    /* Calculate curtailment envelope AND setpoint line */
    var hasAnyCurtailment = false;
    for (var b = 0; b < BUCKETS; b++) {
        var bucketTs     = startOfDay + (b * BUCKET_MIN + BUCKET_MIN / 2) * 60 * 1000;
        var setpointPct  = getSetpointAtTime(bucketTs);
        var allowedPower = capacity * (setpointPct / 100);

        if (setpointPct < 99.5) {
            dataSetpoint[b] = allowedPower;
            hasAnyCurtailment = true;
        } else {
            dataSetpoint[b] = null;
        }

        if (dataExported[b] === null) {
            dataCurtailedEnv[b] = null;
            continue;
        }

        if (setpointPct < 99 && dataPotential[b] > allowedPower) {
            dataCurtailedEnv[b] = Math.max(dataPotential[b], dataExported[b]);
        } else {
            dataCurtailedEnv[b] = dataExported[b];
        }
    }

    /* Fill null setpoint gaps with capacity if curtailment exists */
    if (hasAnyCurtailment) {
        for (var c = 0; c < BUCKETS; c++) {
            if (dataSetpoint[c] === null && dataPotential[c] > 0) {
                dataSetpoint[c] = capacity;
            }
        }
    }

    /* Slice to daylight hours */
    var sl = getDaylightSlice(BUCKET_MIN);
    labels           = labels.slice(sl.start, sl.end);
    dataPotential    = dataPotential.slice(sl.start, sl.end);
    dataExported     = dataExported.slice(sl.start, sl.end);
    dataCurtailedEnv = dataCurtailedEnv.slice(sl.start, sl.end);
    dataSetpoint     = dataSetpoint.slice(sl.start, sl.end);

    /* Update chart tension based on setting */
    if (myChart && s.smoothLines === false) {
        myChart.data.datasets[0].tension = 0;
        myChart.data.datasets[1].tension = 0;
        myChart.data.datasets[2].tension = 0;
    }

    renderChartData(labels, dataPotential, dataExported, dataCurtailedEnv, dataSetpoint);
    updateTooltipSummary(dataPotential, dataExported, dataCurtailedEnv, dataSetpoint);
}

/* ────────── SIMULATION ────────── */
function loadSimulation() {
    isLiveData = false;
    updateStatusBadge('simulated');

    var capacity    = parseFloat(s.maxPower)      || 1000;
    var exportLimit = parseFloat(s.exportLimitKw)  || 800;

    var BUCKET_MIN = getInterval();
    var BUCKETS    = Math.floor(1440 / BUCKET_MIN);

    var labels          = [];
    var dataPotential   = generatePotentialCurve(capacity);
    var dataExported    = [];
    var dataCurtailedEnv = [];
    var dataSetpoint    = [];

    /* Seed for deterministic noise */
    var seed = 42;
    function seededRandom() {
        seed = (seed * 16807 + 0) % 2147483647;
        return (seed - 1) / 2147483646;
    }

    for (var i = 0; i < BUCKETS; i++) {
        var totalMin = i * BUCKET_MIN;
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        labels.push((h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);

        var hourFrac  = totalMin / 60;
        var potential  = dataPotential[i];

        /* simulate base clouds */
        var clouds = (1 + (seededRandom() - 0.5) * 0.06);
        potential *= clouds;
        dataPotential[i] = potential;

        var exported       = potential;
        var isCurtailedRule = false;

        /* ── Setpoint limit line (simulated) ── */
        var setpointVal = null;
        if (hourFrac > 6 && hourFrac < 18) {
            setpointVal = exportLimit;
        }

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
            setpointVal = exportLimit * 0.85;
        }

        if (hourFrac >= 13.0 && hourFrac <= 13.25) {
            var cloudFactor = 0.7 + seededRandom() * 0.15;
            exported = Math.min(exported, potential * cloudFactor);
        }

        exported = Math.max(0, exported);
        dataExported.push(exported);
        dataSetpoint.push(setpointVal);

        if (isCurtailedRule && potential > exported) {
            dataCurtailedEnv.push(Math.max(potential, exported));
        } else {
            dataCurtailedEnv.push(exported);
        }
    }

    /* Slice to daylight hours */
    var sl = getDaylightSlice(BUCKET_MIN);
    labels           = labels.slice(sl.start, sl.end);
    dataPotential    = dataPotential.slice(sl.start, sl.end);
    dataExported     = dataExported.slice(sl.start, sl.end);
    dataCurtailedEnv = dataCurtailedEnv.slice(sl.start, sl.end);
    dataSetpoint     = dataSetpoint.slice(sl.start, sl.end);

    renderChartData(labels, dataPotential, dataExported, dataCurtailedEnv, dataSetpoint);
    updateTooltipSummary(dataPotential, dataExported, dataCurtailedEnv, dataSetpoint);
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
    var BUCKET_MIN = getInterval();
    var BUCKETS    = Math.floor(1440 / BUCKET_MIN);
    var maxPower = capacityVal || parseFloat(s.maxPower) || 1000;
    var sunrise  = parseFloat(s.sunriseHour) || 6;
    var sunset   = parseFloat(s.sunsetHour)  || 18;
    var curve    = [];

    for (var i = 0; i < BUCKETS; i++) {
        var hourFrac = (i * BUCKET_MIN) / 60;
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
function renderChartData(labels, potential, exported, curtailedEnv, setpointPower) {
    if (!myChart) return;

    myChart.data.labels          = labels;
    myChart.data.datasets[0].data = potential;
    myChart.data.datasets[1].data = exported;
    myChart.data.datasets[2].data = curtailedEnv;
    myChart.data.datasets[3].data = setpointPower || [];
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
function updateTooltipSummary(potential, exported, curtailedEnv, setpointPower) {
    if (s.tooltipText) return;

    var dec        = (s.decimals !== undefined) ? parseInt(s.decimals) : 1;
    var unitLabel  = s.unitLabel || 'kW';
    var marginPct  = (s.theoreticalMargin !== undefined) ? parseFloat(s.theoreticalMargin) : 10;
    var intervalHours = 0.25; /* 15 minutes */

    var totalPotentialEnergy  = 0;
    var totalExportedEnergy   = 0;
    var totalCurtailedEnergy  = 0;
    var peakPotential = 0;
    var peakExported  = 0;
    var minSetpoint   = Infinity;

    for (var i = 0; i < potential.length; i++) {
        var pVal   = potential[i] || 0;
        var eVal   = (exported[i] !== null && exported[i] !== undefined) ? exported[i] : 0;
        var envVal = (curtailedEnv && curtailedEnv[i] !== null) ? curtailedEnv[i] : eVal;
        var spVal  = (setpointPower && setpointPower[i] !== null) ? setpointPower[i] : Infinity;

        var curtailed = Math.max(envVal - eVal, 0);

        totalPotentialEnergy += pVal * intervalHours;
        totalExportedEnergy  += eVal * intervalHours;
        totalCurtailedEnergy += curtailed * intervalHours;

        if (pVal > peakPotential) peakPotential = pVal;
        if (eVal > peakExported)  peakExported  = eVal;
        if (spVal < minSetpoint)  minSetpoint   = spVal;
    }

    var energyUnit    = 'kWh';
    var energyDivisor = 1;
    if (totalPotentialEnergy > 1000) {
        energyUnit    = 'MWh';
        energyDivisor = 1000;
    }

    var errorMargin = totalCurtailedEnergy * (marginPct / 100);

    var lines = [
        'Peak Potential: ' + peakPotential.toFixed(dec) + ' ' + unitLabel +
        ' | Peak Exported: ' + peakExported.toFixed(dec) + ' ' + unitLabel
    ];

    if (minSetpoint < Infinity) {
        lines.push('Lowest Setpoint: ' + minSetpoint.toFixed(dec) + ' ' + unitLabel);
    }

    lines.push(
        'Curtailed Energy: ' + (totalCurtailedEnergy / energyDivisor).toFixed(dec) +
        ' ' + energyUnit + ' (\u00B1 ' + (errorMargin / energyDivisor).toFixed(dec) + ')'
    );

    lines.push(isLiveData ? 'Live telemetry evaluated.' : 'Simulated data for demonstration.');

    $tooltip.html(lines.join('<br>'));
}

/* ────────── LIFECYCLE: DATA UPDATED ────────── */
self.onDataUpdated = function () {
    debouncedFetch();
};

/* ────────── LIFECYCLE: RESIZE ────────── */
self.onResize = function () {
    var w = $el.width();
    var h = $el.height();
    if (!w || !h) return;

    var fromH = (h - 8) / 7.5;
    var fromW = w / 14;

    baseFontSize = Math.min(fromH, fromW);
    if (baseFontSize < 8)  baseFontSize = 8;
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
    if (_fetchTimer) { clearTimeout(_fetchTimer); _fetchTimer = null; }
    if (myChart) { myChart.destroy(); myChart = null; }
    $datePrev.off('click');
    $dateNext.off('click');
    $dateLabel.off('click');
    $datePicker.off('change');
    $interval.off('change');
};
