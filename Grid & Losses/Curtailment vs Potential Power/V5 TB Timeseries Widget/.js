/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V5 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   ════════════════════════════════════════════════════

   V5 = V3 (Timeseries base) + targeted improvements:
   ─────────────────────────────────────────────────────
   [F1] Full-day 5AM–7PM for all day views (no "clamp to now" for today)
   [F2] Date navigation: ◀ Prev / date label (opens custom calendar) / Next ▶
   [F3] Custom calendar overlay with curtailed-day highlighting (amber dots)
   [F4] Separate stepped setpoint line (amber, V4-style) as dataset 4
   [F5] V3 timeframe dropdown preserved for week/month views
   [F6] Improved entity resolution, 250ms debounce, onDataUpdated hook,
        per-key URL encoding, auto-capacity scaling

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
     When setpoint >= 100%: ceiling = null (not drawn)
     Red fill between ceiling and exported shows curtailed energy.

   Dataset 3 — "Curtailment Markers"  (orange dots)
     Marks the first and last bucket of each curtailment event.

   Dataset 4 — "Setpoint Line"  (amber dashed stepped line)
     Shows the raw setpoint-derived allowed power level.
     Stepped (holds value until next change) for visual precision.

   Bucket strategy
   ───────────────
   Day views  (today/yesterday/day_before/selected_date): 5-minute intervals
   Week views (this_week/prev_week):       15-minute intervals
   Month view (this_month):                60-minute intervals

   Display window
   ──────────────
   Day views:   5:00 AM → 7:00 PM (fixed — no "clamp to now")
   Multi-day:   Full 00:00 → 23:59 (clamped to now for current week/month)

   ════════════════════════════════════════════════════ */

/* ── global state ── */
var $el, s, myChart, baseFontSize;
var $title, $statusDot, $statusText;
var $yTitle, $summaryBar, $modal;
var $legendPotentialWrap, $legendPotential, $legendExported, $legendCurtailed, $legendSetpoint;
var $settingsBtn;
var $dateNavBar, $datePrevBtn, $dateNextBtn, $dateLabelEl, $calendarOverlay;
var isLiveData = false;
var _fetchTimer = null;
var _selectedDate = null;     /* null = use timeframe dropdown; Date = override with that date */
var _curtailedDays = {};      /* { 'YYYY-MM-DD': true } for calendar highlighting */
var _calendarMonth = null;    /* { y, m } for calendar nav */
var _intervalOverrideMs = null; /* null = auto (timeframe-based); number = manual override in ms */

/* ── Timeframe display labels ── */
var TF_LABELS = {
    today: 'Today', yesterday: 'Yesterday', day_before: 'Day Before',
    this_week: 'This Week', prev_week: 'Prev Week', this_month: 'This Month'
};

/* ── Interval override options per timeframe category ──
   null ms = Auto (use timeframe default).
   Options are scoped so the max points (~2000) stay reasonable. */
var INTERVAL_OPTS_BY_CAT = {
    day: [
        { label: 'Auto · 5 min',  ms: null    },
        { label: '1 min',         ms: 60000   },
        { label: '5 min',         ms: 300000  },
        { label: '10 min',        ms: 600000  },
        { label: '15 min',        ms: 900000  },
        { label: '30 min',        ms: 1800000 }
    ],
    week: [
        { label: 'Auto · 15 min', ms: null     },
        { label: '5 min',         ms: 300000   },
        { label: '15 min',        ms: 900000   },
        { label: '30 min',        ms: 1800000  },
        { label: '1 hr',          ms: 3600000  },
        { label: '2 hr',          ms: 7200000  },
        { label: '4 hr',          ms: 14400000 }
    ],
    month: [
        { label: 'Auto · 1 hr',   ms: null     },
        { label: '15 min',        ms: 900000   },
        { label: '30 min',        ms: 1800000  },
        { label: '1 hr',          ms: 3600000  },
        { label: '2 hr',          ms: 7200000  },
        { label: '4 hr',          ms: 14400000 },
        { label: '6 hr',          ms: 21600000 },
        { label: '12 hr',         ms: 43200000 }
    ]
};

/* ────────────────────────────────────────────────────
   SETTINGS
   ──────────────────────────────────────────────────── */
