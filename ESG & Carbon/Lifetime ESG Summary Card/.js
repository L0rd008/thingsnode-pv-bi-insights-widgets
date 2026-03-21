// ============================================
// Lifetime ESG Summary Card
// ThingsBoard v4.3.0 PE | Latest Values
// ============================================

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    self.updateDom();
    self.onResize();
    self.onDataUpdated();
};

// --------------------------------------------------
//  DOM setup — title, labels, tooltip
// --------------------------------------------------
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $card = $el.find('.esg-summary-card');

    // Accent color override
    if (s.accentColor) {
        $card.css('--c-accent', s.accentColor);
    }

    // Title
    $el.find('.js-title').text(s.widgetTitle || 'LIFETIME ESG IMPACT SUMMARY');

    // Configurable row labels
    $el.find('.js-lbl-co2').text(s.co2Label || 'LIFETIME CO₂ AVOIDED');
    $el.find('.js-lbl-homes').text(s.homesLabel || 'EQUIVALENT HOMES POWERED');
    $el.find('.js-lbl-time').text(s.timeLabel || 'YEARS SINCE COMMISSIONING');

    // Tooltip
    var ttText = s.tooltipText || '';
    if (ttText) {
        $el.find('.js-tooltip').text(ttText);
        $el.find('.tooltip-container').show();
    } else {
        $el.find('.tooltip-container').hide();
    }
};

// --------------------------------------------------
//  Data handler — CO2, homes, years calculations
// --------------------------------------------------
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $valCo2 = $el.find('.js-val-co2');
    var $valHomes = $el.find('.js-val-homes');
    var $valTime = $el.find('.js-val-time');

    // 1. Data safety check
    var energy = 0;
    if (self.ctx.data && self.ctx.data.length > 0 &&
        self.ctx.data[0].data && self.ctx.data[0].data.length > 0) {

        var rawVal = self.ctx.data[0].data[0][1];
        if (rawVal !== null && rawVal !== undefined && !isNaN(parseFloat(rawVal))) {
            energy = parseFloat(rawVal);
        }
    }

    // 2. Apply divider
    var divider = s.divider || 1;
    energy = energy / divider;

    // 3. Calculate CO2
    var co2Factor = parseFloat(s.co2Factor) || 0.0007;
    var co2Val = energy * co2Factor;

    // 4. Auto-scale CO2 (t → kt)
    var co2Display = co2Val;
    var co2Unit = 'tCO₂';
    if (Math.abs(co2Val) >= 1000) {
        co2Display = co2Val / 1000;
        co2Unit = 'ktCO₂';
    }

    var decimals = (s.decimals !== undefined) ? s.decimals : 0;
    var fmt = function (n, d) {
        var dec = (d !== undefined) ? d : decimals;
        return n.toLocaleString('en-US', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec
        });
    };

    $valCo2.html(fmt(co2Display) + ' <span class="unit-text">' + co2Unit + '</span>');
    $valCo2.removeClass('skeleton');

    // 5. Calculate Homes
    var homeFactor = parseFloat(s.homeFactor) || 1330;
    var homesVal = energy / homeFactor;

    $valHomes.html(fmt(homesVal) + ' <span class="unit-text">homes</span>');
    $valHomes.removeClass('skeleton');

    // 6. Calculate Years
    var yearsVal = parseFloat(s.staticYears);
    if (isNaN(yearsVal)) {
        var startStr = s.startDate || '2020-01-01';
        var start = new Date(startStr).getTime();
        var now = new Date().getTime();
        var diff = now - start;
        yearsVal = diff / (1000 * 60 * 60 * 24 * 365.25);
    }

    $valTime.html(fmt(yearsVal, 1) + ' <span class="unit-text">years</span>');
    $valTime.removeClass('skeleton');

    // 7. Angular change detection
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// --------------------------------------------------
//  Responsive font scaling
// --------------------------------------------------
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.esg-summary-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget for 3-row card:
    //   title(0.7) + 3 × row(icon 1.8 + padding 0.8 ≈ 2.6) + gaps(1.05) + padding(1.2) ≈ 11.0em
    var fromHeight = (h - 8) / 11.0;

    // Width: icon + label + value ≈ 12em minimum
    var fromWidth = w / 14;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 28) fontSize = 28;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};