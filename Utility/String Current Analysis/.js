// ════════════════════════════════════════════════════════
// String Current Analysis — Light Mode
// ThingsBoard v4.3.0 PE | Time Series (Custom)
// Hierarchical inverter/string selector + ECharts
// jQuery · ES5 · em-budget scaling
// ════════════════════════════════════════════════════════

var PALETTE = [
    '#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED',
    '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5',
    '#059669', '#CA8A04', '#9333EA', '#0284C7', '#E11D48',
    '#15803D', '#C2410C', '#6D28D9', '#0369A1', '#BE185D'
];

var $el, s, chart;
var $card, $activeCount, $toggleAllBtn;
var $sidebarToggle, $toggleIcon;
var $treePanel, $treeScroll, $searchInput;
var $chartContainer, $chartEmpty;
var state, keyPattern, updateTimer;
var sidebarCollapsed = true;

// ──────────────────────────────────────────────────────
//  Lifecycle: Init
// ──────────────────────────────────────────────────────
self.onInit = function () {
    s = self.ctx.settings || {};
    $el = self.ctx.$container;
    self.ctx.$widget = $el;



    state = {
        inverters: {},
        activeCount: 0,
        totalCount: 0
    };

    try {
        keyPattern = new RegExp(s.keyPattern || '^pv\\d+_c$');
    } catch (e) {
        keyPattern = /^pv\d+_c$/;
    }

    cacheDom();
    updateDom();
    parseDataSources();
    buildTree();
    initChart();
    bindEvents();
    self.onResize();
    updateChart();
};

// ──────────────────────────────────────────────────────
//  DOM Cache
// ──────────────────────────────────────────────────────
function cacheDom() {
    $card           = $el.find('.string-analysis-card');
    $activeCount    = $el.find('.js-active-count');
    $toggleAllBtn   = $el.find('.js-toggle-all');
    $sidebarToggle  = $el.find('.js-sidebar-toggle');
    $toggleIcon     = $el.find('.js-toggle-icon');
    $treePanel      = $el.find('.js-tree-panel');
    $treeScroll     = $el.find('.js-tree-scroll');
    $searchInput    = $el.find('.js-search');
    $chartContainer = $el.find('.js-chart-container');
    $chartEmpty     = $el.find('.js-chart-empty');
}

// ──────────────────────────────────────────────────────
//  DOM Setup
// ──────────────────────────────────────────────────────
function updateDom() {
    var sidebarPct = parseInt(s.sidebarWidth) || 22;
    if (sidebarPct < 10) sidebarPct = 10;
    if (sidebarPct > 40) sidebarPct = 40;

    if (sidebarCollapsed) {
        $treePanel.addClass('collapsed');
        $treePanel.css('flex', '');
    } else {
        $treePanel.removeClass('collapsed');
        $treePanel.css('flex', '0 0 ' + sidebarPct + '%');
    }

    $toggleIcon.html(sidebarCollapsed ? '&#9776;' : '&#10005;');
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:updateDom',message:'sidebar state after updateDom',data:{collapsed:sidebarCollapsed,hasCollapsedClass:$treePanel.hasClass('collapsed'),inlineFlex:$treePanel[0].style.flex},timestamp:Date.now(),hypothesisId:'H-flex-clear',runId:'post-fix'})}).catch(function(){});
// #endregion
}