function loadSettings() {
    var def = {
        timeframe:          'today',
        actualPowerKeys:    'active_power',
        setpointKeys:       'setpoint_active_power, curtailment_limit',
        plantCapacityKey:   'Capacity',
        capacityUnit:       'kW',
        displayUnit:        'kW',
        theoreticalMargin:  10,
        fallbackPower:      1000,
        decimals:           1,
        showPotentialCurve: true
    };
    try {
        var stored = localStorage.getItem('tb_curt_settings_' + self.ctx.widgetConfig.id);
        if (stored) Object.assign(def, JSON.parse(stored));
    } catch (e) {}
    s = def;
    /* Restore interval override from persisted settings */
    _intervalOverrideMs = (s.intervalOverrideMs != null) ? s.intervalOverrideMs : null;
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

    $title               = $el.find('.js-title');
    $statusDot           = $el.find('.js-status-dot');
    $statusText          = $el.find('.js-status-text');
    $yTitle              = $el.find('.js-y-title');
    $summaryBar          = $el.find('.js-summary-bar');
    $modal               = $el.find('#settings-modal');
    $legendPotentialWrap = $el.find('.js-legend-potential-wrap');
    $legendPotential     = $el.find('.js-legend-potential');
    $legendExported      = $el.find('.js-legend-exported');
    $legendCurtailed     = $el.find('.js-legend-curtailed');
    $legendSetpoint      = $el.find('.js-legend-setpoint');
    $settingsBtn         = $el.find('.js-settings-btn');
    $dateNavBar          = $el.find('.js-date-nav');
    $datePrevBtn         = $el.find('.js-date-prev');
    $dateNextBtn         = $el.find('.js-date-next');
    $dateLabelEl         = $el.find('.js-date-label');
    $calendarOverlay     = $el.find('.js-calendar-overlay');

    applyRoleVisibility();
    updateDom();
    bindSettingsUI();
    bindCustomerDropdowns();
    bindIntervalDropdown();
    bindDateNav();
    initChart();
    self.onResize();
    debouncedFetch();
};

self.onDataUpdated = function () {
    debouncedFetch();
};

/* ────────────────────────────────────────────────────
   DEBOUNCE
   ──────────────────────────────────────────────────── */
function debouncedFetch() {
    if (_fetchTimer) clearTimeout(_fetchTimer);
    _fetchTimer = setTimeout(function () {
        _fetchTimer = null;
        fetchLiveData();
    }, 250);
}

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
   DOM UPDATE
   ──────────────────────────────────────────────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'CURTAILMENT VS POTENTIAL POWER');
    if ($yTitle.length) $yTitle.text('POWER (' + (s.displayUnit || 'kW') + ')');

    /* Potential power legend visibility — only on day views when enabled */
    if ($legendPotentialWrap.length) {
        $legendPotentialWrap.css('display', shouldShowPotential() ? 'flex' : 'none');
    }

    /* Date nav bar — only visible on day views */
    if ($dateNavBar.length) {
        var isDayTf = isDayView(s.timeframe || 'today') || _selectedDate !== null;
        $dateNavBar.css('display', 'flex');  /* always keep visible for usability */
        updateDateLabel();
    }

    /* Sync customer dropdown labels */
    $el.find('.js-dd-tf-btn').text((TF_LABELS[s.timeframe] || 'Today') + ' ▾');
    $el.find('.js-dd-du-btn').text((s.displayUnit || 'kW') + ' ▾');

    /* Mark active items */
    $el.find('#dd-timeframe .cust-dropdown-item').removeClass('active')
       .filter('[data-value="' + s.timeframe + '"]').addClass('active');
    $el.find('#dd-dispunit .cust-dropdown-item').removeClass('active')
       .filter('[data-value="' + s.displayUnit + '"]').addClass('active');

    /* Sync interval override dropdown label */
    updateIntervalBtn();
}

/* ────────────────────────────────────────────────────
   DATE NAVIGATION  [F2]
   ──────────────────────────────────────────────────── */
function bindDateNav() {
    /* Previous day button */
    $datePrevBtn.on('click', function () {
        var d = getSelectedDateObj();
        d.setDate(d.getDate() - 1);
        _selectedDate = d;
        /* Switch timeframe to today-equivalent (5AM-7PM single day) */
        if (!isDayView(s.timeframe)) { s.timeframe = 'today'; }
        updateDateLabel();
        debouncedFetch();
    });

    /* Next day button */
    $dateNextBtn.on('click', function () {
        var d = getSelectedDateObj();
        var today = todayMidnight();
        d.setDate(d.getDate() + 1);
        if (d.getTime() >= today.getTime()) {
            _selectedDate = null;  /* back to today */
        } else {
            _selectedDate = d;
        }
        if (!isDayView(s.timeframe)) { s.timeframe = 'today'; }
        updateDateLabel();
        debouncedFetch();
    });

    /* Date label opens calendar overlay */
    $dateLabelEl.on('click', function (e) {
        e.stopPropagation();
        toggleCalendar();
    });

    /* Close calendar on outside click */
    $(document).on('click.v5cal', function () {
        closeCalendar();
    });

    $calendarOverlay.on('click', function (e) {
        e.stopPropagation();
    });
}

