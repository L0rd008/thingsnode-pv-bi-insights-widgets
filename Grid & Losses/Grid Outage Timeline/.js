// ════════════════════════════════════════════════════
// Grid Outage Timeline — v2.0
// ThingsBoard v4.3.0 PE | Latest Values
// Horizontal event timeline with severity coloring
// DOM caching | em-budget resize | no template literals
// ════════════════════════════════════════════════════

var $el, s;
var $card, $title, $windowSelect;
var $statusDot, $statusText;
var $statCount, $statEnergy, $statDuration;
var $track, $axis, $empty;
var $evtTooltip, $tooltip;
var currentDays = 7;

// ──────────────────────────────────────────────────
//  Lifecycle: Init
// ──────────────────────────────────────────────────
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;

    // ── Cache DOM ──
    $card = $el.find('.timeline-card');
    $title = $el.find('.js-title');
    $windowSelect = $el.find('.js-window-select');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $statCount = $el.find('.js-stat-count');
    $statEnergy = $el.find('.js-stat-energy');
    $statDuration = $el.find('.js-stat-duration');
    $track = $el.find('.js-track');
    $axis = $el.find('.js-axis');
    $empty = $el.find('.js-empty');
    $evtTooltip = $el.find('.js-evt-tooltip');
    $tooltip = $el.find('.js-tooltip');

    // ── Accent color override ──
    if (s.accentColor) {
        $card.css({
            '--c-accent': s.accentColor,
            '--c-accent-border': s.accentColor + '66',
            '--c-accent-hover': s.accentColor + 'CC',
            '--c-accent-glow': s.accentColor + '1F',
            '--c-accent-glow-hover': s.accentColor + '40'
        });
    }

    // ── Dropdown binding ──
    currentDays = parseInt(s.daysToShow) || 7;
    
    // Ensure the select dropdown value matches settings if custom options are used
    if ($windowSelect.find('option[value="' + currentDays + '"]').length === 0) {
        $windowSelect.append('<option value="' + currentDays + '">Last ' + currentDays + ' Days</option>');
    }
    $windowSelect.val(currentDays);

    $windowSelect.on('change', function () {
        currentDays = parseInt($(this).val()) || 7;
        self.onDataUpdated();
    });

    updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, labels
