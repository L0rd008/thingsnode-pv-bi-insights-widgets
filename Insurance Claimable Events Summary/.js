// ════════════════════════════════════════════════════
// Insurance Claimable Events Summary — v2.0
// ThingsBoard v4.3.0 PE | Latest Values
// Table-style claims with status pills
// DOM caching | em-budget resize | no template literals
// ════════════════════════════════════════════════════

var $el, s;
var $card, $title;
var $statusDot, $statusText;
var $statCount, $statApproved, $statPending, $statRejected;
var $list, $total, $tooltip;

// ──────────────────────────────────────────────────
//  Lifecycle: Init
// ──────────────────────────────────────────────────
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;

    // ── Cache DOM ──
    $card = $el.find('.claims-card');
    $title = $el.find('.js-title');
    $statusDot = $el.find('.js-status-dot');
    $statusText = $el.find('.js-status-text');
    $statCount = $el.find('.js-stat-count');
    $statApproved = $el.find('.js-stat-approved');
    $statPending = $el.find('.js-stat-pending');
    $statRejected = $el.find('.js-stat-rejected');
    $list = $el.find('.js-list');
    $total = $el.find('.js-total');
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

    updateDom();
    self.onResize();
    self.onDataUpdated();
};

// ──────────────────────────────────────────────────
//  DOM setup — titles, tooltip
// ──────────────────────────────────────────────────
function updateDom() {
    $title.text(s.widgetTitle || 'INSURANCE CLAIMABLE EVENTS SUMMARY');

    if (s.tooltipText) {
        $tooltip.text(s.tooltipText);
    }
}

// ──────────────────────────────────────────────────
//  Data handler
// ──────────────────────────────────────────────────
self.onDataUpdated = function () {
    $list.empty();

    var currency = s.currencySym || 'LKR';
    var unit = s.energyUnit || 'MWh';

    // ── 1. Data Extraction ──
    var claimsData = [];
    var hasData = self.ctx.data && self.ctx.data.length > 0 &&
        self.ctx.data[0].data && self.ctx.data[0].data.length > 0;

    if (hasData) {
        try {
            var raw = self.ctx.data[0].data[0][1];
            claimsData = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        } catch (e) {
            console.error('Insurance Claims: Parse Error', e);
        }
    }

    // ── 2. Demo fallback (configurable) ──
    var enableDemo = (s.enableDemoData !== undefined) ? s.enableDemoData : true;
    if ((!claimsData || claimsData.length === 0) && enableDemo) {
        claimsData = [
            { date: '2026-02-02', eventType: 'Storm Damage (Monsoon)', energyLost: 15.2, amount: 350000, status: 'Pending' },
            { date: '2026-01-14', eventType: 'Inverter Fire', energyLost: 28.5, amount: 650000, status: 'Approved' },
            { date: '2025-12-17', eventType: 'CEB Grid Failure', energyLost: 5.8, amount: 125000, status: 'Rejected' },
            { date: '2025-11-03', eventType: 'Lightning Strike', energyLost: 42.1, amount: 820000, status: 'Approved' },
            { date: '2025-10-20', eventType: 'Flood Damage', energyLost: 18.9, amount: 410000, status: 'Pending' }
        ];
    }

    // ── 3. Empty state ──
    if (!claimsData || claimsData.length === 0) {
        $list.html('<div class="empty-state">No claimable events recorded</div>');
        updateStats(0, 0, 0, 0);
        updateStatus(0, 0, 0);
        $total.text(currency + ' 0');

        if (!s.tooltipText) {
            $tooltip.text('No insurance claims on record.');
        }

        if (self.ctx.detectChanges) self.ctx.detectChanges();
        return;
    }

    // ── 4. Render rows + accumulate stats ──
    var totalClaimable = 0;
    var countApproved = 0;
    var countPending = 0;
    var countRejected = 0;

    for (var i = 0; i < claimsData.length; i++) {
        var claim = claimsData[i];

        // Amount
        var amountVal = parseFloat(claim.amount);
        if (isNaN(amountVal)) amountVal = 0;
        var amountStr = amountVal.toLocaleString();

        // Date
        var dateStr = claim.date || '--';
        var d = new Date(claim.date);
        if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
        }

        // Status
        var statusLower = (claim.status || '').toLowerCase();
        var statusClass = 'pending';

        if (statusLower.indexOf('approv') !== -1) {
            statusClass = 'approved';
            totalClaimable += amountVal;
            countApproved++;
        } else if (statusLower.indexOf('reject') !== -1) {
            statusClass = 'rejected';
            countRejected++;
        } else {
            statusClass = 'pending';
            totalClaimable += amountVal;
            countPending++;
        }

        // Build row (string concatenation, not template literals)
        var rowHtml = '<div class="table-row">' +
            '<div class="col col-date val-date">' + esc(dateStr) + '</div>' +
            '<div class="col col-event val-event">' + esc(claim.eventType) + '</div>' +
            '<div class="col col-lost val-lost">' + (claim.energyLost || 0) + ' ' + unit + '</div>' +
            '<div class="col col-amount val-amount">' + currency + ' ' + amountStr + '</div>' +
            '<div class="col col-status">' +
            '<div class="status-pill ' + statusClass + '">' + esc(claim.status || 'Pending') + '</div>' +
            '</div>' +
            '</div>';
        $list.append(rowHtml);
    }

    // ── 5. Footer total ──
    $total.text(currency + ' ' + totalClaimable.toLocaleString());

    // ── 6. Summary stats ──
    updateStats(claimsData.length, countApproved, countPending, countRejected);

    // ── 7. Status ──
    updateStatus(countApproved, countPending, countRejected);

    // ── 8. Dynamic tooltip ──
    if (!s.tooltipText) {
        var tipParts = [];
        tipParts.push(claimsData.length + ' claim' + (claimsData.length !== 1 ? 's' : '') + ' on record');
        tipParts.push(countApproved + ' approved · ' + countPending + ' pending · ' + countRejected + ' rejected');
        tipParts.push('Total claimable: ' + currency + ' ' + totalClaimable.toLocaleString());
        $tooltip.text(tipParts.join(' · '));
    }

    // ── Angular change detection ──
    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// ──────────────────────────────────────────────────
