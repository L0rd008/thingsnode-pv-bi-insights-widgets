self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    
    self.ctx.$widget.find('#table-title').text(
        self.ctx.settings.widgetTitle || 'Portfolio Performance Summary'
    );
    
    self.onResize();
    self.onDataUpdated();
};

function tbGet(url) {
    return new Promise(function(resolve, reject) {
        try {
            self.ctx.http.get(url).subscribe(function(resp) {
                resolve(resp && resp.data !== undefined ? resp.data : resp);
            }, reject);
        } catch(e) { reject(e); }
    });
}

function getRelations(entityId, entityType) {
    var url = '/api/relations?fromId=' + entityId + '&fromType=' + entityType + '&relationType=Contains';
    return tbGet(url).catch(function() { return []; });
}

function getAttributes(entityId, entityType, keys) {
    var url = '/api/plugins/telemetry/' + entityType + '/' + entityId + '/values/attributes/SERVER_SCOPE?keys=' + keys;
    return tbGet(url).catch(function() { return []; });
}

function getTimeseries(entityId, entityType, keys) {
    var now = Date.now();
    var start = now - (30 * 24 * 60 * 60 * 1000); // 30 days fallback
    var url = '/api/plugins/telemetry/' + entityType + '/' + entityId + '/values/timeseries?keys=' + keys + '&startTs=' + start + '&endTs=' + now + '&limit=1';
    return tbGet(url).catch(function() { return {}; });
}

self.onDataUpdated = function () {
    if (!self.ctx.datasources || self.ctx.datasources.length === 0) {
        return;
    }

    var rootEntities = [];
    self.ctx.datasources.forEach(function(ds) {
        if (ds.entityType && ds.entityId) {
            rootEntities.push({ id: ds.entityId, type: ds.entityType, name: ds.entityName || 'Unknown' });
        }
    });
    
    if (rootEntities.length === 0) return;

    var visited = {};
    var foundPlants = [];

    function traverse(entities, depth) {
        if (depth > 2 || entities.length === 0) {
            return Promise.resolve();
        }

        var promises = entities.map(function(entity) {
            var key = entity.type + '_' + entity.id;
            if (visited[key]) return Promise.resolve();
            visited[key] = true;

            return getAttributes(entity.id, entity.type, 'isPlant').then(function(attrs) {
                var isPlant = false;
                if (attrs && attrs.length) {
                    var val = attrs[0].value;
                    if (val === true || String(val).toLowerCase() === 'true') {
                        isPlant = true;
                    }
                }

                if (isPlant) {
                    foundPlants.push(entity);
                    return Promise.resolve(); // Stop traversal for this branch if it's already a plant
                }

                if (depth < 2) {
                    return getRelations(entity.id, entity.type).then(function(relations) {
                        var children = [];
                        (relations || []).forEach(function(rel) {
                            if (rel.to) {
                                children.push({ id: rel.to.id, type: rel.to.entityType, name: 'Unknown' });
                            }
                        });
                        return traverse(children, depth + 1);
                    });
                }
                return Promise.resolve();
            });
        });

        return Promise.all(promises);
    }

    traverse(rootEntities, 0).then(function() {
        if (foundPlants.length === 0) {
            renderTable([], false);
            return;
        }
        
        var dsKeys = [];
        if (self.ctx.datasources && self.ctx.datasources[0] && self.ctx.datasources[0].dataKeys) {
            self.ctx.datasources[0].dataKeys.forEach(function(dk) {
                dsKeys.push(dk.name);
            });
        }
        
        if (dsKeys.length < 3) {
            console.warn('Portfolio Summary: Please configure at least 3 data keys (Capacity, Active Power, Daily Gen).');
            return;
        }
        
        var capKey = dsKeys[0];
        var pwrKey = dsKeys[1];
        var genKey = dsKeys[2];
        var healthKey = dsKeys.length > 3 ? dsKeys[3] : null;
        
        var keysStr = dsKeys.join(',');

        var tsPromises = foundPlants.map(function(plant) {
            var entityPromise = new Promise(function(resolve) {
                if (plant.name !== 'Unknown') {
                    resolve();
                } else if (plant.type === 'ASSET') {
                    tbGet('/api/asset/' + plant.id).then(function(res) {
                        if (res && res.name) plant.name = res.name;
                        resolve();
                    });
                } else if (plant.type === 'DEVICE') {
                    tbGet('/api/device/' + plant.id).then(function(res) {
                        if (res && res.name) plant.name = res.name;
                        resolve();
                    });
                } else {
                    resolve();
                }
            });

            var tsPromise = getTimeseries(plant.id, plant.type, keysStr);
            var srvAttrPromise = tbGet('/api/plugins/telemetry/' + plant.type + '/' + plant.id + '/values/attributes/SERVER_SCOPE?keys=' + keysStr).catch(function() { return []; });
            var shdAttrPromise = tbGet('/api/plugins/telemetry/' + plant.type + '/' + plant.id + '/values/attributes/SHARED_SCOPE?keys=' + keysStr).catch(function() { return []; });
            
            return Promise.all([entityPromise, tsPromise, srvAttrPromise, shdAttrPromise]).then(function(results) {
                var ts = results[1] || {};
                var srvAttrs = results[2] || [];
                var shdAttrs = results[3] || [];
                var attrs = [].concat(srvAttrs).concat(shdAttrs);
                
                var site = { name: plant.name || 'Unknown' };
                var hasHealth = false;
                
                function getValue(key) {
                    if (ts[key] && ts[key].length) {
                        return ts[key][0].value;
                    }
                    for (var i = 0; i < attrs.length; i++) {
                        if (attrs[i].key === key) return attrs[i].value;
                    }
                    return null;
                }
                
                var capVal = getValue(capKey);
                if (capVal !== null) site.capacity = parseFloat(capVal) || 0;
                
                var pwrVal = getValue(pwrKey);
                if (pwrVal !== null) site.activePower = parseFloat(pwrVal) || 0;
                
                var genVal = getValue(genKey);
                if (genVal !== null) site.dailyGen = parseFloat(genVal) || 0;
                
                if (healthKey) {
                    var hVal = getValue(healthKey);
                    if (hVal !== null) {
                        site.health = hVal;
                        hasHealth = true;
                    }
                }
                
                return { site: site, hasHealth: hasHealth };
            });
        });
        
        Promise.all(tsPromises).then(function(results) {
            var siteList = [];
            var anyHealth = false;
            results.forEach(function(r) {
                if (r.hasHealth) anyHealth = true;
                siteList.push(r.site);
            });
            
            siteList.sort(function(a, b) { return a.name.localeCompare(b.name); });
            renderTable(siteList, anyHealth);
        });
    });
};