function getSelectedDateObj() {
    if (_selectedDate) return new Date(_selectedDate.getTime());
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function todayMidnight() {
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
    if (!$dateLabelEl.length) return;
    var today = todayMidnight();
    var sel   = getSelectedDateObj();
    var isToday = (sel.getTime() === today.getTime());

    if (isToday && !_selectedDate) {
        /* Show timeframe label when no specific date is selected */
        var tf = s.timeframe || 'today';
        if (isDayView(tf)) {
            $dateLabelEl.text('Today — ' + formatDateISO(today)).addClass('is-today');
        } else {
            $dateLabelEl.text(TF_LABELS[tf] || 'Today').removeClass('is-today');
        }
        $dateNextBtn.prop('disabled', true);
    } else if (_selectedDate) {
        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        $dateLabelEl.text(dayNames[sel.getDay()] + ' — ' + formatDateISO(sel)).removeClass('is-today');
        $dateNextBtn.prop('disabled', false);
    } else {
        /* Non-day timeframe, no selected date */
        $dateLabelEl.text(TF_LABELS[s.timeframe] || 'Today').removeClass('is-today');
        $dateNextBtn.prop('disabled', true);
    }
}

/* ────────────────────────────────────────────────────
   CALENDAR OVERLAY  [F3]
   ──────────────────────────────────────────────────── */
function toggleCalendar() {
    if ($calendarOverlay.is(':visible')) {
        closeCalendar();
    } else {
        openCalendar();
    }
}

function closeCalendar() {
    $calendarOverlay.hide();
}

function openCalendar() {
    var sel = getSelectedDateObj();
    _calendarMonth = { y: sel.getFullYear(), m: sel.getMonth() };
    renderCalendar();
    $calendarOverlay.show();
    /* Trigger curtailed-day fetch for the displayed month */
    fetchCurtailedDaysForMonth(_calendarMonth.y, _calendarMonth.m);
}

function renderCalendar() {
    var y = _calendarMonth.y, mo = _calendarMonth.m;
    var today   = todayMidnight();
    var sel     = getSelectedDateObj();
    var selKey  = _selectedDate ? formatDateISO(sel) : null;

    var firstDay  = new Date(y, mo, 1);
    var lastDay   = new Date(y, mo + 1, 0);
    var startDow  = firstDay.getDay(); /* 0=Sun */
    var daysInMo  = lastDay.getDate();

    var monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

    var html = '<div class="cal-header">' +
        '<button class="cal-nav-btn js-cal-prev-mo">&#9664;</button>' +
        '<span class="cal-month-label">' + monthNames[mo] + ' ' + y + '</span>' +
        '<button class="cal-nav-btn js-cal-next-mo">&#9654;</button>' +
        '</div>';

    html += '<div class="cal-grid">';
    /* Day-of-week headers */
    var dow = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    for (var dh = 0; dh < 7; dh++) {
        html += '<div class="cal-dow">' + dow[dh] + '</div>';
    }
    /* Empty cells before first day */
    for (var eb = 0; eb < startDow; eb++) {
        html += '<div class="cal-day cal-empty"></div>';
    }
    /* Day cells */
    for (var d = 1; d <= daysInMo; d++) {
        var cellDate = new Date(y, mo, d);
        var cellKey  = formatDateISO(cellDate);
        var isFuture = cellDate.getTime() > today.getTime();
        var isToday2 = cellDate.getTime() === today.getTime();
        var isSelected = (cellKey === selKey);
        var isCurtailed = (_curtailedDays[cellKey] === true);

        var cls = 'cal-day';
        if (isFuture)   cls += ' cal-future';
        if (isToday2)   cls += ' cal-today';
        if (isSelected) cls += ' cal-selected';
        if (isCurtailed && !isFuture) cls += ' cal-curtailed';

        var attrs = isFuture ? ' data-disabled="1"' : ' data-date="' + cellKey + '"';
        html += '<div class="' + cls + '"' + attrs + '>' + d;
        if (isCurtailed && !isFuture) html += '<span class="cal-curt-dot"></span>';
        html += '</div>';
    }
    html += '</div>';

    $calendarOverlay.html(html);

    /* Bind click events */
    $calendarOverlay.find('.cal-day[data-date]').on('click', function () {
        var dateStr = $(this).data('date');
        var parts   = dateStr.split('-');
        var picked  = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        var today2  = todayMidnight();
        if (picked.getTime() >= today2.getTime()) {
            _selectedDate = null;
        } else {
            _selectedDate = picked;
        }
        if (!isDayView(s.timeframe)) { s.timeframe = 'today'; }
        updateDateLabel();
        closeCalendar();
        debouncedFetch();
    });

    $calendarOverlay.find('.js-cal-prev-mo').on('click', function () {
        _calendarMonth.m--;
        if (_calendarMonth.m < 0) { _calendarMonth.m = 11; _calendarMonth.y--; }
        renderCalendar();
        fetchCurtailedDaysForMonth(_calendarMonth.y, _calendarMonth.m);
    });

    $calendarOverlay.find('.js-cal-next-mo').on('click', function () {
        var todayD = todayMidnight();
        if (_calendarMonth.y >= todayD.getFullYear() && _calendarMonth.m >= todayD.getMonth()) return;
        _calendarMonth.m++;
        if (_calendarMonth.m > 11) { _calendarMonth.m = 0; _calendarMonth.y++; }
        renderCalendar();
        fetchCurtailedDaysForMonth(_calendarMonth.y, _calendarMonth.m);
    });
}

/* Fetch setpoint data for a full month, mark days with any setpoint < 99.5% as curtailed */
function fetchCurtailedDaysForMonth(y, mo) {
    var entity = resolveEntity();
    if (!entity) return;

    var monthStart = new Date(y, mo, 1, 0, 0, 0).getTime();
    var monthEnd   = new Date(y, mo + 1, 0, 23, 59, 59).getTime();
    var today      = Date.now();
    if (monthEnd > today) monthEnd = today;
    if (monthStart > today) return;  /* future month, skip */

    var spKeys    = parseCommaList(s.setpointKeys);
    var baseUrl   = '/api/plugins/telemetry/' + entity.type + '/' + entity.id;
    var spKeysEnc = spKeys.map(function(k) { return encodeURIComponent(k); }).join(',');

    var url = baseUrl + '/values/timeseries?keys=' + spKeysEnc +
        '&startTs=' + monthStart + '&endTs=' + monthEnd +
        '&limit=50000&agg=NONE';

    try {
        self.ctx.http.get(url).subscribe(function(data) {
            if (!data) return;
            /* Merge all setpoint key arrays into one sorted list */
            var spKeys2 = parseCommaList(s.setpointKeys);
            var allSP = [];
            for (var si = 0; si < spKeys2.length; si++) {
                if (data[spKeys2[si]] && data[spKeys2[si]].length) {
                    allSP = allSP.concat(data[spKeys2[si]]);
                    break;  /* use first matching key */
                }
            }
            allSP.sort(function(a, b) { return a.ts - b.ts; });

            /* Mark days that have any reading < 99.5% during daylight */
            for (var i = 0; i < allSP.length; i++) {
                var ts  = parseInt(allSP[i].ts);
                var val = parseFloat(allSP[i].value);
                if (isNaN(val)) continue;
                var d   = new Date(ts);
                var hf  = d.getHours() + d.getMinutes() / 60;
                if (hf < 5 || hf > 19) continue;   /* outside daylight */
                if (val < 99.5) {
                    _curtailedDays[formatDateISO(d)] = true;
                }
            }
            /* Re-render calendar with highlights */
            if ($calendarOverlay.is(':visible')) renderCalendar();
        }, function() { /* ignore errors */ });
    } catch(e) {}
}

/* ────────────────────────────────────────────────────
   SETTINGS MODAL UI
   ──────────────────────────────────────────────────── */
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
        s.timeframe    = $(this).data('value');
        _selectedDate  = null;  /* clear date override when dropdown changes */
        validateIntervalOverride(); /* reset override if incompatible with new timeframe */
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

    /* Click outside closes dropdowns (but not calendar) */
    $(document).on('click.v5dd', function () {
        $el.find('.cust-dropdown-menu').hide();
    });
}

