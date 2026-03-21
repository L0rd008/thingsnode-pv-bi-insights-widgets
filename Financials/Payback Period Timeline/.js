// ============================================
// Payback Period Timeline
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
//  DOM setup — title, labels, axis, tooltip
// --------------------------------------------------
self.updateDom = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    // Title
    $el.find('.js-title').text(s.widgetTitle || 'PAYBACK PERIOD');

    // Sub-labels
    $el.find('.js-sub-simple').text(s.simpleLabel || 'Simple Payback');
    $el.find('.js-sub-discounted').text(s.discountedLabel || 'Discounted');

    // Dynamic axis generation
    var maxYears = parseInt(s.maxYears) || 10;
    var $axis = $el.find('.js-axis');
    $axis.empty();

    var step = 1;
    if (maxYears > 20) step = 5;
    else if (maxYears > 10) step = 2;

    for (var i = 0; i <= maxYears; i += step) {
        $axis.append('<span>' + i + '</span>');
    }

    // Tooltip
    var defaultTip = 'Time required to recover the initial investment (CAPEX) through energy savings. Lower is better.';
    var ttText = s.tooltipText || defaultTip;
    if (ttText) {
        $el.find('.js-tooltip').text(ttText);
        $el.find('.tooltip-container').show();
    } else {
        $el.find('.tooltip-container').hide();
    }
};

// --------------------------------------------------
//  Data handler — simple & discounted payback
// --------------------------------------------------
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;
    var s = self.ctx.settings;

    var $valSimple = $el.find('.js-val-simple');
    var $valDisc = $el.find('.js-val-discounted');
    var $dotSimple = $el.find('.js-dot-simple');
    var $dotDisc = $el.find('.js-dot-discounted');
    var $labelSimple = $el.find('.js-label-simple');
    var $labelDisc = $el.find('.js-label-discounted');
    var $trackFill = $el.find('.js-track-fill');

    // 1. Data safety check — need at least 1 series
    if (!self.ctx.data || self.ctx.data.length < 1 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        $valSimple.text('-- Years');
        $valDisc.text('-- Years');
        return;
    }

    var maxYears = parseInt(s.maxYears) || 10;
    var decimals = (s.decimals !== undefined) ? s.decimals : 1;
    var unit = s.unit || 'Years';

    // 2. Parse simple payback
    var valSimple = parseFloat(self.ctx.data[0].data[0][1]);
    if (isNaN(valSimple)) valSimple = 0;

    // 3. Parse discounted payback (optional 2nd series)
    var valDisc = 0;
    var hasDiscounted = false;
    if (self.ctx.data.length > 1 &&
        self.ctx.data[1].data && self.ctx.data[1].data.length > 0) {
        valDisc = parseFloat(self.ctx.data[1].data[0][1]);
        if (!isNaN(valDisc) && valDisc > 0) {
            hasDiscounted = true;
        } else {
            valDisc = 0;
        }
    }

    // 4. Position calculation (percentage along track)
    var pctSimple = Math.min((valSimple / maxYears) * 100, 100);
    var pctDisc = Math.min((valDisc / maxYears) * 100, 100);

    // 5. Update simple payback
    $valSimple.text(valSimple.toFixed(decimals) + ' ' + unit);
    $valSimple.removeClass('skeleton');

    $trackFill.css('width', pctSimple + '%');
    $dotSimple.css('left', pctSimple + '%');
    $labelSimple.css('left', pctSimple + '%');

    // 6. Update discounted payback
    if (hasDiscounted) {
        $valDisc.text(valDisc.toFixed(decimals) + ' ' + unit);
        $valDisc.removeClass('skeleton');
        $dotDisc.show();
        $labelDisc.show();
        $dotDisc.css('left', pctDisc + '%');
        $labelDisc.css('left', pctDisc + '%');
    } else {
        $dotDisc.hide();
        $labelDisc.hide();
    }

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
    var $card = $el.find('.payback-card');
    var h = $el.height();
    var w = $el.width();

    // Em budget:
    //   title(0.7) + markerLabels(0.65+0.45 ≈ 1.1) + track(0.5) +
    //   axis(0.4) + padding(1.0) + gaps(0.8) ≈ 4.5em
    //   Use larger divisor to keep small
    var fromHeight = (h - 8) / 6.0;

    // Width: axis labels + track + padding ≈ 14em
    var fromWidth = w / 16;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 24) fontSize = 24;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};