// ──────────────────────────────────────────────────────
//  Parse self.ctx.data → build inverter hierarchy
// ──────────────────────────────────────────────────────
function parseDataSources() {
    var inverters = {};
    var colorIdx = 0;

    if (!self.ctx.data || self.ctx.data.length === 0) return;

    for (var i = 0; i < self.ctx.data.length; i++) {
        var entry = self.ctx.data[i];
        if (!entry.datasource || !entry.dataKey) continue;

        var entityName = entry.datasource.entityLabel
                      || entry.datasource.entityName
                      || entry.datasource.name
                      || ('Entity-' + i);
        var keyName = entry.dataKey.name;

        if (!keyPattern.test(keyName)) continue;

        if (!inverters[entityName]) {
            inverters[entityName] = { strings: {} };
        }

        var existingState = state.inverters[entityName]
                         && state.inverters[entityName].strings[keyName];

        inverters[entityName].strings[keyName] = {
            dataIndex: i,
            color: PALETTE[colorIdx % PALETTE.length],
            checked: existingState ? existingState.checked : false
        };

        colorIdx++;
    }

    var isFirstLoad = (Object.keys(state.inverters).length === 0);
    var invNames = Object.keys(inverters).sort();
    var defaultExpanded = s.defaultExpanded || false;

    for (var n = 0; n < invNames.length; n++) {
        var name = invNames[n];
        var prev = state.inverters[name];
        inverters[name].expanded = prev ? prev.expanded : defaultExpanded;
    }

    if (isFirstLoad) {
        for (var f = 0; f < invNames.length; f++) {
            var inv = inverters[invNames[f]];
            var sortedKeys = Object.keys(inv.strings).sort(naturalSort);
            if (sortedKeys.length > 0) {
                inv.strings[sortedKeys[0]].checked = true;
            }
        }
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:parseDataSources',message:'H1 first-load auto-check',data:{invCount:invNames.length,firstKeys:invNames.map(function(n){var ks=Object.keys(inverters[n].strings).sort(naturalSort);return n+':'+ks[0]+'='+inverters[n].strings[ks[0]].checked;})},timestamp:Date.now(),hypothesisId:'H1'})}).catch(function(){});
// #endregion
    }

    state.inverters = inverters;
    recountActive();
}

// ──────────────────────────────────────────────────────
//  Natural sort: pv1_c, pv2_c, ..., pv10_c
// ──────────────────────────────────────────────────────
function naturalSort(a, b) {
    var numA = parseInt(a.replace(/\D/g, ''), 10);
    var numB = parseInt(b.replace(/\D/g, ''), 10);
    if (isNaN(numA)) numA = 0;
    if (isNaN(numB)) numB = 0;
    return numA - numB;
}

// ──────────────────────────────────────────────────────
//  Active series counter
// ──────────────────────────────────────────────────────
function recountActive() {
    var active = 0;
    var total = 0;
    var invNames = Object.keys(state.inverters);

    for (var i = 0; i < invNames.length; i++) {
        var inv = state.inverters[invNames[i]];
        var keys = Object.keys(inv.strings);
        for (var j = 0; j < keys.length; j++) {
            total++;
            if (inv.strings[keys[j]].checked) active++;
        }
    }

    state.activeCount = active;
    state.totalCount = total;
    $activeCount.text(active + ' / ' + total + ' active');

    if (active === 0) {
        $toggleAllBtn.text('Select All').addClass('select-mode');
    } else {
        $toggleAllBtn.text('Deselect All').removeClass('select-mode');
    }
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:recountActive',message:'H4 button text toggle',data:{active:active,total:total,btnText:active===0?'Select All':'Deselect All'},timestamp:Date.now(),hypothesisId:'H4'})}).catch(function(){});
// #endregion
}

