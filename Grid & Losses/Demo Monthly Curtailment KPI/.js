self.onInit = function () {
    self.ctx.$widget = self.ctx.jQuery ? self.ctx.jQuery(self.ctx.$container) : $(self.ctx.$container);
    self.onResize();
    self.onDataUpdated();
};

self.onDataUpdated = function () {
    var $asset = self.ctx.$widget.find('.js-asset');
    var assetName = '--';
    if (self.ctx.datasources && self.ctx.datasources.length) {
        assetName = self.ctx.datasources[0].entityName || '--';
    }
    $asset.text(assetName);

    // Randomize the value slightly so it "looks" like it's responding to the asset change
    var baseVal = 1450;
    var randomJitter = Math.floor(Math.random() * 50) - 25; // +/- 25
    var val = baseVal + randomJitter;
    self.ctx.$widget.find('.js-kpi-value').text(val.toLocaleString());
};

self.onResize = function () {
    var $card = self.ctx.$widget.find('.energy-card.loss-demo');
    if (!$card.length) return;
    
    var w = $card.width();
    var h = $card.height();
    
    // Scale font size based on container dimensions
    var fromHeight = h / 2.8;
    var fromWidth = w / 4.5;
    var fontSize = Math.min(fromHeight, fromWidth);
    
    // Clamp limits
    if (fontSize < 10) fontSize = 10;
    if (fontSize > 100) fontSize = 100;
    
    $card.css('font-size', fontSize + 'px');
};