function persistSetting() {
    s.intervalOverrideMs = _intervalOverrideMs;  /* keep override in sync with persisted state */
    try {
        localStorage.setItem('tb_curt_settings_' + self.ctx.widgetConfig.id, JSON.stringify(s));
    } catch (e) {}
}

function rebuildAndFetch() {
    if (myChart) { myChart.destroy(); myChart = null; }
    initChart();
    debouncedFetch();
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
            var vals = [];
            for (var di = 0; di <= 2 && di < chart.data.datasets.length; di++) {
                var arr = chart.data.datasets[di].data;
                if (!arr) continue;
                for (var vi = 0; vi < arr.length; vi++) {
                    if (arr[vi] != null && isFinite(arr[vi]) && arr[vi] >= 0) vals.push(arr[vi]);
                }
            }
            if (vals.length < 3) return;

            vals.sort(function (a, b) { return a - b; });
            var p99Idx = Math.floor(vals.length * 0.99);
            var p99    = vals[Math.min(p99Idx, vals.length - 1)];
            var yCapP99 = p99 * 1.15;

            var yCap = yCapP99;
            if (chart._curtCapacity && chart._curtCapacity > 0) {
                var capCeil = chart._curtCapacity * 1.2;
                yCap = Math.min(yCapP99, capCeil);
            }
            if (chart.options.scales && chart.options.scales.y) {
                chart.options.scales.y.suggestedMax = Math.max(yCap, 1);
            }
        }
    };

    /* Dynamic tick limit based on timeframe */
    var tf = effectiveTimeframe();
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
                    spanGaps: false, order: 5,
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
                    spanGaps: true, order: 4
                },
                /* 2 — Curtailment Ceiling (orange dashed + red fill above ds1) */
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
                    order: 3
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
                    order: 2
                },
                /* 4 — Setpoint Line (stepped amber, V4-style) */
                {
                    label: 'Setpoint Limit',
                    data: [],
                    borderColor: '#FFA726',
                    borderWidth: 2,
                    borderDash: [5, 3],
                    pointRadius: 0, pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FFA726',
                    tension: 0,
                    stepped: 'before',
                    fill: false,
                    spanGaps: true,
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
                    filter: function (item) { return item.datasetIndex !== 3; },
                    callbacks: {
                        title: function (items) { return items.length ? items[0].label : ''; },
                        label: function (ctx2) {
                            if (ctx2.datasetIndex === 3) return null;
                            if (ctx2.parsed.y == null) return null;
                            var dec2 = parseInt(s.decimals) || 1;
                            return ctx2.dataset.label + ': ' + ctx2.parsed.y.toFixed(dec2) + ' ' + (s.displayUnit || 'kW');
                        },
                        afterBody: function (items) {
                            if (!items.length) return '';
                            var cd   = items[0].chart.data;
                            var idx  = items[0].dataIndex;
                            var potV = cd.datasets[0].data[idx];
                            var eVal = cd.datasets[1].data[idx];
                            var ceil = cd.datasets[2].data[idx];
                            var dec2 = parseInt(s.decimals) || 1;
                            var unit = s.displayUnit || 'kW';
                            var lines = [];
                            if (shouldShowPotential() && potV != null && eVal != null) {
                                var tl = Math.max(potV - eVal, 0);
                                if (tl >= 0.01) lines.push('⚡ Total Loss: ' + tl.toFixed(dec2) + ' ' + unit);
                            }
                            if (eVal != null && ceil != null) {
                                var cl = Math.max(ceil - eVal, 0);
                                if (cl >= 0.01) lines.push('⚠ Curtailed Loss: ' + cl.toFixed(dec2) + ' ' + unit);
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

/* effectiveTimeframe: if a specific date is selected, treat it as a day view */
function effectiveTimeframe() {
    if (_selectedDate !== null) return 'today';
    return s.timeframe || 'today';
}

function shouldShowPotential() {
    return s.showPotentialCurve && isDayView(effectiveTimeframe());
}

/* ────────────────────────────────────────────────────
   TIME BOUNDS  [F1 — full day, no "clamp to now" for day views]
   ──────────────────────────────────────────────────── */
function getTimeBounds(tf) {
    var now = new Date();
    var y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    var st, et;

    /* [F2] If a specific date is selected, use that date for 5AM-7PM window */
    if (_selectedDate !== null) {
        var sd = _selectedDate;
        st = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), 5, 0, 0).getTime();
        et = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), 19, 0, 0).getTime();
        /* For selected past dates, full window is valid — no clamping needed */
        return { minTime: st, maxTime: et };
    }

    if (tf === 'today') {
        st = new Date(y, mo, d, 5, 0, 0).getTime();
        et = new Date(y, mo, d, 19, 0, 0).getTime();
        /* [F1] Do NOT clamp today to now — show full 5AM-7PM frame.
           Buckets with no data yet will naturally be null. */
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
        et = now.getTime();   /* clamp to now for live week views */
    }
    else if (tf === 'prev_week') {
        var off = (now.getDay() || 7) - 1;
        var thisMon = new Date(y, mo, d-off, 0, 0, 0);
        st = thisMon.getTime() - 7*86400000;
        et = thisMon.getTime() - 1000;
    }
    else if (tf === 'this_month') {
        st = new Date(y, mo, 1, 0, 0, 0).getTime();
        et = now.getTime();   /* clamp to now for live month views */
    }
    else {
        st = new Date(y, mo, d, 5, 0, 0).getTime();
        et = new Date(y, mo, d, 19, 0, 0).getTime();
    }

    return { minTime: st, maxTime: Math.max(st + 1, et) };
}

