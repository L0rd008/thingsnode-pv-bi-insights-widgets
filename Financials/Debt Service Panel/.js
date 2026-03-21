// ============================================
// Debt Service Panel
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

    // Title
    $el.find('.js-title').text(s.widgetTitle || 'DEBT SERVICE PANEL');

    // DSCR label
    $el.find('.js-dscr-label').text(s.dscrLabel || 'CURRENT DSCR:');

    // Tooltip
    var defaultTip = 'Debt Service Coverage Ratio (DSCR) measures cash flow available to pay debt. A ratio > 1.30 is usually required by lenders.';
    var ttText = s.tooltipText || defaultTip;
    if (ttText) {
        $el.find('.js-tooltip').text(ttText);
        $el.find('.tooltip-container').show();
    } else {
        $el.find('.tooltip-container').hide();
    }
};

// --------------------------------------------------
//  Data handler — DSCR, covenant, debt service
// --------------------------------------------------
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $valDscr = $el.find('.js-val-dscr');
    var $valCovenant = $el.find('.js-val-covenant');
    var $valService = $el.find('.js-val-service');
    var $valStatus = $el.find('.js-val-status');
    var $statusBox = $el.find('.js-status-box');

    // 1. Data safety check — need at least 2 series (DSCR + Covenant)
    if (!self.ctx.data || self.ctx.data.length < 2 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0 ||
        !self.ctx.data[1].data || self.ctx.data[1].data.length === 0) {
        $valDscr.text('--');
        $valCovenant.text('--');
        $valService.text('--');
        $valStatus.text('--');
        return;
    }

    // 2. Parse values
    // [0] = Current DSCR, [1] = Covenant Min, [2] = Annual Debt Service (optional)
    var rawDscr = self.ctx.data[0].data[0][1];
    var rawCovenant = self.ctx.data[1].data[0][1];

    var valDscr = parseFloat(rawDscr);
    var valMin = parseFloat(rawCovenant);

    if (isNaN(valDscr)) valDscr = 0;
    if (isNaN(valMin)) valMin = 1.30;

    // 3. Optional 3rd value — annual debt service
    var valService = 0;
    if (self.ctx.data.length > 2 &&
        self.ctx.data[2].data && self.ctx.data[2].data.length > 0) {
        valService = parseFloat(self.ctx.data[2].data[0][1]);
        if (isNaN(valService)) valService = 0;
    }

    // 4. Compliance logic
    var isCompliant = valDscr >= valMin;
    var currency = s.currency || 'LKR';

    // 5. Format DSCR
    var dscrDecimals = (s.dscrDecimals !== undefined) ? s.dscrDecimals : 2;
    $valDscr.text(valDscr.toFixed(dscrDecimals));
    $valDscr.removeClass('skeleton');

    // 6. Format covenant
    $valCovenant.text(valMin.toFixed(dscrDecimals));

    // 7. Auto-scale debt service (K / M / B)
    var autoScale = (s.autoScale !== false);
    var scaleSteps = [
        { threshold: 1e9, suffix: 'B', divisor: 1e9 },
        { threshold: 1e6, suffix: 'M', divisor: 1e6 },
        { threshold: 1e3, suffix: 'K', divisor: 1e3 },
        { threshold: 0, suffix: '', divisor: 1 }
    ];

    var serviceDisplay = valService;
    var serviceSuffix = '';

    if (autoScale && valService > 0) {
        for (var i = 0; i < scaleSteps.length; i++) {
            if (Math.abs(valService) >= scaleSteps[i].threshold) {
                serviceDisplay = valService / scaleSteps[i].divisor;
                serviceSuffix = scaleSteps[i].suffix;
                break;
            }
        }
    }

    var serviceDecimals = (s.serviceDecimals !== undefined) ? s.serviceDecimals : 1;
    var formattedService = serviceDisplay.toLocaleString('en-US', {
        minimumFractionDigits: serviceDecimals,
        maximumFractionDigits: serviceDecimals
    });

    $valService.text(currency + ' ' + formattedService + serviceSuffix);

    // 8. Update status
    $statusBox.removeClass('compliant breach');

    if (isCompliant) {
        $statusBox.addClass('compliant');
        $valStatus.text('COMPLIANT');
    } else {
        $statusBox.addClass('breach');
        $valStatus.text('BREACH');
    }

    // 9. Angular change detection
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// --------------------------------------------------
//  Responsive font scaling
// --------------------------------------------------
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.dscr-panel');
    var h = $el.height();
    var w = $el.width();

    // Em budget:
    //   title(0.7) + statusBox(dscr 1.6 + label 0.55 + padding 0.9 ≈ 3.0) +
    //   footer(0.45) + margins(0.6) + padding(1.0) + tooltip clearance(1.0) ≈ 8.0em
    var fromHeight = (h - 8) / 8.0;

    // Width: dscrLabel + value + icon + statusText + gaps ≈ 18em
    var fromWidth = w / 18;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 24) fontSize = 24;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