// ──────────────────────────────────────────────────────
//  Build Tree UI
// ──────────────────────────────────────────────────────
function buildTree() {
    var html = '';
    var invNames = Object.keys(state.inverters).sort();

    for (var n = 0; n < invNames.length; n++) {
        var invName = invNames[n];
        var inv = state.inverters[invName];
        var keys = Object.keys(inv.strings).sort(naturalSort);
        var checkedCount = 0;

        for (var k = 0; k < keys.length; k++) {
            if (inv.strings[keys[k]].checked) checkedCount++;
        }

        var allChecked = (checkedCount === keys.length && keys.length > 0);
        var someChecked = (checkedCount > 0 && checkedCount < keys.length);
        var expandIcon = inv.expanded ? '\u25BE' : '\u25B8';

        html += '<div class="tree-inverter" data-inverter="' + escapeAttr(invName) + '">';
        html += '<div class="inverter-header">';
        html += '<span class="expand-icon js-expand">' + expandIcon + '</span>';
        html += '<label class="inverter-check">';
        html += '<input type="checkbox" class="js-inv-check"'
             + (allChecked ? ' checked' : '') + '>';
        html += '<span class="inverter-name">' + escapeHtml(invName) + '</span>';
        html += '</label>';
        html += '<span class="inverter-count">' + checkedCount + '/' + keys.length + '</span>';
        html += '</div>';

        if (inv.expanded) {
            html += '<div class="string-list">';
            for (var j = 0; j < keys.length; j++) {
                var str = inv.strings[keys[j]];
                var displayName = keys[j].replace(/_c$/i, '').toUpperCase();

                html += '<label class="string-item" data-inverter="' + escapeAttr(invName) + '" data-key="' + escapeAttr(keys[j]) + '">';
                html += '<input type="checkbox" class="js-str-check"' + (str.checked ? ' checked' : '') + '>';
                html += '<span class="color-swatch" style="background:' + str.color + ';color:' + str.color + '"></span>';
                html += '<span class="string-name">' + displayName + '</span>';
                html += '</label>';
            }
            html += '</div>';
        }

        html += '</div>';
    }

    if (invNames.length === 0) {
        html = '<div style="padding:1em;text-align:center;font-size:0.55em;color:#94A3B8;">No data sources available</div>';
    }

    var scrollTop = $treeScroll.scrollTop();
    $treeScroll.html(html);
    $treeScroll.scrollTop(scrollTop);

    // Apply indeterminate state via DOM (class-based, not native prop)
    $treeScroll.find('.tree-inverter').each(function () {
        var invName = $(this).attr('data-inverter');
        var inv = state.inverters[invName];
        if (!inv) return;
        var keys = Object.keys(inv.strings);
        var checked = 0;
        for (var i = 0; i < keys.length; i++) {
            if (inv.strings[keys[i]].checked) checked++;
        }
        if (checked > 0 && checked < keys.length) {
            $(this).find('.js-inv-check').addClass('indeterminate').prop('checked', false);
        }
    });

    // Re-apply search filter if active
    var currentQuery = $searchInput.val();
    if (currentQuery && currentQuery.trim()) {
        applySearchFilter(currentQuery.toLowerCase().trim());
    }
}

// ──────────────────────────────────────────────────────
//  ECharts Initialization
// ──────────────────────────────────────────────────────
function initChart() {
    if (typeof echarts === 'undefined') {
        console.error('[StringCurrentAnalysis] ECharts not loaded. Add it to widget Resources.');
        return;
    }

    var container = $chartContainer[0];
    if (!container) return;

    chart = echarts.init(container, null, { renderer: 'canvas' });

    var enableZoom = (s.enableDataZoom !== undefined) ? s.enableDataZoom : true;
    var yLabel = s.yAxisLabel || 'Current (A)';
    var lineW = parseFloat(s.lineWidth) || 1.5;

    var baseOption = {
        animation: false,
        grid: {
            left: 48,
            right: 16,
            top: 28,
            bottom: enableZoom ? 52 : 24,
            containLabel: false
        },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: '#E2E8F0' } },
            axisTick: { lineStyle: { color: '#E2E8F0' } },
            axisLabel: {
                color: '#475569',
                fontSize: 10,
                hideOverlap: true
            },
            splitLine: {
                show: true,
                lineStyle: { color: '#F1F5F9' }
            }
        },
        yAxis: {
            type: 'value',
            name: yLabel,
            nameTextStyle: {
                color: '#94A3B8',
                fontSize: 10,
                padding: [0, 0, 0, 4]
            },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
                color: '#475569',
                fontSize: 10
            },
            splitLine: {
                lineStyle: { color: '#F1F5F9', type: 'dashed' }
            }
        },
        tooltip: {
            trigger: 'axis',
            backgroundColor: '#FFFFFF',
            borderColor: '#E2E8F0',
            borderWidth: 1,
            textStyle: { color: '#0F172A', fontSize: 11 },
            confine: true,
            appendToBody: true,
            formatter: function (params) {
                if (!params || params.length === 0) return '';
                var time = new Date(params[0].axisValue);
                var hh = String(time.getHours()).padStart(2, '0');
                var mm = String(time.getMinutes()).padStart(2, '0');
                var header = '<div style="font-weight:600;margin-bottom:4px;color:#0F172A;">' + hh + ':' + mm + '</div>';
                var rows = '';
                for (var i = 0; i < params.length; i++) {
                    var p = params[i];
                    var val = (p.value && p.value[1] !== null && p.value[1] !== undefined)
                        ? parseFloat(p.value[1]).toFixed(2) + ' A'
                        : '--';
                    rows += '<div style="display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.6;">'
                         + '<span style="width:8px;height:8px;border-radius:50%;background:' + p.color + ';flex-shrink:0;"></span>'
                         + '<span style="flex:1;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(p.seriesName) + '</span>'
                         + '<span style="font-weight:600;color:#0F172A;">' + val + '</span>'
                         + '</div>';
                }
                return header + rows;
            }
        },
        dataZoom: enableZoom ? [
            { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
            {
                type: 'slider',
                xAxisIndex: 0,
                height: 18,
                bottom: 6,
                borderColor: '#E2E8F0',
                backgroundColor: '#F8FAFC',
                fillerColor: 'rgba(37, 99, 235, 0.08)',
                handleStyle: { color: '#2563EB', borderColor: '#2563EB' },
                dataBackground: {
                    lineStyle: { color: '#CBD5E1' },
                    areaStyle: { color: 'rgba(37, 99, 235, 0.04)' }
                },
                textStyle: { color: '#475569', fontSize: 9 }
            }
        ] : [],
        graphic: [{
            type: 'text',
            right: 16,
            top: 6,
            style: {
                text: '',
                fill: '#94A3B8',
                fontSize: 10,
                fontFamily: 'Roboto, Segoe UI, Arial, sans-serif'
            },
            z: 100
        }],
        series: []
    };

    chart.setOption(baseOption);
}