/* Auto interval based purely on timeframe — V3's original defaults */
function getAutoIntervalMs(tf) {
    if (isDayView(tf) || _selectedDate !== null)    return 5  * 60 * 1000;  /* 5 min  */
    if (tf === 'this_week' || tf === 'prev_week')   return 15 * 60 * 1000;  /* 15 min */
    return 60 * 60 * 1000;                                                   /* 1 hr   */
}

/* Effective interval: user override (if valid) or auto default */
function getBucketMs(tf) {
    if (_intervalOverrideMs === null) return getAutoIntervalMs(tf);

    /* Safety: prevent overrides that would generate >5000 points for the timeframe.
       Use rough span estimates so we don't need to call getTimeBounds() here. */
    var ROUGH_SPAN_MS = {
        today:      14 * 3600000,          /* 5AM-7PM = 14h */
        yesterday:  14 * 3600000,
        day_before: 14 * 3600000,
        this_week:  7  * 24 * 3600000,
        prev_week:  7  * 24 * 3600000,
        this_month: 30 * 24 * 3600000
    };
    var span   = ROUGH_SPAN_MS[tf] || 14 * 3600000;
    var points = span / _intervalOverrideMs;
    if (points > 5000) return getAutoIntervalMs(tf);  /* too many points — fall back to auto */

    return _intervalOverrideMs;
}

/* Which category does a timeframe fall into (drives dropdown option set) */
function getTimeframeCategory(tf) {
    if (isDayView(tf) || _selectedDate !== null)   return 'day';
    if (tf === 'this_week' || tf === 'prev_week')  return 'week';
    return 'month';
}