// ──────────────────────────────────────────────────
function updateDom() {
    $title.text(s.widgetTitle || 'GRID OUTAGE TIMELINE');

    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

// ──────────────────────────────────────────────────
//  Time parser — handles both Unix timestamps and ISO strings
// ──────────────────────────────────────────────────
function parseTime(input) {
    if (typeof input === 'string') {
        if (input.indexOf('-') !== -1 || input.indexOf(':') !== -1) {
            return new Date(input).getTime();
        }
    }
    return input;
}

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    $track.empty();
    $axis.empty();

    var unit = s.energyUnit || 'MWh';

    // ── 1. Data Extraction ──
    var events = [];
    var hasData = self.ctx.data && self.ctx.data.length > 0 &&
        self.ctx.data[0].data && self.ctx.data[0].data.length > 0;

    if (hasData) {
        try {
            var raw = self.ctx.data[0].data[0][1];
            events = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (e) {
            console.error('Grid Outage Timeline: Parse Error', e);
        }
    }

    // ── 2. Demo fallback (configurable) ──
    var enableDemo = (s.enableDemoData !== undefined) ? s.enableDemoData : true;
    if ((!events || events.length === 0) && enableDemo) {
        var now = Date.now();
        var day = 86400000;
        events = [
            { startTime: now - (day * 6), endTime: now - (day * 6) + (3600000 * 2.5), eventType: 'CEB Grid Fault', energyLost: 5.2, severity: 'high' },
            { startTime: now - (day * 4), endTime: now - (day * 4) + (3600000 * 0.8), eventType: 'Voltage Sag', energyLost: 1.1, severity: 'low' },
            { startTime: now - (day * 2), endTime: now - (day * 2) + (3600000 * 6), eventType: 'Scheduled Maint.', energyLost: 15.3, severity: 'maint' },
            { startTime: now - (day * 1), endTime: now - (day * 1) + (3600000 * 1.2), eventType: 'Frequency Trip', energyLost: 2.8, severity: 'med' }
        ];
    }

    // ── 3. Time window ──
    var daysToShow = currentDays;
    var windowEnd = Date.now();
    var windowDuration = daysToShow * 24 * 60 * 60 * 1000;
    var windowStart = windowEnd - windowDuration;

    // ── 4. Axis ticks ──
    for (var i = 0; i <= daysToShow; i++) {
        var tickTime = windowStart + (i * 24 * 60 * 60 * 1000);
        var dateObj = new Date(tickTime);
        var label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        $axis.append('<div class="axis-tick">' + label + '</div>');
    }

    // ── 5. Filter events to window ──
    var visibleEvents = [];
    if (events && events.length > 0) {
        for (var j = 0; j < events.length; j++) {
            var evt = events[j];
            var tStart = parseTime(evt.startTime);
            var tEnd = parseTime(evt.endTime);
            if (tEnd >= windowStart && tStart <= windowEnd) {
                visibleEvents.push({
                    evt: evt,
                    tStart: tStart,
                    tEnd: tEnd
                });
            }
        }
    }

    // ── 6. Empty state ──
    if (visibleEvents.length === 0) {
        $empty.show();
        $track.hide();
        updateStats(0, 0, 0, unit);
        updateStatus(0);

        if (!s.tooltipText) {
            $tooltip.text('No outage events detected in the last ' + daysToShow + ' days.');
        }

        if (self.ctx.detectChanges) self.ctx.detectChanges();
        return;
    }

    $empty.hide();
    $track.show();

    // ── 7. Sort by start time + render with alternating labels ──
    visibleEvents.sort(function (a, b) { return a.tStart - b.tStart; });

    var totalEnergy = 0;
    var totalDurationMs = 0;

    for (var k = 0; k < visibleEvents.length; k++) {
        var item = visibleEvents[k];
        renderEvent(item.evt, item.tStart, item.tEnd, windowStart, windowEnd, windowDuration, unit, k);
        totalEnergy += (item.evt.energyLost || 0);
        totalDurationMs += (item.tEnd - item.tStart);
    }

    // ── 8. Summary stats ──
    var totalDurationHrs = totalDurationMs / 3600000;
    updateStats(visibleEvents.length, totalEnergy, totalDurationHrs, unit);

    // ── 9. Status ──
    updateStatus(visibleEvents.length);

    // ── 10. Dynamic tooltip ──
    if (!s.tooltipText) {
        var tipParts = [];
        tipParts.push(visibleEvents.length + ' outage event' + (visibleEvents.length !== 1 ? 's' : '') + ' in the last ' + daysToShow + ' days');
        tipParts.push('Total energy lost: ' + totalEnergy.toFixed(1) + ' ' + unit);
        tipParts.push('Total downtime: ' + totalDurationHrs.toFixed(1) + ' hrs');
        $tooltip.text(tipParts.join(' · '));
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// ──────────────────────────────────────────────────
//  Render a single event block
// ──────────────────────────────────────────────────
function renderEvent(evt, tStart, tEnd, windowStart, windowEnd, windowDuration, unit, index) {
    var renderStart = Math.max(tStart, windowStart);
    var renderEnd = Math.min(tEnd, windowEnd);

    var leftPct = ((renderStart - windowStart) / windowDuration) * 100;
    var widthPct = ((renderEnd - renderStart) / windowDuration) * 100;
    if (widthPct < 0.4) widthPct = 0.4;

    var durationHrs = ((tEnd - tStart) / 3600000).toFixed(1);
    var sevClass = 'evt-' + (evt.severity || 'med');

    var el = $('<div class="timeline-event ' + sevClass + '"></div>');
    el.css({ 'left': leftPct + '%', 'width': widthPct + '%' });

    // Alternate labels: even=above, odd=below
    var belowClass = (index % 2 === 1) ? ' label-below' : '';
    var labelHtml = '<div class="event-label-group' + belowClass + '">' +
        '<span class="evt-title">' + escapeHtml(evt.eventType) + ' (' + durationHrs + 'h)</span>' +
        '<span class="evt-sub">Lost: ' + (evt.energyLost || 0) + ' ' + unit + '</span>' +
        '</div>';
    el.append(labelHtml);

    // Tooltip on hover (JS-driven)
    el.on('mouseenter', function () {
        var fullDate = new Date(tStart).toLocaleString();
        var ttHtml = '<div class="tt-type">' + escapeHtml(evt.eventType) + '</div>' +
            '<div class="tt-date">' + fullDate + '</div>' +
            '<div class="tt-dur">Duration: ' + durationHrs + ' hrs</div>' +
            '<div class="tt-energy">Energy Lost: ' + (evt.energyLost || 0) + ' ' + unit + '</div>';
        $evtTooltip.html(ttHtml).css('opacity', '1');
    });

    el.on('mouseleave', function () {
        $evtTooltip.css('opacity', '0');
    });

    $track.append(el);
}

// ──────────────────────────────────────────────────
//  Update summary stats
// ──────────────────────────────────────────────────
function updateStats(count, energy, durationHrs, unit) {
    $statCount.text(count);
    $statEnergy.text(energy.toFixed(1) + ' ' + unit);
    $statDuration.text(durationHrs.toFixed(1) + ' hrs');
}

// ──────────────────────────────────────────────────
//  Update status dot + text
// ──────────────────────────────────────────────────
function updateStatus(eventCount) {
    var dotClass, statusLabel;

    if (eventCount === 0) {
        dotClass = 'good';
        statusLabel = 'CLEAR';
    } else if (eventCount <= 2) {
        dotClass = 'warning';
        statusLabel = eventCount + ' OUTAGE' + (eventCount > 1 ? 'S' : '');
    } else {
        dotClass = 'critical';
        statusLabel = eventCount + ' OUTAGES';
    }

    $statusDot.removeClass('good warning critical').addClass(dotClass);
    $statusText.text(statusLabel).removeClass('good warning critical').addClass(dotClass);
}

// ──────────────────────────────────────────────────
//  HTML escape helper
// ──────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var h = $el.height();
    var w = $el.width();
    if (!w || !h) return;

    // Em-budget:
    //   header(0.8) + summary(0.6) + labels-above(1.2) + track(1.2)
    //   + labels-below(1.0) + axis-gap(1.4) + axis(0.5) + padding(0.9) ≈ 7.6 em
    var fromHeight = (h - 4) / 7.6;

    // Width: axis labels (~8 ticks × 2.5em each) + padding ≈ 22em
    var fromWidth = w / 22;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 32) fontSize = 32;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};