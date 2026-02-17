// ============================================
// Diversification Analysis (Correlation Matrix)
// ThingsBoard v4.3.0 PE | Latest Values
// ============================================

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    self.updateDom();
    self.onResize();
    self.onDataUpdated();

    // Tooltip handlers (scoped to this widget)
    var $el = self.ctx.$widget;
    var $tooltip = $el.find('.js-tooltip');
    if ($tooltip.length === 0) {
        $tooltip = $('.matrix-tooltip');
    }

    $el.on('mousemove', '.data-cell', function (e) {
        var $cell = $(this);
        $tooltip.find('.js-tt-pair').text($cell.data('pair'));
        $tooltip.find('.js-tt-val').text($cell.data('val'));
        $tooltip.find('.js-tt-desc').text($cell.data('desc'))
            .css('color', $cell.css('background-color'));

        var top = e.clientY - $tooltip.outerHeight() - 12;
        var left = e.clientX - ($tooltip.outerWidth() / 2);
        $tooltip.css({ top: top, left: left, display: 'block' });
    });

    $el.on('mouseleave', '.data-cell', function () {
        $tooltip.hide();
    });
};

// --------------------------------------------------
//  DOM setup
// --------------------------------------------------
self.updateDom = function () {
    var s = self.ctx.settings;
    self.ctx.$widget.find('.js-title').text(
        s.widgetTitle || 'Diversification Analysis (Inter-Site Correlation)'
    );
};

// --------------------------------------------------
//  Data handler — build the grid
// --------------------------------------------------
self.onDataUpdated = function () {
    var $el = self.ctx.$widget;

    // 1. Safety check
    if (!self.ctx.data || self.ctx.data.length === 0 ||
        !self.ctx.data[0].data || self.ctx.data[0].data.length === 0) {
        return;
    }

    // 2. Parse JSON
    var rawJson = self.ctx.data[0].data[0][1];
    var dataObj = {};
    try {
        dataObj = (typeof rawJson === 'string') ? JSON.parse(rawJson) : rawJson;
    } catch (e) {
        console.error('JSON Parse Error', e);
        return;
    }

    if (!dataObj.sites || !dataObj.matrix) return;

    var sites = dataObj.sites;
    var matrix = dataObj.matrix;
    var N = sites.length;
    var $grid = $el.find('.js-grid');

    // 3. CSS Grid: label col (auto) + N data cols (1fr each)
    //    Rows:     label row (auto) + N data rows (1fr each)
    var colTemplate = 'auto repeat(' + N + ', 1fr)';
    var rowTemplate = 'auto repeat(' + N + ', 1fr)';
    $grid.css({
        'grid-template-columns': colTemplate,
        'grid-template-rows': rowTemplate
    });

    // 4. Build grid HTML
    var html = '';

    // Header row: empty corner + column labels (vertical text)
    html += '<div class="grid-cell"></div>';
    for (var i = 0; i < N; i++) {
        html += '<div class="grid-cell grid-label label-col">' + sites[i] + '</div>';
    }

    // Data rows
    for (var r = 0; r < N; r++) {
        // Row label
        html += '<div class="grid-cell grid-label label-row">' + sites[r] + '</div>';

        for (var c = 0; c < N; c++) {
            var val = matrix[r][c];
            if (val === null || val === undefined || isNaN(parseFloat(val))) {
                val = 0;
            }
            val = parseFloat(val);
            var displayVal = val.toFixed(2);

            var bgClass = 'bg-low';
            var desc = 'Low Correlation';
            var isSelf = (r === c);

            if (isSelf) {
                bgClass = 'bg-high';
                desc = 'Self';
            } else if (val >= 0.7) {
                bgClass = 'bg-high';
                desc = 'High Correlation';
            } else if (val >= 0.4) {
                bgClass = 'bg-mid';
                desc = 'Moderate';
            }

            var selfClass = isSelf ? ' cell-self' : '';

            html += '<div class="grid-cell data-cell ' + bgClass + selfClass + '"' +
                ' data-val="' + displayVal + '"' +
                ' data-pair="' + sites[r] + ' vs ' + sites[c] + '"' +
                ' data-desc="' + desc + '">' +
                displayVal +
                '</div>';
        }
    }

    $grid.html(html);

    // 5. Update cell font-size based on cell dimensions
    self.updateCellFonts();

    // 6. Angular change detection
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// --------------------------------------------------
//  Cell font sizing — fit text inside cells
// --------------------------------------------------
self.updateCellFonts = function () {
    var $el = self.ctx.$widget;
    var $cells = $el.find('.data-cell');
    if ($cells.length === 0) return;

    // Measure first data cell
    var cellW = $cells.first().width();
    var cellH = $cells.first().height();

    // Text "0.85" ≈ 4 chars. Font needs to fit in cell width
    // At font-size F, "0.85" is ~2.4F wide, ~F tall
    var fromWidth = cellW / 3.2;
    var fromHeight = cellH / 1.6;
    var cellFont = Math.min(fromWidth, fromHeight);

    if (cellFont < 5) {
        // Too small to show text — hide it
        $cells.css('font-size', '0px');
    } else {
        if (cellFont > 16) cellFont = 16;
        $cells.css('font-size', cellFont + 'px');
    }

    // Label font: scale with card, clamp
    var $card = $el.find('.matrix-card');
    var cardFont = parseFloat($card.css('font-size')) || 14;
    var labelFont = cardFont * 0.6;
    if (labelFont < 7) labelFont = 7;
    if (labelFont > 14) labelFont = 14;
    $el.find('.grid-label').css('font-size', labelFont + 'px');
};

// --------------------------------------------------
//  Responsive font scaling
// --------------------------------------------------
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.matrix-card');
    var w = $el.width();
    var h = $el.height();

    // Title + legend + padding ≈ 3em overhead
    // Grid gets the rest
    var fromWidth = w / 22;
    var fromHeight = h / 10;

    var fontSize = Math.min(fromWidth, fromHeight);

    if (fontSize < 8) fontSize = 8;
    if (fontSize > 24) fontSize = 24;

    $card.css('font-size', fontSize + 'px');

    // Re-calc cell fonts after card resize
    self.updateCellFonts();
};

// --------------------------------------------------
//  Cleanup
// --------------------------------------------------
self.onDestroy = function () {
    var $el = self.ctx.$widget;
    $el.off('mousemove', '.data-cell');
    $el.off('mouseleave', '.data-cell');
};