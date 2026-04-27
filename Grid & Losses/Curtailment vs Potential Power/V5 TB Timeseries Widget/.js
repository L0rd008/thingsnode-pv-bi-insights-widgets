/* ════════════════════════════════════════════════════
   Curtailment vs Potential Power — V5 TIMESERIES
   ThingsBoard v4.2.1.1 PE | Timeseries Widget
   ════════════════════════════════════════════════════

   V5 = V3 (Timeseries base) + targeted improvements:
   ─────────────────────────────────────────────────────
   [F1] Full-day 5AM–7PM for all day views (no "clamp to now" for today)
   [F2] Date navigation: ◀ Prev / date label (opens custom calendar) / Next ▶
   [F3] Custom calendar overlay with curtailed-day highlighting (amber dots)
   [F4] Separate stepped setpoint line (amber, V4-style) as a dedicated dataset
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
     Visible curtailment limit line.

   Dataset 3 — "Total Loss Fill"  (internal amber fill anchor)
     Internal dataset that fills total-loss regions without
     overlapping the curtailment-loss region.

   Dataset 4 — "Curtailment Loss Fill"  (internal red fill anchor)
     Internal dataset that fills the gap between potential power
     and the curtailment ceiling when potential > ceiling.

   Dataset 5 — "Curtailment Markers"  (orange dots)
     Marks the first and last bucket of each curtailment event.

   Dataset 6 — "Setpoint Line"  (amber dashed stepped line)
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
   This Week:   Full Monday 00:00 → Sunday 23:59 (future buckets remain null)
   Other multi-day: Full 00:00 → 23:59 (month still clamped to now)

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
var _savedOverflows = [];     /* ancestor overflow values saved while calendar is open */
var _intervalOverrideMs = null; /* null = auto (timeframe-based); number = manual override in ms */
var _tbPotentialAvailable = false; /* true when valid TB physics data found for the current period */

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
        potentialPowerKeys: 'potential_power',
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
    s.potentialPowerKeys = $('#set-potential-keys').val();
    s.plantCapacityKey  = $('#set-capacity-key').val();
    s.capacityUnit      = $('#set-cap-unit').val();
    s.displayUnit       = $('#set-display-unit').val() || 'kW';
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
    $('#set-potential-keys').val(s.potentialPowerKeys || '');
    $('#set-capacity-key').val(s.plantCapacityKey);
    $('#set-cap-unit').val(s.capacityUnit);
    $('#set-display-unit').val(s.displayUnit || 'kW');
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
    if ($yTitle.length) $yTitle.text('POWER (' + getDisplayUnit() + ')');

    /* Potential power legend visibility — only on day views when enabled */
    if ($legendPotentialWrap.length) {
        $legendPotentialWrap.css('display', shouldDisplayPotential() ? 'flex' : 'none');
    }

    /* Date nav bar — only visible on day views */
    if ($dateNavBar.length) {
        var isDayTf = isDayView(s.timeframe || 'today') || _selectedDate !== null;
        $dateNavBar.css('display', 'flex');  /* always keep visible for usability */
        updateDateLabel();
    }

    /* Sync customer dropdown labels */
    $el.find('.js-dd-tf-btn').text((TF_LABELS[s.timeframe] || 'Today') + ' ▾');

    /* Mark active items */
    $el.find('#dd-timeframe .cust-dropdown-item').removeClass('active')
       .filter('[data-value="' + s.timeframe + '"]').addClass('active');

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
            $dateLabelEl.text('Today \u2014 ' + formatDateISO(today)).addClass('is-today');
        } else {
            $dateLabelEl.text(TF_LABELS[tf] || 'Today').removeClass('is-today');
        }
        $dateNextBtn.prop('disabled', true);
    } else if (_selectedDate) {
        var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        $dateLabelEl.text(dayNames[sel.getDay()] + ' \u2014 ' + formatDateISO(sel)).removeClass('is-today');
        $dateNextBtn.prop('disabled', false);
    } else {
        /* Non-day timeframe, no selected date */
        $dateLabelEl.text(TF_LABELS[s.timeframe] || 'Today').removeClass('is-today');
        $dateNextBtn.prop('disabled', true);
    }
}

/* ────────────────────────────────────────────────────
   CALENDAR OVERLAY  [F3] — overflow-escape approach
   ────────────────────────────────────────────────────
   The calendar sits inside .date-nav (position:relative)
   as position:absolute. To prevent clipping by .curt-card
   or any ThingsBoard parent container, we temporarily set
   overflow:visible on all ancestors while the calendar is
   open, then restore on close.
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
    restoreAncestorOverflows();
}

/* Walk up from calendar to the document root, save & override
   any ancestor that clips overflow so the calendar can extend
   beyond the widget card boundaries. */