// ──────────────────────────────────────────────────────
//  Update Chart — render only checked series
// ──────────────────────────────────────────────────────
function updateChart() {
    if (!chart) return;

    var series = [];
    var invNames = Object.keys(state.inverters).sort();
    var lineW = parseFloat(s.lineWidth) || 1.5;

    for (var i = 0; i < invNames.length; i++) {
        var invName = invNames[i];
        var inv = state.inverters[invName];
        var keys = Object.keys(inv.strings).sort(naturalSort);

        for (var j = 0; j < keys.length; j++) {
            var str = inv.strings[keys[j]];
            if (!str.checked) continue;

            var rawData = (self.ctx.data && self.ctx.data[str.dataIndex])
                        ? self.ctx.data[str.dataIndex].data
                        : [];

            var chartData = [];
            for (var d = 0; d < rawData.length; d++) {
                var ts = rawData[d][0];
                var val = rawData[d][1];
                if (val !== null && val !== undefined && !isNaN(parseFloat(val))) {
                    chartData.push([ts, parseFloat(val)]);
                }
            }

            series.push({
                name: invName + ' ' + keys[j].replace(/_c$/i, '').toUpperCase(),
                type: 'line',
                data: chartData,
                symbol: 'none',
                lineStyle: { width: lineW },
                itemStyle: { color: str.color },
                emphasis: { lineStyle: { width: lineW + 1 } },
                sampling: 'lttb',
                showSymbol: false,
                connectNulls: false
            });
        }
    }

    chart.setOption({ series: series }, { replaceMerge: ['series'] });

    // Timeframe label
    var minTs = null, maxTs = null;
    var tw = self.ctx && self.ctx.timeWindow;
    if (tw && tw.minTime && tw.maxTime) {
        minTs = tw.minTime;
        maxTs = tw.maxTime;
    } else {
        for (var t = 0; t < series.length; t++) {
            var sd = series[t].data;
            if (sd && sd.length > 0) {
                var first = sd[0][0], last = sd[sd.length - 1][0];
                if (minTs === null || first < minTs) minTs = first;
                if (maxTs === null || last > maxTs) maxTs = last;
            }
        }
    }
    if (minTs !== null && maxTs !== null) {
        var _tfLabel = formatTimeLabel(minTs) + '  \u2014  ' + formatTimeLabel(maxTs);
        chart.setOption({
            graphic: [{ style: { text: _tfLabel } }]
        });
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:updateChart',message:'H5 timeframe label set',data:{label:_tfLabel,source:tw?'timeWindow':'data',minTs:minTs,maxTs:maxTs},timestamp:Date.now(),hypothesisId:'H5'})}).catch(function(){});
// #endregion
    } else {
        chart.setOption({ graphic: [{ style: { text: '' } }] });
    }

    if (s.showFullDay !== false && minTs !== null) {
        var dayStart = new Date(minTs);
        dayStart.setHours(0, 0, 0, 0);
        var dayEnd = new Date(dayStart.getTime());
        dayEnd.setHours(23, 59, 59, 999);
        chart.setOption({ xAxis: { min: dayStart.getTime(), max: dayEnd.getTime() } });
    }

    if (series.length === 0) {
        $chartEmpty.show();
    } else {
        $chartEmpty.hide();
    }
}

