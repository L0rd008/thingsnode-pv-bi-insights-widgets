/* ════════════════════════════════════════════════════
   Capacity Factor Compliance — ThingsBoard v4.3.0 PE
   Dynamic scaling | 3-section layout
   ════════════════════════════════════════════════════ */

   var $el, s;
   var $title, $statusDot, $statusText;
   var $gaugeVal, $targetPill, $gaugeFill, $needle;
   var $riskBanner, $riskDot, $riskText;
   var $barVal, $barFill, $perfTitle;
   var $tooltip;
   
   /* ────────── LIFECYCLE: INIT ────────── */
   self.onInit = function () {
       s = self.ctx.settings || {};
       $el = self.ctx.$container;
   
       /* ── cache DOM ── */
       $title = $el.find('.js-title');
       $statusDot = $el.find('.js-status-dot');
       $statusText = $el.find('.js-status-text');
       $gaugeVal = $el.find('.js-gauge-val');
       $targetPill = $el.find('.js-target-pill');
       $gaugeFill = $el.find('.js-gauge-fill');
       $needle = $el.find('.js-needle');
       $riskBanner = $el.find('.js-risk-banner');
       $riskDot = $el.find('.js-risk-dot');
       $riskText = $el.find('.js-risk-text');
       $barVal = $el.find('.js-bar-val');
       $barFill = $el.find('.js-bar-fill');
       $perfTitle = $el.find('.js-perf-title');
       $tooltip = $el.find('.js-tooltip');
   
       /* ── SVG gradient with unique ID ── */
       try {
           var svgNS = 'http://www.w3.org/2000/svg';
           var svgEl = $el.find('.js-gauge-svg')[0];
           if (svgEl) {
               var gId = 'cfG_' + Math.random().toString(36).substr(2, 8);
               var defs = document.createElementNS(svgNS, 'defs');
               var grad = document.createElementNS(svgNS, 'linearGradient');
               grad.setAttribute('id', gId);
               grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
               grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
               [
                   { o: '0%', c: '#FF5252' },
                   { o: '50%', c: '#FFC107' },
                   { o: '100%', c: '#66BB6A' }
               ].forEach(function (st) {
                   var stop = document.createElementNS(svgNS, 'stop');
                   stop.setAttribute('offset', st.o);
                   stop.setAttribute('stop-color', st.c);
                   grad.appendChild(stop);
               });
               defs.appendChild(grad);
               svgEl.insertBefore(defs, svgEl.firstChild);
               $gaugeFill.attr('stroke', 'url(#' + gId + ')');
           }
       } catch (e) { console.warn('CF gauge gradient init:', e); }
   
       updateDom();
       self.onResize();
       self.onDataUpdated();
   };
   
   /* ────────── DOM SETUP ────────── */
   function updateDom() {
       $title.text(s.cardTitle || 'CAPACITY FACTOR COMPLIANCE');
       $perfTitle.text(s.complianceLabel || 'CONTRACTUAL PERFORMANCE');
   
       var accent = s.accentColor;
       if (accent) {
           $el.find('.cf-card').css({
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
   
           /* ── 1. Extract values ── */
           var targetCF = null;
           var actualCF = null;
           var dec = s.decimals != null ? parseInt(s.decimals) : 1;
   
           if (data && data.length > 0) {
               for (var i = 0; i < data.length; i++) {
                   if (!data[i].data || data[i].data.length === 0) continue;
                   var key = data[i].dataKey ? data[i].dataKey.name : '';
                   var val = parseFloat(data[i].data[data[i].data.length - 1][1]);
                   if (isNaN(val)) continue;
   
                   if (key === 'contract_cf_target' || key === 'target_cf') targetCF = val;
                   if (key === 'actual_cf_ytd' || key === 'fin_cf' || key === 'actual_cf' || key === 'capacity_factor') actualCF = val;
               }
           }
   
           /* ── Placeholder if no data ── */
           if (targetCF === null && actualCF === null) {
               showPlaceholders();
               return;
           }
   
           /* ── Defaults & Normalization ── */
           if (targetCF === null) targetCF = 0.20;
           if (actualCF === null) actualCF = 0;
   
           // Auto-detect if data is 0.17 or 17.0
           var isRatio = targetCF < 1.05; 
           var targetPct = isRatio ? targetCF * 100 : targetCF;
           var actualPct = isRatio ? actualCF * 100 : actualCF;
   
           /* ── 2. Calculations ── */
           var complianceRatio = targetPct > 0 ? (actualPct / targetPct) * 100 : 0;
           var ratio = targetPct > 0 ? actualPct / targetPct : 0;
   
           /* ── Risk logic ── */
           var highThr = s.highRiskThreshold || 0.90;
           var medThr = s.medRiskThreshold || 1.0;
   
           var riskLevel = 'low';
           var riskLabel = 'COMPLIANT';
   
           // Logic: Low Risk = Good (Green)
           if (ratio < highThr) {
               riskLevel = 'high';
               riskLabel = 'PENALTY RISK — HIGH';
           } else if (ratio < medThr) {
               riskLevel = 'medium';
               riskLabel = 'PENALTY RISK — MARGINAL';
           }
   
           // Determine CSS Variable for colors
           var colorVar = riskLevel === 'low' ? 'var(--c-good)' : 
                          riskLevel === 'medium' ? 'var(--c-warning)' : 'var(--c-critical)';
   
           /* ── 3. DOM updates ── */
   
           // Values
           $gaugeVal.text(actualPct.toFixed(dec) + '%').removeClass('skeleton');
           $targetPill.text('TARGET: ' + targetPct.toFixed(dec) + '%');
   
           // Gauge Arc (Math based on 100% max unless overridden)
           // Fixed: If no gaugeMax provided, default to 100% (logic fix)
           var gaugeMax = parseFloat(s.gaugeMax) || 100; 
           var maxArc = 251; // PI * 80
           var fillPct = Math.min(actualPct / gaugeMax, 1);
           var dashArr = (fillPct * maxArc).toFixed(1) + ', ' + maxArc;
           
           $gaugeFill.attr('stroke-dasharray', dashArr);
           $gaugeFill.css('stroke', colorVar); // Fixed: Dynamic Color applied to stroke
   
           // Needle
           var deg = (fillPct * 180) - 90;
           $needle.css('transform', 'rotate(' + deg + 'deg)');
   
           // Risk Banner
           $riskBanner.removeClass('low medium high').addClass(riskLevel);
           $riskText.text(riskLabel);
   
           /* ── Performance Bars (Fixed Baseline Logic) ── */
           // We set the Target Bar to a fixed visual height (e.g., 60%)
           // The Actual Bar is calculated relative to that.
           var targetVisualHeight = 60; 
           
           // Calculate actual height relative to target height
           // If Actual is 100% of Target, it equals 60%. 
           // If Actual is 50% of Target, it equals 30%.
           var actualVisualHeight = (actualPct / targetPct) * targetVisualHeight;
   
           // Cap it at 100% so it doesn't overflow the container
           actualVisualHeight = Math.min(actualVisualHeight, 100);
   
           // Apply
           // Target bar is always fixed at the reference height
           $('.bar-target-fill').css('height', targetVisualHeight + '%');
           
           // Actual bar moves dynamically
           $barFill.css({
               'height': actualVisualHeight + '%',
               'background': 'linear-gradient(180deg, ' + colorVar + ' 0%, rgba(255,255,255,0.1) 100%)'
           });
           
           $barVal.text(complianceRatio.toFixed(dec) + '%');
   
           // Tooltip (Unchanged logic, just ensure it uses new vars if needed)
           if (!s.tooltipText) {
                var margin = actualPct - targetPct;
                var arrow = margin >= 0 ? '▲' : '▼';
                $tooltip.html(
                   'Actual: ' + actualPct.toFixed(dec) + '% <br>' +
                   'Target: ' + targetPct.toFixed(dec) + '% <br>' +
                   'Performance: ' + complianceRatio.toFixed(1) + '%'
                );
           }
   
       } catch (e) {
           console.error('CF onDataUpdated:', e);
           showPlaceholders();
       }
   };
   
   /* ────────── PLACEHOLDERS ────────── */
   function showPlaceholders() {
       $gaugeVal.text('--%').addClass('skeleton');
       $targetPill.text('TARGET: --%');
       $statusDot.removeClass('good warning critical');
       $statusText.text('--');
       $riskBanner.removeClass('low medium high');
       $riskText.text('AWAITING DATA');
       $barVal.text('--%');
       $barFill.css('height', '0%');
       $gaugeFill.attr('stroke-dasharray', '0, 251');
       $needle.css('transform', 'rotate(-90deg)');
       if (!s.tooltipText) {
           $tooltip.text('Compares actual Capacity Factor against the contractual PPA target to assess penalty risk.');
       }
   }
   
   /* ────────── LIFECYCLE: RESIZE ────────── */
   self.onResize = function () {
       var w = $el.width();
       var h = $el.height();
       if (!w || !h) return;
   
       // Em budget for the 3-section layout:
       //   header(0.75) + gauge(~4em) + risk-banner(~1em) + perf(~4em) + gaps(~0.8em) ≈ 10.5em
       var fromH = (h - 8) / 10.5;
   
       // Width: title(~10em at 0.58em) + status(~3em) + padding(~1em) ≈ 13em
       var fromW = w / 13;
   
       var fs = Math.min(fromH, fromW);
   
       // Clamp
       if (fs < 8) fs = 8;
       if (fs > 36) fs = 36;
   
       $el.find('.cf-card').css('font-size', fs + 'px');
   };
   
   /* ────────── LIFECYCLE: DESTROY ────────── */
   self.onDestroy = function () { };
   