function renderTable(siteList, hasHealth) {
    var $el = self.ctx.$widget;
    
    // Render Header dynamically
    var $thead = $el.find('#compliance-head');
    $thead.empty();
    
    // Proportional widths
    var wName = hasHealth ? '25%' : '30%';
    var wCap = hasHealth ? '15%' : '20%';
    var wPwr = hasHealth ? '15%' : '25%';
    var wGen = hasHealth ? '20%' : '25%';
    var wHealth = hasHealth ? '25%' : '0%';

    var theadHtml = '<tr>' +
        '<th style="width: ' + wName + '">Plant Name</th>' +
        '<th class="col-center" style="width: ' + wCap + '">Capacity</th>' +
        '<th class="col-center" style="width: ' + wPwr + '">Active Power</th>' +
        '<th class="col-right" style="width: ' + wGen + '">Daily Gen</th>';
        
    if (hasHealth) {
        theadHtml += '<th class="col-center" style="width: ' + wHealth + '">Plant Health</th>';
    }
    theadHtml += '</tr>';
    $thead.append(theadHtml);

    // Render Body
    var $tbody = $el.find('#compliance-body');
    $tbody.empty();
    
    var totalCap = 0;
    var totalPwr = 0;
    var totalGen = 0;

    siteList.forEach(function (site) {
        var cap = site.capacity || 0;
        var pwr = site.activePower || 0;
        var gen = site.dailyGen || 0;
        
        totalCap += cap;
        totalPwr += pwr;
        totalGen += gen;

        var trHtml = '<tr>' +
            '<td class="text-bold">' + site.name + '</td>' +
            '<td class="col-center">' + cap.toFixed(2) + ' kW</td>' +
            '<td class="col-center">' + pwr.toFixed(2) + ' kW</td>' +
            '<td class="col-right">' + gen.toLocaleString(undefined, {maximumFractionDigits: 1}) + ' kWh</td>';
            
        if (hasHealth) {
            var hStr = site.health || 'Unknown';
            var hClass = 'text-warning';
            var hLower = hStr.toLowerCase();
            if (hLower.indexOf('good') !== -1 || hLower.indexOf('healthy') !== -1 || hLower.indexOf('normal') !== -1) {
                hClass = 'text-healthy';
            } else if (hLower.indexOf('critical') !== -1 || hLower.indexOf('offline') !== -1 || hLower.indexOf('fault') !== -1) {
                hClass = 'text-critical';
            }
            trHtml += '<td class="col-center ' + hClass + '">' + hStr + '</td>';
        }
        
        trHtml += '</tr>';
        $tbody.append(trHtml);
    });

    // Update Footer
    $el.find('#total-cap').text(totalCap.toFixed(2) + ' kW');
    $el.find('#total-pwr').text(totalPwr.toFixed(2) + ' kW');
    $el.find('#total-gen').text(totalGen.toLocaleString(undefined, {maximumFractionDigits: 1}) + ' kWh');

    if (self.ctx.detectChanges) {
        self.ctx.detectChanges();
    }
}

self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.compliance-card');
    if (!$card.length) return;
    
    var w = $el.width();
    var h = $el.height();

    // Em-budget based on standard proportions
    var fromWidth = w / 45;
    var fromHeight = h / 10;
    var fontSize = Math.min(fromWidth, fromHeight);

    if (fontSize < 7) fontSize = 7;
    if (fontSize > 24) fontSize = 24;

    $card.css('font-size', fontSize + 'px');
};