/* When timeframe changes, validate that current override is still safe.
   If override would produce >5000 points for the new timeframe, reset to auto. */
function validateIntervalOverride() {
    if (_intervalOverrideMs === null) return;
    var tf = effectiveTimeframe();
    /* getBucketMs already has the safety logic — check if it would fall back */
    if (getBucketMs(tf) !== _intervalOverrideMs) {
        /* Override was rejected by safety logic — reset to auto */
        _intervalOverrideMs = null;
    }
}

/* ────────────────────────────────────────────────────
   INTERVAL OVERRIDE DROPDOWN  [New Feature]
   ──────────────────────────────────────────────────── */
function bindIntervalDropdown() {
    var $intBtn  = $el.find('.js-dd-int-btn');
    var $intMenu = $el.find('.js-dd-int-menu');

    $intBtn.on('click', function (e) {
        e.stopPropagation();
        $el.find('.cust-dropdown-menu').not($intMenu).hide();
        buildIntervalMenu();
        $intMenu.show();
    });

    /* Delegate item clicks — menu is rebuilt dynamically */
    $intMenu.on('click', '.cust-dropdown-item', function () {
        var raw = $(this).data('ms');
        _intervalOverrideMs = (raw === 'auto') ? null : parseInt(raw, 10);
        persistSetting();
        updateIntervalBtn();
        $intMenu.hide();
        rebuildAndFetch();
    });
}

/* Build the interval menu items for the current timeframe category */
function buildIntervalMenu() {
    var tf   = effectiveTimeframe();
    var cat  = getTimeframeCategory(tf);
    var opts = INTERVAL_OPTS_BY_CAT[cat];
    var $intMenu = $el.find('.js-dd-int-menu');
    var html = '';
    for (var i = 0; i < opts.length; i++) {
        var opt    = opts[i];
        var val    = (opt.ms === null) ? 'auto' : opt.ms;
        var active = (opt.ms === _intervalOverrideMs) ? ' active' : '';
        html += '<div class="cust-dropdown-item' + active + '" data-ms="' + val + '">' +
                opt.label + '</div>';
    }
    $intMenu.html(html);
}

/* Sync the interval button label to the current override state */
function updateIntervalBtn() {
    var $intBtn = $el.find('.js-dd-int-btn');
    if (!$intBtn.length) return;

    if (_intervalOverrideMs === null) {
        /* Show the Auto label for the current timeframe category */
        var cat      = getTimeframeCategory(effectiveTimeframe());
        var autoOpt  = INTERVAL_OPTS_BY_CAT[cat][0];  /* first item is always Auto */
        $intBtn.text(autoOpt.label + ' ▾').removeClass('override-active');
    } else {
        /* Find matching label across all option sets */
        var allCats  = ['day', 'week', 'month'];
        var foundLbl = null;
        for (var ci = 0; ci < allCats.length; ci++) {
            var opts = INTERVAL_OPTS_BY_CAT[allCats[ci]];
            for (var oi = 0; oi < opts.length; oi++) {
                if (opts[oi].ms === _intervalOverrideMs) { foundLbl = opts[oi].label; break; }
            }
            if (foundLbl) break;
        }
        $intBtn.text((foundLbl || 'Custom') + ' ▾').addClass('override-active');
    }
}

/* ────────────────────────────────────────────────────
   ENTITY RESOLUTION  [F6 — robust multi-datasource]
   ──────────────────────────────────────────────────── */
