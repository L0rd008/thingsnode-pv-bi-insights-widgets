// ════════════════════════════════════════════════════
// Risk Summary Panel Widget
// ThingsBoard v4.3.0 PE | Latest Values
// Production standard — matches Loss Attribution Card
// ════════════════════════════════════════════════════

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;

    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — title, unit, footer, tooltip
// ──────────────────────────────────────────────────
self.updateDom = function () {
    var s = self.ctx.settings;
    var $el = self.ctx.$widget;

    $el.find('.js-title').text(s.cardTitle || 'RISK SUMMARY PANEL');
    $el.find('.js-footer-text').text(s.footerLabel || 'Financial Risk · Revenue at Risk');
    $el.find('.js-time-horizon').text(s.timeHorizon || 'Annual Forecast');
    $el.find('.js-resolution').text((s.resolution || 'Portfolio').toUpperCase());

    if (s.tooltipText) {
        $el.find('.js-tooltip').text(s.tooltipText);
    }
};

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    var s = self.ctx.settings;
    var $el = self.ctx.$widget;
    var $root = $el.find('.js-panel-root');
    var $tooltip = $el.find('.js-tooltip');
    var $gaugeFill = $el.find('.js-gauge-fill');
    var $gaugeLabel = $el.find('.js-gauge-label');

    // Default / Placeholder Values
    var trackText = 'Between P75 & P90';
    var rarVal = 460000;
    var statusText = 'HIGH RISK - MONITORING';
    var detectedState = 'critical';
    var percentile = parseFloat(s.simPercentile || 83);

    // Auto-detect live data presence
    var hasLiveData = false;
    if (self.ctx.data) {
        for (var d = 0; d < self.ctx.data.length; d++) {
            if (self.ctx.data[d] && self.ctx.data[d].data && self.ctx.data[d].data.length > 0) {
                hasLiveData = true;
                break;
            }
        }
    }

    var useSimulation = s.enableManualSimulation && !hasLiveData;

    // --- MODE A: DUMMY / SIMULATION ---
    if (useSimulation) {
        trackText = s.simTracking || trackText;
        rarVal = parseFloat(s.simRar || rarVal);
        statusText = s.simStatus || statusText;
        detectedState = s.simLevel || 'critical';
        percentile = parseFloat(s.simPercentile || 83);
    }
    // --- MODE B: REAL WORLD (LIVE DATA) ---
    else if (hasLiveData) {
        // 1. Tracking Status (Source index 0) — monetary delta
        if (self.ctx.data[0] && self.ctx.data[0].data.length > 0) {
            var rawTrack = self.ctx.data[0].data[0][1];
            if (!isNaN(parseFloat(rawTrack))) {
                var trackVal = parseFloat(rawTrack);
                trackText = 'Tracking Delta: ' + autoScale(trackVal, 0);
            } else {
                trackText = String(rawTrack);
            }
        }

        // 2. RaR Value (Source index 1)
        if (self.ctx.data[1] && self.ctx.data[1].data.length > 0) {
            var rawRar = self.ctx.data[1].data[0][1];
            if (rawRar !== null && rawRar !== undefined && !isNaN(parseFloat(rawRar))) {
                rarVal = parseFloat(rawRar);
            }
        }

        // 3. Alert Level & Auto-State Detection (Source index 2)
        if (self.ctx.data[2] && self.ctx.data[2].data.length > 0) {
            statusText = String(self.ctx.data[2].data[0][1]);
            if (statusText) {
                var lowerStatus = statusText.toLowerCase();
                if (lowerStatus.indexOf('risk') >= 0 || lowerStatus.indexOf('critical') >= 0 || lowerStatus.indexOf('alarm') >= 0) {
                    detectedState = 'critical';
                } else if (lowerStatus.indexOf('warning') >= 0 || lowerStatus.indexOf('check') >= 0 || lowerStatus.indexOf('high') >= 0) {
                    detectedState = 'warning';
                } else if (lowerStatus.indexOf('normal') >= 0 || lowerStatus.indexOf('good') >= 0 || lowerStatus.indexOf('safe') >= 0 || lowerStatus.indexOf('compliant') >= 0) {
                    detectedState = 'good';
                }
            }
        }

        // 4. Percentile (Source index 3, or derive from tracking/total ratio)
        if (self.ctx.data[3] && self.ctx.data[3].data.length > 0) {
            var rawPct = parseFloat(self.ctx.data[3].data[0][1]);
            if (!isNaN(rawPct)) {
                percentile = rawPct;
            }
        } else if (self.ctx.data[0] && self.ctx.data[0].data.length > 0 &&
                   self.ctx.data[1] && self.ctx.data[1].data.length > 0) {
            var tVal = parseFloat(self.ctx.data[0].data[0][1]);
            var rVal = parseFloat(self.ctx.data[1].data[0][1]);
            if (!isNaN(tVal) && !isNaN(rVal) && rVal > 0) {
                percentile = Math.min(100, Math.max(0, (tVal / rVal) * 100));
            }
        } else {
            var fallbackMap = { critical: 90, warning: 55, good: 25 };
            percentile = fallbackMap[detectedState] || 50;
        }
    }

    // ============================================================
    // RENDERING
    // ============================================================

    // 1. Currency formatting
    var currencySymbol = s.currency || '$';
    var unit = s.unit || '';
    rarVal = isNaN(rarVal) ? 0 : rarVal;
    var decimals = (s.decimals !== undefined) ? parseInt(s.decimals) : 0;
    var scaledVal = autoScale(rarVal, decimals);
    var spacer = currencySymbol.length > 1 ? ' ' : '';
    var formattedRar = currencySymbol + spacer + scaledVal;

    // 2. Update Text & Remove Skeletons
    var $rar = $el.find('.js-value');
    var $status = $el.find('.js-status');

    $rar.text(formattedRar);
    $rar.removeClass('skeleton');

    var $unitEl = $el.find('.js-unit');
    if (unit && unit.trim().toLowerCase() !== currencySymbol.trim().toLowerCase()) {
        $unitEl.text(unit);
    } else {
        $unitEl.text('');
    }

    // Strip redundant prefixes from tracking text
    var prefixes = ['currently tracking:', 'tracking:', 'currently:'];
    var cleanTrack = trackText;
    for (var p = 0; p < prefixes.length; p++) {
        if (cleanTrack.toLowerCase().indexOf(prefixes[p]) === 0) {
            cleanTrack = cleanTrack.substring(prefixes[p].length).trim();
            break;
        }
    }
    $el.find('.js-tracking').text(cleanTrack);

    $status.text(statusText);
    $status.removeClass('skeleton');

    // 3. Update Visual State (Color & Glow)
    $root.removeClass('state-critical state-warning state-good');
    $root.addClass('state-' + detectedState);

    // 4. Risk Gauge — data-driven percentile
    percentile = Math.min(100, Math.max(0, percentile));
    $gaugeFill.css('width', percentile + '%');
    $gaugeLabel.text('P' + Math.round(percentile));

    // 5. Dynamic Tooltip
    if (!s.tooltipText) {
        var tip = 'Revenue at Risk: ' + formattedRar +
            (unit ? ' ' + unit.trim() : '') +
            '. Status: ' + statusText +
            '. Percentile: P' + Math.round(percentile) +
            '. ' + cleanTrack + '.';
        $tooltip.text(tip);
    }

    // 6. Angular change detection
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// ──────────────────────────────────────────────────
//  Auto-scale large numbers (K / M / B)
// ──────────────────────────────────────────────────
function autoScale(val, decimals) {
    var abs = Math.abs(val);
    var steps = [
        { threshold: 1e9, suffix: 'B', divisor: 1e9 },
        { threshold: 1e6, suffix: 'M', divisor: 1e6 },
        { threshold: 1e4, suffix: 'K', divisor: 1e3 },
        { threshold: 0, suffix: '', divisor: 1 }
    ];

    for (var i = 0; i < steps.length; i++) {
        if (abs >= steps[i].threshold) {
            var scaled = val / steps[i].divisor;
            return scaled.toLocaleString('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            }) + steps[i].suffix;
        }
    }
    return val.toFixed(decimals);
}

// ──────────────────────────────────────────────────
//  Responsive font scaling (em-budget algorithm)
// ──────────────────────────────────────────────────
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.risk-panel');

    var h = $el.height();
    var w = $el.width();
    var ratio = w / (h || 1);

    // Wide mode: aspect ratio > 3:1
    if (ratio > 3) {
        $card.addClass('wide');
        // Wide em-budget — 3 rows but with reduced element sizes:
        //   header(0.65) + value(1.4) + footer(0.45) + padding(0.6) + gaps(0.15)
        //   ≈ 3.25 → vertical divisor accounts for ALL rows sharing space
        var fromHeight = (h - 4) / 6.4;
        var fromWidth = w / 40;
    } else {
        $card.removeClass('wide');
        // Normal em-budget (7 rows):
        //   header(0.75) + gap(0.15) + value(1.8) + status(0.75) +
        //   gauge(0.6) + tracking(0.65) + footer(0.6) + padding(0.9)
        //   ≈ 6.2 → use 6.0
        var fromHeight = (h - 8) / 6.0;
        var fromWidth = w / 10;
    }

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 10) fontSize = 10;
    if (fontSize > 32) fontSize = 32;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