function scheduleChartUpdate() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(function () {
        updateChart();
        updateTimer = null;
    }, 50);
}

// ──────────────────────────────────────────────────────
//  Event Binding
// ──────────────────────────────────────────────────────
function bindEvents() {
    // Expand / collapse inverter
    $treeScroll.on('click', '.inverter-header', function (e) {
        if ($(e.target).is('input[type="checkbox"]') || $(e.target).closest('.inverter-check').length) {
            return;
        }
        var invName = $(this).closest('.tree-inverter').attr('data-inverter');
        if (!state.inverters[invName]) return;
        state.inverters[invName].expanded = !state.inverters[invName].expanded;
        buildTree();
    });

    // Inverter checkbox — check/uncheck all strings
    $treeScroll.on('change', '.js-inv-check', function () {
        var invName = $(this).closest('.tree-inverter').attr('data-inverter');
        var inv = state.inverters[invName];
        if (!inv) return;

        var isChecked = $(this).prop('checked');
        var keys = Object.keys(inv.strings);

        if (isChecked) {
            for (var j = 0; j < keys.length; j++) {
                inv.strings[keys[j]].checked = true;
            }
        } else {
            for (var k = 0; k < keys.length; k++) {
                inv.strings[keys[k]].checked = false;
            }
        }

        recountActive();
        buildTree();
        scheduleChartUpdate();
    });

    // Individual string checkbox
    $treeScroll.on('change', '.js-str-check', function () {
        var $item = $(this).closest('.string-item');
        var invName = $item.attr('data-inverter');
        var keyName = $item.attr('data-key');
        var inv = state.inverters[invName];
        if (!inv || !inv.strings[keyName]) return;

        var isChecked = $(this).prop('checked');

        inv.strings[keyName].checked = isChecked;
        recountActive();
        buildTree();
        scheduleChartUpdate();
    });

    // Select All / Deselect All toggle
    $toggleAllBtn.on('click', function () {
        var invNames = Object.keys(state.inverters);
        var i, j, keys;

        if (state.activeCount === 0) {
            for (i = 0; i < invNames.length; i++) {
                keys = Object.keys(state.inverters[invNames[i]].strings).sort(naturalSort);
                for (j = 0; j < keys.length; j++) {
                    state.inverters[invNames[i]].strings[keys[j]].checked = true;
                }
            }
        } else {
            for (i = 0; i < invNames.length; i++) {
                keys = Object.keys(state.inverters[invNames[i]].strings);
                for (j = 0; j < keys.length; j++) {
                    state.inverters[invNames[i]].strings[keys[j]].checked = false;
                }
            }
        }

        recountActive();
        buildTree();
        scheduleChartUpdate();
    });

    // Sidebar toggle
    $sidebarToggle.on('click', function () {
        sidebarCollapsed = !sidebarCollapsed;
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:sidebarToggle',message:'H3 sidebar toggled',data:{collapsed:sidebarCollapsed},timestamp:Date.now(),hypothesisId:'H3'})}).catch(function(){});
// #endregion

        if (!sidebarCollapsed) {
            var invNames = Object.keys(state.inverters);
            for (var i = 0; i < invNames.length; i++) {
                state.inverters[invNames[i]].expanded = true;
            }
            buildTree();
        }

        updateDom();

        setTimeout(function () {
            if (chart) chart.resize();
        }, 280);
    });

    // Search filter
    $searchInput.on('input', function () {
        var query = $(this).val().toLowerCase().trim();
        applySearchFilter(query);
    });
}

