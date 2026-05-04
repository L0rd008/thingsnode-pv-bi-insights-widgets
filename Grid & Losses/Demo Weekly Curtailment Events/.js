var $el, s;
var $card, $title, $statusDot, $statusText;
var $statCount, $statAvg;
var $list, $asset, $tooltip;

self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;

    $card = $el.find('.claims-card');
    $title = $el.find('.js-title');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $statCount = $el.find('.js-stat-count');
    $statAvg = $el.find('.js-stat-avg');
    $list = $el.find('.js-list');
    $asset = $el.find('.js-asset');
    $tooltip = $el.find('.js-tooltip');

    self.onResize();
    self.onDataUpdated();
};

self.onDataUpdated = function () {
    $list.empty();
    
    var assetName = '--';
    if (self.ctx.datasources && self.ctx.datasources.length) {
        assetName = self.ctx.datasources[0].entityName || '--';
    }
    $asset.text(assetName);

    var now = new Date();
    
    // Monday of this week
    var day1 = new Date(now);
    day1.setDate(now.getDate() - now.getDay() + 1);
    day1.setHours(9, 15, 0);
    
    // Wednesday of this week
    var day2 = new Date(now);
    day2.setDate(now.getDate() - now.getDay() + 3);
    day2.setHours(13, 40, 0);

    // Thursday of this week
    var day3 = new Date(now);
    day3.setDate(now.getDate() - now.getDay() + 4);
    day3.setHours(16, 20, 0);

    var events = [
        { date: day1, eventType: 'Grid Frequency Drop', restriction: 40, status: 'Active' },
        { date: day2, eventType: 'CEB Substation Limit', restriction: 0, status: 'Resolved' },
        { date: day3, eventType: 'Local Overvoltage', restriction: 80, status: 'Active' }
    ];

    var totalRes = 0;
    var countActive = 0;

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        
        var dateStr = ev.date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' + 
                      ev.date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                      
        var statusClass = ev.status === 'Active' ? 'rejected' : 'approved';
        if (ev.status === 'Active') countActive++;
        totalRes += ev.restriction;
        
        var rowHtml = '<div class="table-row">' +
            '<div class="col col-date val-date">' + dateStr + '</div>' +
            '<div class="col col-event val-event">' + ev.eventType + '</div>' +
            '<div class="col col-amount val-amount">' + ev.restriction + '%</div>' +
            '<div class="col col-status">' +
                '<div class="status-pill ' + statusClass + '">' + ev.status + '</div>' +
            '</div>' +
            '</div>';
        $list.append(rowHtml);
    }

    $statCount.text(events.length);
    var avg = Math.round(totalRes / events.length);
    $statAvg.text(avg + '%');

    if (countActive > 0) {
        $statusDot.removeClass('good warning critical').addClass('critical');
        $statusText.text(countActive + ' ACTIVE').removeClass('good warning critical').addClass('critical');
    } else {
        $statusDot.removeClass('good warning critical').addClass('good');
        $statusText.text('CLEAR').removeClass('good warning critical').addClass('good');
    }

    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

self.onResize = function () {
    var h = $el.height();
    var w = $el.width();
    if (!w || !h) return;

    var fromHeight = (h - 4) / 6.0;
    var fromWidth = w / 22;
    var fontSize = Math.min(fromHeight, fromWidth);

    if (fontSize < 8) fontSize = 8;
    if (fontSize > 30) fontSize = 30;

    $card.css('font-size', fontSize + 'px');
};
