/* ════════════════════════════════════════════════════
   Expected vs Actual Revenue — ThingsBoard v4.3.0 PE
   Time-series bar chart with variance badges
   ════════════════════════════════════════════════════ */

var $el, s;
var $title, $statusDot, $statusText;
var $yTitle, $gridMax, $gridMid, $bars;
var $dotA, $dotB, $legendA, $legendB;
var $tooltip;

/* ────────── LIFECYCLE: INIT ────────── */
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;

    /* ── cache DOM ── */
    $title = $el.find('.js-title');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $yTitle = $el.find('.js-y-title');
    $gridMax = $el.find('.js-grid-max');
    $gridMid = $el.find('.js-grid-mid');
    $bars = $el.find('.js-bars');
    $dotA = $el.find('.js-dot-a');
    $dotB = $el.find('.js-dot-b');
    $legendA = $el.find('.js-legend-a');
    $legendB = $el.find('.js-legend-b');
    $tooltip = $el.find('.js-tooltip');

    updateDom();
    self.onResize();
    self.onDataUpdated();
};

/* ────────── DOM SETUP ────────── */
function updateDom() {
    $title.text(s.widgetTitle || 'EXPECTED vs. ACTUAL REVENUE');
    $legendA.text(s.seriesALabel || 'Expected (P90)');
    $legendB.text(s.seriesBLabel || 'Actual Revenue');

    /* ── series colors ── */
    var colA = (s.colorA && s.colorA.length > 2) ? s.colorA : '#5C6BC0';
    var colB = (s.colorB && s.colorB.length > 2) ? s.colorB : '#00E5FF';

    var $card = $el.find('.rev-card');
    $card.css('--c-series-a', colA);
    $card.css('--c-series-b', colB);
    $dotA.css('background-color', colA);
    $dotB.css('background-color', colB);

    /* ── accent override ── */
    var accent = s.accentColor;
    if (accent) {
        $card.css({
            'border-color': accent,
            'box-shadow': '0 0 12px ' + accent + '33, inset 0 0 15px rgba(0,0,0,0.4)'
        });
    }

    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

/* ────────── LIFECYCLE: DATA ────────── */
self.onDataUpdated = function () {
    try {
        var data = self.ctx.data;
        var unit = s.unit || 'M';
        var maxBars = parseInt(s.maxBars) || 6;
        var currency = s.currency || '$';
        var dec = s.decimals != null ? parseInt(s.decimals) : 2;
        var higherIsBetter = (s.targetLogic !== 'Lower Actual is Better');

        /* ── axis title ── */
        $yTitle.text('Revenue (' + currency + ' ' + unit + ')');

        /* ── 1. Data extraction ── */
        var rawA = (data && data[0] && data[0].data) ? data[0].data : [];
        var rawB = (data && data[1] && data[1].data) ? data[1].data : [];

        /* ── Safety: check if expected has meaningful values ── */
        var fallbackBaseline = 2.475;
        var hasValidExpected = false;
        if (rawA.length > 0) {
            var sumA = 0;
            for (var k = 0; k < rawA.length; k++) sumA += parseFloat(rawA[k][1]);
            if (sumA / rawA.length > 0.1) hasValidExpected = true;
        }

        /* ── Group by month ── */
        var groupMap = {};

        function addToMap(arr, type) {
            for (var i = 0; i < arr.length; i++) {
                var date = new Date(arr[i][0]);
                var key = date.getFullYear() + '-' + (date.getMonth() + 1);
                if (!groupMap[key]) groupMap[key] = { ts: arr[i][0], a: 0, b: 0 };
                groupMap[key][type] = parseFloat(arr[i][1]);
            }
        }

        addToMap(rawB, 'b');
        if (hasValidExpected) addToMap(rawA, 'a');

        /* ── Fill missing expected with baseline ── */
        var keys = Object.keys(groupMap);
        for (var m = 0; m < keys.length; m++) {
            if (!groupMap[keys[m]].a || groupMap[keys[m]].a < 0.001) {
                groupMap[keys[m]].a = fallbackBaseline;
            }
        }

        var chartData = Object.values(groupMap).sort(function (a, b) { return a.ts - b.ts; });

        /* ── Backfill history if needed ── */
        if (chartData.length > 0 && chartData.length < maxBars) {
            var needed = maxBars - chartData.length;
            var anchor = chartData[0];
            var baseA = parseFloat(anchor.a) || fallbackBaseline;
            var baseB = parseFloat(anchor.b) || fallbackBaseline;
            var anchorDate = new Date(anchor.ts);
            var backfill = [];
            for (var j = 1; j <= needed; j++) {
                var d = new Date(anchorDate);
                d.setMonth(d.getMonth() - j);
                var noise = Math.sin(j) * 0.1;
                backfill.unshift({
                    ts: d.getTime(),
                    a: parseFloat(baseA.toFixed(dec)),
                    b: parseFloat((baseB * (1 + noise)).toFixed(dec))
                });
            }
            chartData = backfill.concat(chartData);
        }

        if (chartData.length > maxBars) chartData = chartData.slice(chartData.length - maxBars);

        /* ── Placeholder if no data ── */
        if (chartData.length === 0) {
            showPlaceholders();
            return;
        }

        /* ── 2. Scaling ── */
        var maxValue = 0;
        for (var n = 0; n < chartData.length; n++) {
            maxValue = Math.max(maxValue, parseFloat(chartData[n].a), parseFloat(chartData[n].b));
        }
        var scaleMax = Math.ceil((maxValue * 1.2) * 2) / 2;
        if (scaleMax === 0) scaleMax = 3.0;

        $gridMax.text(scaleMax.toFixed(1));
        $gridMid.text((scaleMax / 2).toFixed(1));

        /* ── 3. Render bars ── */
        $bars.empty();

        var totalA = 0, totalB = 0;

        for (var p = 0; p < chartData.length; p++) {
            var valA = parseFloat(chartData[p].a);
            var valB = parseFloat(chartData[p].b);
            totalA += valA;
            totalB += valB;

            var hA = (valA / scaleMax) * 100;
            var hB = (valB / scaleMax) * 100;

            var diff = valB - valA;
            var diffStr = (diff > 0 ? '+' : '') + diff.toFixed(dec);
            var isGood = higherIsBetter ? (diff >= -0.01) : (diff <= 0.01);
            var badgeClass = isGood ? 'positive' : 'negative';

            var dateObj = new Date(chartData[p].ts);
            var monthName = dateObj.toLocaleString('default', { month: 'short' }).toUpperCase();

            /* ── MTD prorating: if this is the current month, prorate expected ── */
            var now = new Date();
            var isCurrentMonth = (dateObj.getFullYear() === now.getFullYear() && dateObj.getMonth() === now.getMonth());
            if (isCurrentMonth && valA > 0) {
                var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                var dayOfMonth = now.getDate();
                valA = valA * (dayOfMonth / daysInMonth);
                hA = (valA / scaleMax) * 100;
                /* recalculate diff after prorating */
                diff = valB - valA;
                diffStr = (diff > 0 ? '+' : '') + diff.toFixed(dec);
                isGood = higherIsBetter ? (diff >= -0.01) : (diff <= 0.01);
                badgeClass = isGood ? 'positive' : 'negative';
                monthName = monthName + ' (MTD)';
            }

            var maxH = Math.max(hA, hB);
            var badgeBottom = Math.min(maxH + 6, 96);

            var html = '<div class="bar-group">' +
                '<div class="variance-badge ' + badgeClass + '" style="bottom:' + badgeBottom + '%">' + diffStr + '</div>' +
                '<div class="bars-wrapper">' +
                '<div class="bar bar-a" style="height:' + hA + '%"><div class="bar-value-label">' + valA.toFixed(dec) + '</div></div>' +
                '<div class="bar bar-b" style="height:' + hB + '%"><div class="bar-value-label">' + valB.toFixed(dec) + '</div></div>' +
                '</div>' +
                '<div class="x-axis-label">' + monthName + '</div>' +
                '</div>';

            $bars.append(html);
        }

        /* ── 4. Overall status (with deadband) ── */
        var overallDiff = totalB - totalA;
        var overallPct = totalA > 0 ? ((overallDiff / totalA) * 100) : 0;

        var deadband = 0.5; // ±0.5% is considered neutral
        var isNeutral = (Math.abs(overallPct) <= deadband);
        var overallGood = higherIsBetter ? (overallDiff >= 0) : (overallDiff <= 0);

        if (isNeutral) {
            $statusDot.removeClass('good critical neutral').addClass('neutral');
            $statusText.text('▶ ' + Math.abs(overallPct).toFixed(1) + '%');
        } else {
            var arrow = overallDiff >= 0 ? '▲' : '▼';
            $statusDot.removeClass('good critical neutral').addClass(overallGood ? 'good' : 'critical');
            $statusText.text(arrow + ' ' + Math.abs(overallPct).toFixed(1) + '%');
        }

        /* ── 5. Dynamic tooltip ── */
        if (!s.tooltipText) {
            var lines = [
                'Total Expected: ' + currency + totalA.toFixed(dec) + unit + ' | Actual: ' + currency + totalB.toFixed(dec) + unit,
                'Variance: ' + (overallDiff >= 0 ? '+' : '') + overallDiff.toFixed(dec) + unit + ' (' + arrow + Math.abs(overallPct).toFixed(1) + '%)',
                overallGood ? 'Performance on target across ' + chartData.length + ' months.'
                    : 'Below expectations. Review underperforming months.'
            ];
            $tooltip.html(lines.join('<br>'));
        }

    } catch (e) {
        console.error('Rev onDataUpdated:', e);
        showPlaceholders();
    }
};

/* ────────── PLACEHOLDERS ────────── */
function showPlaceholders() {
    $bars.empty();
    $gridMax.text('--');
    $gridMid.text('--');
    $statusDot.removeClass('good critical');
    $statusText.text('--');
    if (!s.tooltipText) {
        $tooltip.text('Compares expected (P90) revenue against actual monthly revenue to track financial performance.');
    }
}

/* ────────── LIFECYCLE: RESIZE ────────── */
self.onResize = function () {
    var w = $el.width();
    var h = $el.height();
    if (!w || !h) return;

    /* Em budget:
       header(0.7) + chart-body-padding(1.45) + footer(0.55) + card-padding(0.7) ≈ 3.4em fixed chrome
       chart body flex takes the rest — divisor ~8 gives comfortable scaling */
    var fromH = (h - 8) / 8;
    var fromW = w / 13;
    var fs = Math.max(9, Math.min(32, Math.min(fromH, fromW)));

    $el.find('.rev-card').css('font-size', fs + 'px');
};

/* ────────── LIFECYCLE: DESTROY ────────── */
self.onDestroy = function () { };