// ──────────────────────────────────────────────────────
//  Search Filter — data-driven, works across all inverters
// ──────────────────────────────────────────────────────
function applySearchFilter(query) {
    if (!query) {
        $treeScroll.find('.tree-inverter').removeClass('hidden');
        $treeScroll.find('.string-item').removeClass('hidden');
        return;
    }

    var needsRebuild = false;
    var invNames = Object.keys(state.inverters);
// #region agent log
fetch('http://127.0.0.1:7547/ingest/660c1afd-940d-426c-b3ee-f6293d21001c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d9fe57'},body:JSON.stringify({sessionId:'d9fe57',location:'.js:applySearchFilter',message:'H2 search across all inverters',data:{query:query,invCount:invNames.length,invNames:invNames},timestamp:Date.now(),hypothesisId:'H2'})}).catch(function(){});
// #endregion

    for (var i = 0; i < invNames.length; i++) {
        var invName = invNames[i];
        var inv = state.inverters[invName];
        var invLower = invName.toLowerCase();
        var invMatches = invLower.indexOf(query) !== -1;

        if (invMatches) continue;

        var keys = Object.keys(inv.strings);
        for (var j = 0; j < keys.length; j++) {
            var keyLower = keys[j].toLowerCase();
            var displayLower = keys[j].replace(/_c$/i, '').toUpperCase().toLowerCase();
            if (keyLower.indexOf(query) !== -1 || displayLower.indexOf(query) !== -1) {
                if (!inv.expanded) {
                    inv.expanded = true;
                    needsRebuild = true;
                }
                break;
            }
        }
    }

    if (needsRebuild) {
        buildTree();
        return;
    }

    $treeScroll.find('.tree-inverter').each(function () {
        var $inv = $(this);
        var invName = ($inv.attr('data-inverter') || '').toLowerCase();
        var invMatches = invName.indexOf(query) !== -1;

        if (invMatches) {
            $inv.removeClass('hidden');
            $inv.find('.string-item').removeClass('hidden');
            return;
        }

        var anyStringMatch = false;
        $inv.find('.string-item').each(function () {
            var keyName = ($(this).attr('data-key') || '').toLowerCase();
            var displayName = $(this).find('.string-name').text().toLowerCase();
            if (keyName.indexOf(query) !== -1 || displayName.indexOf(query) !== -1) {
                $(this).removeClass('hidden');
                anyStringMatch = true;
            } else {
                $(this).addClass('hidden');
            }
        });

        if (anyStringMatch) {
            $inv.removeClass('hidden');
        } else {
            $inv.addClass('hidden');
        }
    });
}

// ──────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────
function formatTimeLabel(ts) {
    var d = new Date(ts);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var dd = String(d.getDate()).padStart(2, '0');
    var mon = months[d.getMonth()];
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return dd + ' ' + mon + ' ' + hh + ':' + mm;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return escapeHtml(str);
}

// ──────────────────────────────────────────────────────
//  Lifecycle: Data Updated
// ──────────────────────────────────────────────────────
self.onDataUpdated = function () {
    if (!self.ctx.data || self.ctx.data.length === 0) return;

    var structureChanged = false;
    var knownTotal = state.totalCount;

    // Recount matching keys to detect structure changes
    var matchCount = 0;
    for (var i = 0; i < self.ctx.data.length; i++) {
        if (self.ctx.data[i].dataKey && keyPattern.test(self.ctx.data[i].dataKey.name)) {
            matchCount++;
        }
    }

    if (matchCount !== knownTotal) {
        structureChanged = true;
    }

    if (structureChanged) {
        parseDataSources();
        buildTree();
    }

    updateChart();

    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
};

// ──────────────────────────────────────────────────────
//  Lifecycle: Resize — em-budget algorithm
// ──────────────────────────────────────────────────────
self.onResize = function () {
    var w = $el.width();
    var h = $el.height();
    if (!w || !h) return;

    // Vertical budget: header(1.8em) + content(~16em) ≈ 18em
    var fromHeight = (h - 4) / 18;

    // Horizontal budget: sidebar(~12em) + chart(~38em) ≈ 50em
    var fromWidth = w / 50;

    var fontSize = Math.min(fromHeight, fromWidth);
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 20) fontSize = 20;

    $card.css('font-size', fontSize + 'px');

    if (chart) {
        chart.resize();
    }
};

// ──────────────────────────────────────────────────────
//  Lifecycle: Destroy
// ──────────────────────────────────────────────────────
self.onDestroy = function () {
    if (chart) {
        chart.dispose();
        chart = null;
    }
    if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
    }
    $treeScroll.off('click change');
    $toggleAllBtn.off('click');
    $sidebarToggle.off('click');
    $searchInput.off('input');
};