function resolveEntity() {
    if (!self.ctx.datasources || self.ctx.datasources.length === 0) return null;

    for (var i = 0; i < self.ctx.datasources.length; i++) {
        var ds  = self.ctx.datasources[i];
        if (!ds) continue;
        var eid   = ds.entityId;
        var etype = ds.entityType;
        if (eid && etype) {
            return {
                id:   (typeof eid === 'object') ? eid.id : eid,
                type: (typeof etype === 'string') ? etype : (eid.entityType || 'ASSET')
            };
        }
    }

    /* Fallback: stateController for SelectedAsset */
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

/* ────────────────────────────────────────────────────
   LIVE DATA FETCH  [F6 — per-key encoding, parallel]
   ──────────────────────────────────────────────────── */
function fetchLiveData() {
    var entity = resolveEntity();
    if (!entity || !entity.id) { renderNoData(); return; }

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var spKeys     = parseCommaList(s.setpointKeys);
    var capKey     = s.plantCapacityKey;
    var tf         = effectiveTimeframe();
    var bounds     = getTimeBounds(tf);
    var startTs    = bounds.minTime;
    var endTs      = bounds.maxTime;
    var bucketMs   = getBucketMs(tf);

    var baseUrl = '/api/plugins/telemetry/' + entity.type + '/' + entity.id;

    /* ── 3 parallel requests: capacity + power + setpoint ── */
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
        var entObj = { id: entity.id, entityType: entity.type };
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

    /* 2) Power telemetry
       ThingsBoard rejects agg=AVG when interval count > ~700.
       When the requested bucket count exceeds TB_MAX_AGG_INTERVALS we switch to
       agg=NONE (raw) and rely on the client-side bucket averaging that already
       exists in processLiveTimeSeries — both paths produce the same result. */
    var TB_MAX_AGG_INTERVALS = 700; /* conservative; TB hard-limit appears ~700-800 */
    var nIntervals   = Math.ceil((endTs - startTs) / bucketMs);
    var useServerAgg = (nIntervals <= TB_MAX_AGG_INTERVALS);
    var powerKeysEnc = actualKeys.map(function(k) { return encodeURIComponent(k); }).join(',');
    var powerUrl;
    if (useServerAgg) {
        /* Server does the averaging per bucket — 1 point per bucket returned */
        powerUrl = baseUrl + '/values/timeseries?keys=' + powerKeysEnc +
            '&startTs=' + startTs + '&endTs=' + endTs +
            '&interval=' + bucketMs + '&agg=AVG&limit=50000';
    } else {
        /* Too many intervals for server AVG — fetch raw data and bucket client-side */
        powerUrl = baseUrl + '/values/timeseries?keys=' + powerKeysEnc +
            '&startTs=' + startTs + '&endTs=' + endTs +
            '&agg=NONE&limit=50000';
    }
    try {
        self.ctx.http.get(powerUrl).subscribe(
            function (data) { powerData = data; powerDone = true; tryProcess(); },
            function ()     { powerDone = true; tryProcess(); }
        );
    } catch (e) { powerDone = true; tryProcess(); }

    /* 3) Setpoint telemetry — raw with 30-day lookback */
    if (spKeys.length) {
        var spKeysEnc = spKeys.map(function(k) { return encodeURIComponent(k); }).join(',');
        var spUrl = baseUrl + '/values/timeseries?keys=' + spKeysEnc +
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

    /* Scale factor for telemetry values */
    var dataScale = (powUnit === 'MW') ? 0.001 : 1;

    /* Bucket arrays */
    var N = Math.max(1, Math.floor((maxTime - minTime) / bucketMs));
    var labels            = [];
    var bucketSum         = new Array(N).fill(0);
    var bucketHits        = new Array(N).fill(0);
    var dataExported      = new Array(N).fill(null);
    var dataPotential     = new Array(N).fill(null);
    var dataCurtailCeil   = new Array(N).fill(null);
    var dataMarkers       = new Array(N).fill(null);
    var dataSetpointLine  = new Array(N).fill(null);

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

    /* [F6] Auto-scale capacity if data exceeds it */
    var maxDataVal = 0;
    for (var av = 0; av < N; av++) {
        if (dataExported[av] !== null && dataExported[av] > maxDataVal) maxDataVal = dataExported[av];
    }
    if (maxDataVal > capacity) {
        capacity = Math.ceil(maxDataVal * 1.1 / 100) * 100;
    }

    /* ── Potential power curve (only on day views when enabled) ── */
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

    /* ── Curtailment ceiling + stepped setpoint line ── */
    var curtailActive = false;
    for (var b = 0; b < N; b++) {
        if (dataExported[b] === null) {
            dataCurtailCeil[b]  = null;
            dataSetpointLine[b] = null;
            continue;
        }
        var midTs  = minTime + (b + 0.5) * bucketMs;
        var spPct  = getSetpointPct(midTs);

        if (spPct < 99.5) {
            var ceiling = capacity * (spPct / 100);
            dataCurtailCeil[b]  = ceiling;
            dataSetpointLine[b] = ceiling;   /* [F4] stepped setpoint line value */

            if (!curtailActive) {
                dataMarkers[b] = ceiling;   /* curtailment start */
                curtailActive = true;
            }
        } else {
            if (curtailActive && b > 0) {
                dataMarkers[b - 1] = dataCurtailCeil[b - 1];   /* curtailment end */
            }
            dataCurtailCeil[b]  = null;
            dataSetpointLine[b] = null;
            curtailActive = false;
        }
    }
    /* Mark end if curtailment active at last bucket */
    if (curtailActive && N > 0 && dataCurtailCeil[N - 1] !== null) {
        dataMarkers[N - 1] = dataCurtailCeil[N - 1];
    }

    /* [F4] Fill setpoint gaps with capacity where curtailment exists */
    var hasAnyCurtailment = dataSetpointLine.some(function(v) { return v !== null; });
    if (hasAnyCurtailment) {
        for (var sg = 0; sg < N; sg++) {
            if (dataSetpointLine[sg] === null && dataExported[sg] !== null) {
                if (dataPotential[sg] !== null && dataPotential[sg] > 0) {
                    dataSetpointLine[sg] = capacity;
                }
            }
        }
    }

    renderChartData(labels, dataPotential, dataExported, dataCurtailCeil, dataMarkers, dataSetpointLine, capacity);
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

    var labels = [], potential = [], exported = [], ceiling = [], markers = [], setpointLine = [];
    var SUN_RISE = 5.0, SUN_SET = 19.0;
    var exportLimit = capacity * 0.70;  /* Simulate a 70% curtailment scenario */

    var prevCurt = false;
    for (var i = 0; i < N; i++) {
        var bt   = minTime + i * bucketMs;
        var dObj = new Date(bt);
        var hf   = dObj.getHours() + dObj.getMinutes() / 60;
        labels.push(fmt.format(dObj));

        if (hf < SUN_RISE || hf > SUN_SET) {
            potential.push(null); exported.push(null); ceiling.push(null);
            markers.push(null);   setpointLine.push(null);
            prevCurt = false;
            continue;
        }
        var frac = (hf - SUN_RISE) / (SUN_SET - SUN_RISE);
        var pot  = capacity * Math.sin(frac * Math.PI);
        potential.push(shouldShowPotential() ? pot : null);

        /* curtailment between 10am–2pm */
        var curtailed = (hf >= 10.0 && hf <= 14.0);
        var cap40     = exportLimit;
        var exp       = curtailed
            ? Math.min(pot, cap40) * (0.97 + 0.03 * Math.random())
            : pot * (0.92 + 0.05 * Math.random());
        exported.push(exp);

        if (curtailed && pot > exportLimit) {
            ceiling.push(cap40);
            setpointLine.push(cap40);
            if (!prevCurt) { markers.push(cap40); } else { markers.push(null); }
            prevCurt = true;
        } else {
            if (prevCurt && i > 0) { markers[i - 1] = ceiling[i - 1]; }
            ceiling.push(null);
            setpointLine.push(null);
            markers.push(null);
            prevCurt = false;
        }
    }
    if (prevCurt && N > 0 && ceiling[N - 1] !== null) {
        markers[N - 1] = ceiling[N - 1];
    }

    renderChartData(labels, potential, exported, ceiling, markers, setpointLine, capacity);
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

function renderChartData(labels, p, e, c, m, setpointData, capacity) {
    if (!myChart) return;
    myChart.data.labels           = labels;
    myChart.data.datasets[0].data = p;
    myChart.data.datasets[1].data = e;
    myChart.data.datasets[2].data = c;
    myChart.data.datasets[3].data = m;
    myChart.data.datasets[4].data = setpointData || [];

    var showPot = shouldShowPotential();
    myChart.data.datasets[0].hidden = !showPot;

    /* Red fill: between ceiling and potential (day) or ceiling and exported (multi-day) */
    myChart.data.datasets[2].fill = {
        target: showPot ? 0 : 1,
        above: 'rgba(229,57,53,0.38)',
        below: 'transparent'
    };

    /* Total-loss legend visibility */
    var $tlWrap = $el.find('.js-legend-total-loss-wrap');
    if ($tlWrap.length) $tlWrap.css('display', showPot ? 'flex' : 'none');

    /* Setpoint legend visibility */
    if ($legendSetpoint && $legendSetpoint.length) {
        var hasSetpoint = (setpointData && setpointData.some(function(v) { return v !== null; }));
        $legendSetpoint.closest('.legend-item').css('display', hasSetpoint ? 'flex' : 'none');
    }

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

        if (expV != null) { totalExported += expV * hPerBucket; activeBuckets++; }

        if (ceilV != null && expV != null) {
            var cLoss = Math.max(capacity - ceilV, 0);
            if (cLoss > 0) { curtailedLoss += cLoss * hPerBucket; curtBuckets++; }
        }

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

    /* Curtailed Loss % */
    var curtPct, curtPctLabel;
    if (hasPot && totalPotentialEnergy > 0) {
        curtPct = ((curtailedLoss / totalPotentialEnergy) * 100).toFixed(1);
        curtPctLabel = 'of potential';
    } else if (totalCapacityEnergy > 0) {
        curtPct = ((curtailedLoss / totalCapacityEnergy) * 100).toFixed(1);
        curtPctLabel = 'of capacity';
    } else {
        curtPct = '0.0'; curtPctLabel = 'of capacity';
    }

    /* Display scaling */
    var cDispScale = 1, cDispUnit = eUnit;
    if (unit === 'kW' && curtailedLoss > 9999) { cDispScale = 1000; cDispUnit = 'MWh'; }
    var tDispScale = 1, tDispUnit = eUnit;
    if (unit === 'kW' && totalLoss > 9999) { tDispScale = 1000; tDispUnit = 'MWh'; }
    var expDispScale = 1, expDispUnit = eUnit;
    if (unit === 'kW' && totalExported > 9999) { expDispScale = 1000; expDispUnit = 'MWh'; }

    var statusStr = isLiveData ? 'Live' : 'Simulated';
    var html = '<span class="sb-item sb-label">' + statusStr + '</span>';

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

self.onDestroy = function () {
    if (_fetchTimer) { clearTimeout(_fetchTimer); _fetchTimer = null; }
    if (myChart) { myChart.destroy(); myChart = null; }
    $(document).off('click.v5cal').off('click.v5dd');
    $el.find('.js-dd-int-menu').off('click');
    $el.find('.js-dd-int-btn').off('click');
};