//  Update summary stats
// ──────────────────────────────────────────────────
function updateStats(total, approved, pending, rejected) {
    $statCount.text(total);
    $statApproved.text(approved);
    $statPending.text(pending);
    $statRejected.text(rejected);
}

// ──────────────────────────────────────────────────
//  Update status dot + text
// ──────────────────────────────────────────────────
function updateStatus(approved, pending, rejected) {
    var dotClass, statusLabel;

    if (pending === 0 && rejected === 0 && approved > 0) {
        dotClass = 'good';
        statusLabel = 'ALL APPROVED';
    } else if (rejected > 0) {
        dotClass = 'critical';
        statusLabel = rejected + ' REJECTED';
    } else if (pending > 0) {
        dotClass = 'warning';
        statusLabel = pending + ' PENDING';
    } else {
        dotClass = 'good';
        statusLabel = 'CLEAR';
    }

    $statusDot.removeClass('good warning critical').addClass(dotClass);
    $statusText.text(statusLabel).removeClass('good warning critical').addClass(dotClass);
}

// ──────────────────────────────────────────────────
//  HTML escape helper
// ──────────────────────────────────────────────────
function esc(str) {
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
    //   header(0.8) + summary(0.6) + table-header(0.5) + ~3 rows(2.4)
    //   + footer(0.8) + gaps/padding(0.9) ≈ 6.0 em
    var fromHeight = (h - 4) / 6.0;

    // Width: 5 columns need ~22em min
    var fromWidth = w / 22;

    var fontSize = Math.min(fromHeight, fromWidth);

    // Clamp
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 30) fontSize = 30;

    $card.css('font-size', fontSize + 'px');
};

self.onDestroy = function () {
};