function clearAncestorOverflows() {
    _savedOverflows = [];
    var el = $calendarOverlay[0];
    if (!el) return;
    var parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
        var cs = window.getComputedStyle(parent);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            _savedOverflows.push({
                el: parent,
                overflow:  parent.style.overflow,
                overflowX: parent.style.overflowX,
                overflowY: parent.style.overflowY
            });
            parent.style.overflow  = 'visible';
            parent.style.overflowX = 'visible';
            parent.style.overflowY = 'visible';
        }
        parent = parent.parentElement;
    }
}

function restoreAncestorOverflows() {
    for (var i = 0; i < _savedOverflows.length; i++) {
        var saved = _savedOverflows[i];
        saved.el.style.overflow  = saved.overflow;
        saved.el.style.overflowX = saved.overflowX;
        saved.el.style.overflowY = saved.overflowY;
    }
    _savedOverflows = [];
}

function openCalendar() {
    var sel = getSelectedDateObj();
    _calendarMonth = { y: sel.getFullYear(), m: sel.getMonth() };
    renderCalendar();
    clearAncestorOverflows();
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
    var unitLabel = getDisplayUnit();
    var dec       = parseInt(s.decimals) || 1;
    var displayPotential = shouldDisplayPotential();

    /* ─── inline canvas label plugin ─── */
    var labelPlugin = {
        id: 'curtLossLabel',
        afterDraw: function (chart) {
            var ds = chart.data.datasets;
            if (ds.length < 5) return;
            var potD = ds[0].data, fillD = ds[4].data;
            if (!potD || !potD.length || !fillD || !fillD.length) return;
            var area = chart.chartArea; if (!area) return;
            var xs = chart.scales.x, ys = chart.scales.y, cc = chart.ctx;

            var maxLoss = 0, maxIdx = -1;
            var minLossForLabel = (getDisplayUnit() === 'MW') ? 0.01 : 1;
            for (var i = 0; i < fillD.length; i++) {
                if (potD[i] == null || fillD[i] == null) continue;
                var loss = potD[i] - fillD[i];
                if (loss > maxLoss) { maxLoss = loss; maxIdx = i; }
            }
            if (maxIdx < 0 || maxLoss < minLossForLabel) return;

            var topY = ys.getPixelForValue(potD[maxIdx]);
            var botY = ys.getPixelForValue(fillD[maxIdx]);
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
                    borderColor: displayPotential ? 'rgba(255,255,255,0.55)' : 'transparent',
                    borderWidth: 1.5,
                    segment: { borderDash: function () { return [6, 4]; } },
                    pointRadius: 0, pointHoverRadius: displayPotential ? 3 : 0,
                    pointHoverBackgroundColor: 'rgba(255,255,255,0.7)',
                    tension: 0.35,
                    fill: false,
                    spanGaps: false, order: 6
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
                /* 2 — Curtailment Ceiling (visible orange limit line) */
                {
                    label: 'Curtailment Limit',
                    data: [],
                    borderColor: '#FF9800',
                    borderWidth: 1.5,
                    borderDash: [5, 3],
                    pointRadius: 0, pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#FF9800',
                    tension: 0.35, spanGaps: false,
                    fill: false,
                    order: 5
                },
                /* 3 — Total Loss Fill (internal, invisible border) */
                {
                    label: '_total_fill',
                    data: [],
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.35,
                    spanGaps: false,
                    fill: { target: 1, above: 'rgba(255,193,7,0.35)', below: 'transparent' },
                    order: 3
                },
                /* 4 — Curtailment Loss Fill (internal, invisible border) */
                {
                    label: '_curtail_fill',
                    data: [],
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.35,
                    spanGaps: false,
                    fill: { target: 0, above: 'transparent', below: 'rgba(229,57,53,0.38)' },
                    order: 2
                },
                /* 5 — Curtailment Markers (start/end dots) */
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
                    order: 4
                },
                /* 6 — Setpoint Line (stepped amber, V4-style) */
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
                    order: 3
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
                    filter: function (item) {
                        if (item.datasetIndex === 3 || item.datasetIndex === 4 || item.datasetIndex === 5) return false;
                        if (item.datasetIndex === 0 && !shouldDisplayPotential()) return false;
                        return true;
                    },
                    callbacks: {
                        title: function (items) { return items.length ? items[0].label : ''; },
                        label: function (ctx2) {
                            if (ctx2.datasetIndex === 3 || ctx2.datasetIndex === 4 || ctx2.datasetIndex === 5) return null;
                            if (ctx2.datasetIndex === 0 && !shouldDisplayPotential()) return null;
                            if (ctx2.parsed.y == null) return null;
                            var dec2 = parseInt(s.decimals) || 1;
                            return ctx2.dataset.label + ': ' + ctx2.parsed.y.toFixed(dec2) + ' ' + getDisplayUnit();
                        },
                        afterBody: function (items) {
                            if (!items.length) return '';
                            var cd   = items[0].chart.data;
                            var idx  = items[0].dataIndex;
                            var potV = cd.datasets[0].data[idx];
                            var eVal = cd.datasets[1].data[idx];
                            var ceil = cd.datasets[2].data[idx];
                            var dec2 = parseInt(s.decimals) || 1;
                            var unit = getDisplayUnit();
                            var lines = [];
                            if (canModelPotential() && potV != null && eVal != null) {
                                var tl = Math.max(potV - eVal, 0);
                                if (tl >= 0.01) lines.push('⚡ Total Loss: ' + tl.toFixed(dec2) + ' ' + unit);
                            }
                            if (canModelPotential() && potV != null && ceil != null) {
                                var cl = Math.max(potV - ceil, 0);
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

function getDisplayUnit() {
    return s.displayUnit || 'kW';
}

function isDayView(tf) {
    return (tf === 'today' || tf === 'yesterday' || tf === 'day_before');
}

/* effectiveTimeframe: if a specific date is selected, treat it as a day view */
function effectiveTimeframe() {
    if (_selectedDate !== null) return 'today';
    return s.timeframe || 'today';
}

/* canModelPotential: true on day views — gates the half-sine curve only */
function canModelPotential() {
    return isDayView(effectiveTimeframe());
}

/* hasPotentialData: true when any potential source is available.
   TB physics works on ALL views; half-sine is day views only. */
function hasPotentialData() {
    return _tbPotentialAvailable || canModelPotential();
}

function shouldDisplayPotential() {
    return s.showPotentialCurve && hasPotentialData();
}

function isLiveTodayView() {
    return (_selectedDate === null && (s.timeframe || 'today') === 'today');
}

function toDisplayPower(valueKw) {
    if (valueKw == null || !isFinite(valueKw)) return valueKw;
    return (getDisplayUnit() === 'MW') ? (valueKw / 1000) : valueKw;
}

function toDisplaySeries(valuesKw) {
    return (valuesKw || []).map(function (valueKw) {
        return toDisplayPower(valueKw);
    });
}

function getEnergyDisplay(kwh) {
    if (getDisplayUnit() === 'MW') {
        return { value: kwh / 1000, unit: 'MWh' };
    }
    if (kwh > 9999) {
        return { value: kwh / 1000, unit: 'MWh' };
    }
    return { value: kwh, unit: 'kWh' };
}

function capacityToKw(capacityValue, capacityUnit) {
    var cap = parseFloat(capacityValue);
    if (isNaN(cap) || cap <= 0) return NaN;
    return (capacityUnit === 'MW') ? (cap * 1000) : cap;
}

function getRoundedCapacityKw(valueKw) {
    return Math.ceil(valueKw / 100) * 100;
}

var TB_MAX_AVG_INTERVALS = 720;

function getAggIntervalCount(startTs, endTs, intervalMs) {
    if (!intervalMs || intervalMs <= 0) return Infinity;
    return Math.ceil(Math.max((endTs - startTs), 1) / intervalMs);
}

function getPowerQueryMode(startTs, endTs, intervalMs) {
    var intervalCount = getAggIntervalCount(startTs, endTs, intervalMs);
    return {
        agg: (intervalCount <= TB_MAX_AVG_INTERVALS) ? 'AVG' : 'NONE',
        intervalCount: intervalCount
    };
}

function buildPowerTimeseriesUrl(baseUrl, encodedKeys, startTs, endTs, intervalMs, limit) {
    var mode = getPowerQueryMode(startTs, endTs, intervalMs);
    var url = baseUrl + '/values/timeseries?keys=' + encodedKeys +
        '&startTs=' + startTs + '&endTs=' + endTs;

    if (mode.agg === 'AVG') {
        url += '&interval=' + intervalMs + '&agg=AVG';
    } else {
        url += '&agg=NONE';
    }

    url += '&limit=' + (limit || 50000);
    return url;
}

function getFirstMatchingSeries(rawData, keys) {
    for (var i = 0; i < keys.length; i++) {
        if (rawData[keys[i]] && rawData[keys[i]].length) {
            return rawData[keys[i]];
        }
    }
    return null;
}

function getProductionWindow(series, thresholdKw) {
    var firstOn = -1, lastOn = -1;
    for (var i = 0; i < series.length; i++) {
        if (series[i] != null && series[i] > thresholdKw) {
            if (firstOn === -1) firstOn = i;
            lastOn = i;
        }
    }
    return { firstOn: firstOn, lastOn: lastOn };
}

function getMedianValue(values) {
    if (!values || !values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildPotentialCurveFromWindow(pointCount, capacityKw, firstOn, lastOn) {
    var potential = new Array(pointCount).fill(null);
    if (firstOn < 0 || lastOn < firstOn || pointCount <= 0) return potential;

    if (lastOn === firstOn) {
        potential[firstOn] = Math.max(capacityKw * 0.01, 0);
        return potential;
    }

    var span = lastOn - firstOn;
    for (var i = firstOn; i <= lastOn; i++) {
        var frac = (i - firstOn) / span;
        potential[i] = capacityKw * Math.sin(frac * Math.PI);
    }
    return potential;
}

function buildTotalLossFillSeries(potentialKw, exportedKw, ceilingKw) {
    var len = Math.max(
        (potentialKw || []).length,
        (exportedKw || []).length,
        (ceilingKw || []).length
    );
    var fill = new Array(len).fill(null);

    for (var i = 0; i < fill.length; i++) {
        var potV = potentialKw[i];
        var expV = exportedKw[i];
        var ceilV = ceilingKw[i];

        if (potV == null || expV == null || potV <= expV) continue;

        if (ceilV != null && potV > ceilV) {
            if (ceilV > expV) fill[i] = ceilV;
        } else {
            fill[i] = potV;
        }
    }
    return fill;
}

function buildCurtailmentFillSeries(potentialKw, ceilingKw) {
    var fill = new Array(Math.max(potentialKw.length, ceilingKw.length)).fill(null);
    for (var i = 0; i < fill.length; i++) {
        var potV = potentialKw[i];
        var ceilV = ceilingKw[i];
        if (potV != null && ceilV != null && potV > ceilV) {
            fill[i] = ceilV;
        }
    }
    return fill;
}

function estimateLiveTodayLastPositiveBucket(historySeries, minTime, bucketMs, thresholdKw, pointCount) {
    if (!historySeries || !historySeries.length) return null;

    var perDay = {};
    historySeries.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (sample) {
        var ts = parseInt(sample.ts, 10);
        var value = parseFloat(sample.value);
        if (isNaN(ts) || isNaN(value) || value <= thresholdKw) return;

        var d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        var key = d.getTime();
        if (!perDay[key]) perDay[key] = { dayStartTs: key, firstTs: null, lastTs: null };
        if (perDay[key].firstTs === null) perDay[key].firstTs = ts;
        perDay[key].lastTs = ts;
    });

    var offsets = Object.keys(perDay).map(function (key) {
        return perDay[key];
    }).filter(function (day) {
        return day.firstTs != null && day.lastTs != null && day.lastTs > day.firstTs;
    }).sort(function (a, b) {
        return b.dayStartTs - a.dayStartTs;
    }).slice(0, 3).map(function (day) {
        return day.lastTs - day.dayStartTs;
    });

    var medianOffset = getMedianValue(offsets);
    if (medianOffset == null) return null;

    var startDay = new Date(minTime);
    startDay.setHours(0, 0, 0, 0);
    var proxyTs = startDay.getTime() + medianOffset;
    var proxyBucket = Math.floor((proxyTs - minTime) / bucketMs);
    if (!isFinite(proxyBucket)) return null;
    return Math.max(0, Math.min(pointCount - 1, proxyBucket));
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
        et = new Date(y, mo, d-dow+7, 23, 59, 59, 999).getTime();
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

    var actualKeys    = parseCommaList(s.actualPowerKeys);
    var spKeys        = parseCommaList(s.setpointKeys);
    var potentialKeys = parseCommaList(s.potentialPowerKeys || '');
    var capKey        = s.plantCapacityKey;
    var tf            = effectiveTimeframe();
    var bounds        = getTimeBounds(tf);
    var startTs       = bounds.minTime;
    var endTs         = bounds.maxTime;
    var bucketMs      = getBucketMs(tf);

    var baseUrl = '/api/plugins/telemetry/' + entity.type + '/' + entity.id;

    var needsSunsetProxy = (isLiveTodayView() && canModelPotential() && actualKeys.length > 0);

    /* ── 5 parallel requests: capacity + power + setpoint + sunset proxy + potential ── */
    var capacityDone  = false, powerDone = false, setpointDone = false;
    var historyPowerDone = !needsSunsetProxy;
    var potentialDone = !potentialKeys.length;
    var powerData = null, setpointData = null, historyPowerData = null, potentialPowerData = null;

    var tryProcess = function () {
        if (!capacityDone || !powerDone || !setpointDone || !historyPowerDone || !potentialDone) return;
        var merged = {};
        if (powerData)    Object.assign(merged, powerData);
        if (setpointData) Object.assign(merged, setpointData);
        if (merged && Object.keys(merged).length > 0) {
            processLiveTimeSeries(merged, startTs, endTs, bucketMs, historyPowerData, potentialPowerData);
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

    var powerKeysEnc = actualKeys.map(function(k) { return encodeURIComponent(k); }).join(',');
    var powerUrl = buildPowerTimeseriesUrl(baseUrl, powerKeysEnc, startTs, endTs, bucketMs, 50000);
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

    /* 4) Recent completed-day power history for today's sunset proxy */
    if (needsSunsetProxy) {
        var historyStartTs = startTs - (3 * 86400000);
        var historyEndTs   = startTs - 1;
        var historyUrl = buildPowerTimeseriesUrl(baseUrl, powerKeysEnc, historyStartTs, historyEndTs, 300000, 50000);
        try {
            self.ctx.http.get(historyUrl).subscribe(
                function (data) { historyPowerData = data; historyPowerDone = true; tryProcess(); },
                function ()     { historyPowerDone = true; tryProcess(); }
            );
        } catch (e) { historyPowerDone = true; tryProcess(); }
    }

    /* 5) Physics potential_power from pvlib-service (Gap 8 — TB-first, falls back to half-sine) */
    if (potentialKeys.length) {
        var potKeysEnc = potentialKeys.map(function(k) { return encodeURIComponent(k); }).join(',');
        var potUrl = buildPowerTimeseriesUrl(baseUrl, potKeysEnc, startTs, endTs, bucketMs, 50000);
        try {
            self.ctx.http.get(potUrl).subscribe(
                function (data) { potentialPowerData = data; potentialDone = true; tryProcess(); },
                function ()     { potentialDone = true; tryProcess(); }
            );
        } catch (e) { potentialDone = true; tryProcess(); }
    }

    tryProcess();
}

/* ────────────────────────────────────────────────────
   DATA PROCESSING — LIVE
   ──────────────────────────────────────────────────── */
function processLiveTimeSeries(rawData, minTime, maxTime, bucketMs, historyPowerData, tbPotentialData) {
    isLiveData = true;
    updateStatusBadge('live');

    var actualKeys = parseCommaList(s.actualPowerKeys);
    var spKeys     = parseCommaList(s.setpointKeys);

    var rawActual = getFirstMatchingSeries(rawData, actualKeys);
    if (!rawActual) { loadSimulation(minTime, maxTime, bucketMs); return; }

    var rawSP = getFirstMatchingSeries(rawData, spKeys);
    if (rawSP) rawSP.sort(function (a, b) { return a.ts - b.ts; });

    var getSetpointPct = function (ts) {
        if (!rawSP || !rawSP.length) return 100;
        var last = 100;
        for (var k = 0; k < rawSP.length; k++) {
            if (rawSP[k].ts <= ts) last = parseFloat(rawSP[k].value);
            else break;
        }
        return isNaN(last) ? 100 : last;
    };

    var capacityKw = capacityToKw(self._capacityVal, s.capacityUnit || 'kW');
    if (isNaN(capacityKw) || capacityKw <= 0) capacityKw = parseFloat(s.fallbackPower) || 1000;

    var N = Math.max(1, Math.floor((maxTime - minTime) / bucketMs));
    var labels             = [];
    var bucketSum          = new Array(N).fill(0);
    var bucketHits         = new Array(N).fill(0);
    var dataExportedKw     = new Array(N).fill(null);
    var dataPotentialKw    = new Array(N).fill(null);
    var dataCurtailCeilKw  = new Array(N).fill(null);
    var dataMarkersKw      = new Array(N).fill(null);
    var dataSetpointKw     = new Array(N).fill(null);

    var timeDiffH = (maxTime - minTime) / 3600000;
    var fmtOpts   = (timeDiffH > 36)
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    var fmt = new Intl.DateTimeFormat('default', fmtOpts);
    for (var li = 0; li < N; li++) labels.push(fmt.format(new Date(minTime + li * bucketMs)));

    rawActual.sort(function (a, b) { return a.ts - b.ts; });
    for (var p = 0; p < rawActual.length; p++) {
        var ts  = parseInt(rawActual[p].ts, 10);
        var val = parseFloat(rawActual[p].value);
        if (isNaN(val) || isNaN(ts) || ts < minTime || ts > maxTime) continue;
        var bi = Math.min(Math.floor((ts - minTime) / bucketMs), N - 1);
        bucketSum[bi]  += val;
        bucketHits[bi] += 1;
    }
    for (var bm = 0; bm < N; bm++) {
        dataExportedKw[bm] = bucketHits[bm] > 0 ? (bucketSum[bm] / bucketHits[bm]) : null;
    }

    var maxDataKw = 0;
    for (var av = 0; av < N; av++) {
        if (dataExportedKw[av] !== null && dataExportedKw[av] > maxDataKw) maxDataKw = dataExportedKw[av];
    }
    if (maxDataKw > capacityKw) {
        capacityKw = getRoundedCapacityKw(maxDataKw * 1.1);
    }

    /* [V6-A] TB physics potential_power — works for any timeframe (day / week / month).
       Negative values (-1 sentinels written when pvlib has no valid computation) are
       silently dropped; only positive readings are bucketed and averaged. */
    var tbPotentialUsed = false;
    _tbPotentialAvailable = false;
    if (tbPotentialData) {
        var potKeysLocal = parseCommaList(s.potentialPowerKeys || '');
        var rawPot = getFirstMatchingSeries(tbPotentialData, potKeysLocal);
        if (rawPot && rawPot.length > 0) {
            var potBucketSum  = new Array(N).fill(0);
            var potBucketHits = new Array(N).fill(0);
            for (var tp = 0; tp < rawPot.length; tp++) {
                var tpTs  = parseInt(rawPot[tp].ts, 10);
                var tpVal = parseFloat(rawPot[tp].value);
                /* Skip -1 sentinels and any other negative/invalid values */
                if (isNaN(tpVal) || tpVal < 0 || isNaN(tpTs) || tpTs < minTime || tpTs > maxTime) continue;
                var tpBi = Math.min(Math.floor((tpTs - minTime) / bucketMs), N - 1);
                potBucketSum[tpBi]  += tpVal;
                potBucketHits[tpBi] += 1;
            }
            var anyPotValid = false;
            for (var tp2 = 0; tp2 < N; tp2++) {
                if (potBucketHits[tp2] > 0) {
                    dataPotentialKw[tp2] = potBucketSum[tp2] / potBucketHits[tp2];
                    anyPotValid = true;
                }
            }
            if (anyPotValid) {
                tbPotentialUsed = true;
                _tbPotentialAvailable = true;
            }
        }
    }

    /* [V6-B] Half-sine fallback — day views only, when no valid TB physics data found */
    if (!tbPotentialUsed && canModelPotential()) {
        var thresholdKw = capacityKw * 0.005;
        var liveWindow = getProductionWindow(dataExportedKw, thresholdKw);
        if (liveWindow.firstOn >= 0) {
            var lastFitBucket = liveWindow.lastOn;
            if (isLiveTodayView()) {
                var historySeries = historyPowerData ? getFirstMatchingSeries(historyPowerData, actualKeys) : null;
                var sunsetProxyBucket = estimateLiveTodayLastPositiveBucket(historySeries, minTime, bucketMs, thresholdKw, N);
                if (sunsetProxyBucket == null) sunsetProxyBucket = N - 1;
                lastFitBucket = Math.max(liveWindow.lastOn, sunsetProxyBucket);
            }
            dataPotentialKw = buildPotentialCurveFromWindow(N, capacityKw, liveWindow.firstOn, lastFitBucket);
        }
    }

    var curtailActive = false;
    for (var b = 0; b < N; b++) {
        if (dataExportedKw[b] === null) {
            dataCurtailCeilKw[b] = null;
            dataSetpointKw[b]    = null;
            continue;
        }
        var midTs = minTime + ((b + 0.5) * bucketMs);
        var spPct = getSetpointPct(midTs);

        if (spPct < 99.5) {
            var ceilingKw = capacityKw * (spPct / 100);
            dataCurtailCeilKw[b] = ceilingKw;
            dataSetpointKw[b]    = ceilingKw;

            if (!curtailActive) {
                dataMarkersKw[b] = ceilingKw;
                curtailActive = true;
            }
        } else {
            if (curtailActive && b > 0) {
                dataMarkersKw[b - 1] = dataCurtailCeilKw[b - 1];
            }
            dataCurtailCeilKw[b] = null;
            dataSetpointKw[b]    = null;
            curtailActive = false;
        }
    }
    if (curtailActive && N > 0 && dataCurtailCeilKw[N - 1] !== null) {
        dataMarkersKw[N - 1] = dataCurtailCeilKw[N - 1];
    }

    var hasAnyCurtailment = dataSetpointKw.some(function (v) { return v !== null; });
    if (hasAnyCurtailment) {
        for (var sg = 0; sg < N; sg++) {
            if (dataSetpointKw[sg] === null && dataExportedKw[sg] !== null) {
                if (dataPotentialKw[sg] !== null && dataPotentialKw[sg] > 0) {
                    dataSetpointKw[sg] = capacityKw;
                }
            }
        }
    }

    var dataTotalLossFillKw = buildTotalLossFillSeries(dataPotentialKw, dataExportedKw, dataCurtailCeilKw);
    var dataCurtailFillKw = buildCurtailmentFillSeries(dataPotentialKw, dataCurtailCeilKw);

    renderChartData(labels, dataPotentialKw, dataExportedKw, dataCurtailCeilKw, dataTotalLossFillKw, dataCurtailFillKw, dataMarkersKw, dataSetpointKw, capacityKw);
    updateSummary(dataPotentialKw, dataExportedKw, dataCurtailCeilKw, bucketMs, capacityKw);
}

/* ────────────────────────────────────────────────────
   FALLBACK SIMULATION
   ──────────────────────────────────────────────────── */
function loadSimulation(minTime, maxTime, bucketMs) {
    isLiveData = false;
    updateStatusBadge('simulated');

    var capacityKw = parseFloat(s.fallbackPower) || 1000;
    var N         = Math.max(1, Math.floor((maxTime - minTime) / bucketMs));
    var timeDiffH = (maxTime - minTime) / 3600000;
    var fmtOpts   = (timeDiffH > 36)
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit' };
    var fmt = new Intl.DateTimeFormat('default', fmtOpts);

    var labels = [], potential = [], exported = [], ceiling = [], markers = [], setpointLine = [];
    var SUN_RISE = 5.0, SUN_SET = 19.0;
    var exportLimit = capacityKw * 0.70;  /* Simulate a 70% curtailment scenario */

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
        var pot  = capacityKw * Math.sin(frac * Math.PI);
        potential.push(canModelPotential() ? pot : null);

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

    var totalLossFill = buildTotalLossFillSeries(potential, exported, ceiling);
    var curtailFill = buildCurtailmentFillSeries(potential, ceiling);

    renderChartData(labels, potential, exported, ceiling, totalLossFill, curtailFill, markers, setpointLine, capacityKw);
    updateSummary(potential, exported, ceiling, bucketMs, capacityKw);
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

function renderChartData(labels, potentialKw, exportedKw, ceilingKw, totalLossFillKw, curtailFillKw, markersKw, setpointDataKw, capacityKw) {
    if (!myChart) return;

    var displayPotential = shouldDisplayPotential();
    var potentialDisplay = toDisplaySeries(potentialKw);
    var exportedDisplay  = toDisplaySeries(exportedKw);
    var ceilingDisplay   = toDisplaySeries(ceilingKw);
    var totalFillDisplay = toDisplaySeries(totalLossFillKw);
    var curtailFillDisplay = toDisplaySeries(curtailFillKw);
    var markersDisplay   = toDisplaySeries(markersKw);
    var setpointDisplay  = toDisplaySeries(setpointDataKw || []);

    myChart.data.labels           = labels;
    myChart.data.datasets[0].data = potentialDisplay;
    myChart.data.datasets[1].data = exportedDisplay;
    myChart.data.datasets[2].data = ceilingDisplay;
    myChart.data.datasets[3].data = totalFillDisplay;
    myChart.data.datasets[4].data = curtailFillDisplay;
    myChart.data.datasets[5].data = markersDisplay;
    myChart.data.datasets[6].data = setpointDisplay;

    myChart.data.datasets[0].borderColor = displayPotential ? 'rgba(255,255,255,0.55)' : 'transparent';
    myChart.data.datasets[0].fill = false;
    myChart.data.datasets[0].pointHoverRadius = displayPotential ? 3 : 0;
    myChart.data.datasets[0].pointHoverBackgroundColor = displayPotential ? 'rgba(255,255,255,0.7)' : 'transparent';

    myChart.data.datasets[3].fill = hasPotentialData()
        ? { target: 1, above: 'rgba(255,193,7,0.35)', below: 'transparent' }
        : false;
    myChart.data.datasets[4].fill = hasPotentialData()
        ? { target: 0, above: 'transparent', below: 'rgba(229,57,53,0.38)' }
        : false;

    if ($legendPotentialWrap.length) {
        $legendPotentialWrap.css('display', displayPotential ? 'flex' : 'none');
    }

    /* Total-loss fill available whenever any potential source is present. */
    var $tlWrap = $el.find('.js-legend-total-loss-wrap');
    if ($tlWrap.length) $tlWrap.css('display', hasPotentialData() ? 'flex' : 'none');

    /* Setpoint legend visibility */
    if ($legendSetpoint && $legendSetpoint.length) {
        var hasSetpoint = setpointDisplay.some(function (v) { return v !== null; });
        $legendSetpoint.closest('.legend-item').css('display', hasSetpoint ? 'flex' : 'none');
    }

    myChart._curtCapacity = toDisplayPower(capacityKw || 0);
    myChart.update('none');
}

function updateSummary(potentialKw, exportedKw, ceilingKw, bucketMs, capacityKw) {
    if (!$summaryBar || !$summaryBar.length) return;

    var hPerBucket = bucketMs / 3600000;
    var dec        = parseInt(s.decimals) || 1;
    var canPotential = hasPotentialData();
    var hasModeledPotential = canPotential && !!(potentialKw && potentialKw.some(function (v) { return v !== null; }));

    var totalExportedKWh  = 0;
    var curtailedLossKWh  = 0;
    var totalLossKWh      = 0;
    var totalPotentialKWh = 0;
    var curtBuckets       = 0;
    var activeBuckets     = 0;

    var N = Math.max(
        exportedKw ? exportedKw.length : 0,
        ceilingKw ? ceilingKw.length : 0,
        potentialKw ? potentialKw.length : 0
    );

    for (var i = 0; i < N; i++) {
        var expV  = (exportedKw && i < exportedKw.length) ? exportedKw[i] : null;
        var ceilV = (ceilingKw && i < ceilingKw.length) ? ceilingKw[i] : null;
        var potV  = (potentialKw && i < potentialKw.length) ? potentialKw[i] : null;

        if (expV != null) {
            totalExportedKWh += expV * hPerBucket;
            activeBuckets++;
        }

        if (hasModeledPotential && potV != null) {
            totalPotentialKWh += potV * hPerBucket;
        }

        if (hasModeledPotential && potV != null && expV != null) {
            totalLossKWh += Math.max(potV - expV, 0) * hPerBucket;
        }

        if (hasModeledPotential && potV != null && ceilV != null) {
            var cLossKw = Math.max(potV - ceilV, 0);
            if (cLossKw > 0) {
                curtailedLossKWh += cLossKw * hPerBucket;
                curtBuckets++;
            }
        }
    }

    var totalCapacityKWh = capacityKw * activeBuckets * hPerBucket;
    var curtMarginKWh    = curtailedLossKWh * ((parseFloat(s.theoreticalMargin) || 10) / 100);
    var curtHours        = (curtBuckets * bucketMs / 3600000).toFixed(1);

    var totalLossDisp    = getEnergyDisplay(totalLossKWh);
    var curtLossDisp     = getEnergyDisplay(curtailedLossKWh);
    var curtMarginDisp   = getEnergyDisplay(curtMarginKWh);
    var exportedDisp     = getEnergyDisplay(totalExportedKWh);

    var curtPct = '0.0';
    var curtPctLabel = 'of capacity';
    if (hasModeledPotential && totalPotentialKWh > 0) {
        curtPct = ((curtailedLossKWh / totalPotentialKWh) * 100).toFixed(1);
        curtPctLabel = 'of potential';
    } else if (totalCapacityKWh > 0) {
        curtPct = ((curtailedLossKWh / totalCapacityKWh) * 100).toFixed(1);
    }

    var statusStr = isLiveData ? 'Live' : 'Simulated';
    var potSrcLabel = hasModeledPotential
        ? (' · ' + (_tbPotentialAvailable ? 'TB Physics' : 'Sine Model'))
        : '';
    var html = '<span class="sb-item sb-label">' + statusStr + potSrcLabel + '</span>';

    if (hasModeledPotential && totalLossKWh > 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item" style="color:#FFC107;">Total Loss: <b>' +
                totalLossDisp.value.toFixed(dec) + ' ' + totalLossDisp.unit + '</b></span>';
        if (totalPotentialKWh > 0) {
            var totalPct = ((totalLossKWh / totalPotentialKWh) * 100).toFixed(1);
            html += '<span class="sb-sep">|</span>';
            html += '<span class="sb-item sb-pct" style="color:#FFD54F;"><b>' + totalPct + '%</b> of potential</span>';
        }
    }

    if (hasModeledPotential && curtailedLossKWh > 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-loss">Curtailed Loss: <b>' +
                curtLossDisp.value.toFixed(dec) + ' ' + curtLossDisp.unit + '</b>' +
                ' <span class="sb-muted">(+/- ' + curtMarginDisp.value.toFixed(dec) + ' ' + curtMarginDisp.unit + ')</span></span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-pct"><b>' + curtPct + '%</b> ' + curtPctLabel + '</span>';
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-muted">' + curtHours + ' h curtailed</span>';
    }

    if (!canPotential) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-muted">No potential data — configure potential_power key or use day view for sine model</span>';
    } else if (!hasModeledPotential) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-muted">Waiting for potential data' + (!_tbPotentialAvailable && canModelPotential() ? ' (sine model needs production data)' : ' (no TB physics data in this window)') + '</span>';
    } else if (curtailedLossKWh <= 0.001 && totalLossKWh <= 0.001) {
        html += '<span class="sb-sep">|</span>';
        html += '<span class="sb-item sb-ok">No losses detected</span>';
    }

    html += '<span class="sb-sep">|</span>';
    html += '<span class="sb-item sb-muted">Exported: ' + exportedDisp.value.toFixed(dec) + ' ' + exportedDisp.unit + '</span>';

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
    restoreAncestorOverflows();
    $el.find('.js-dd-int-menu').off('click');
    $el.find('.js-dd-int-btn').off('click');
};
