/* Dark Mode Hierarchy Widget - JS tab
   Injects dark header + search into the built-in widget DOM
   and adds live search/filter + status coloring.
*/

var searchTimer = null;
var hwPanel = null;
var widgetRoot = null;
var filterExpanded = false;
var hwEntityDetailsCache = {};
var hwChildRelationsCache = {};
var hwEntityRoleCache = {};
var hwSelectionSeq = 0;
var ENTITY_ROLE_KEYS = ['isPlant', 'isPlantAgg'];

function hwStateLog(stage, payload) {
    if (typeof console === 'undefined' || !console.log) return;
    console.log('[HW-STATE] ' + stage, payload || {});
}

function hwStateWarn(stage, payload) {
    if (typeof console === 'undefined' || !console.warn) return;
    console.warn('[HW-STATE] ' + stage, payload || {});
}

function safeParseJson(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        hwStateWarn('state_param_parse_failed', {
            raw: value
        });
        return value;
    }
}

function normalizeEntityType(value) {
    return (value || '').toString().trim().toUpperCase();
}

function normalizeProfile(value) {
    return normalizeName(value || '').replace(/\s+/g, '');
}

function getTargetProfiles() {
    var settings = self.ctx.settings || {};
    var raw = settings.targetAssetProfiles || settings.targetPlantProfiles || 'SolarPlant';
    return raw.split(',').map(function(profile) {
        return normalizeProfile(profile);
    }).filter(Boolean);
}

function isPlantProfile(profileName) {
    var targets = getTargetProfiles();
    return targets.indexOf(normalizeProfile(profileName || '')) !== -1;
}

function getEntityProfile(entity) {
    if (!entity) return '';
    return entity.assetProfileName || entity.deviceProfileName || entity.type || '';
}

function normalizeBooleanFlag(value) {
    if (value === true || value === false) return value;
    if (value === null || value === undefined) return null;

    if (typeof value === 'number') {
        return value !== 0;
    }

    var normalized = value.toString().trim().toLowerCase();
    if (!normalized) return null;

    if (normalized === 'true' || normalized === '1' || normalized === 'yes' ||
        normalized === 'y' || normalized === 'on') {
        return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no' ||
        normalized === 'n' || normalized === 'off') {
        return false;
    }

    return null;
}

function normalizeAttributeMap(attributeData) {
    if (!attributeData) {
        return {};
    }

    if (Array.isArray(attributeData)) {
        return attributeData.reduce(function(acc, entry) {
            if (entry && entry.key !== undefined) {
                acc[entry.key] = entry.value;
            }
            return acc;
        }, {});
    }

    return attributeData;
}

function getAttributeValueCaseInsensitive(attributeMap, key) {
    if (!attributeMap) return undefined;

    if (Object.prototype.hasOwnProperty.call(attributeMap, key)) {
        return attributeMap[key];
    }

    var target = normalizeName(key);
    for (var attrKey in attributeMap) {
        if (!Object.prototype.hasOwnProperty.call(attributeMap, attrKey)) continue;
        if (normalizeName(attrKey) === target) {
            return attributeMap[attrKey];
        }
    }

    return undefined;
}

function hasAttributeValue(attributeMap, key) {
    var value = getAttributeValueCaseInsensitive(attributeMap, key);
    return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function getScopedAttributeUrl(entityType, entityId, scope, keys) {
    return '/api/plugins/telemetry/' + (normalizeEntityType(entityType) || 'ASSET') + '/' + entityId +
        '/values/attributes/' + scope + '?keys=' + encodeURIComponent((keys || []).join(','));
}

function fetchScopedEntityAttributes(entityRef, scope, keys) {
    if (!entityRef || !entityRef.id || !isSupportedTraversalEntityType(entityRef.entityType)) {
        return Promise.resolve({});
    }

    return tbGet(getScopedAttributeUrl(entityRef.entityType, entityRef.id, scope, keys)).then(function(resp) {
        return normalizeAttributeMap(resp);
    }).catch(function(error) {
        hwStateWarn('entity_role_scope_failed', {
            entity: summarizeEntityRef(entityRef),
            scope: scope,
            status: error && (error.status || error.statusCode || '')
        });
        return {};
    });
}

function resolveEntityRoleFlags(entityRef) {
    return fetchScopedEntityAttributes(entityRef, 'SERVER_SCOPE', ENTITY_ROLE_KEYS).then(function(serverAttrs) {
        var missingPlant = !hasAttributeValue(serverAttrs, 'isPlant');
        var missingPlantAgg = !hasAttributeValue(serverAttrs, 'isPlantAgg');

        if (!missingPlant && !missingPlantAgg) {
            return {
                serverAttrs: serverAttrs,
                sharedAttrs: {}
            };
        }

        return fetchScopedEntityAttributes(entityRef, 'SHARED_SCOPE', ENTITY_ROLE_KEYS).then(function(sharedAttrs) {
            return {
                serverAttrs: serverAttrs,
                sharedAttrs: sharedAttrs
            };
        });
    }).then(function(result) {
        var serverAttrs = result.serverAttrs || {};
        var sharedAttrs = result.sharedAttrs || {};
        var hasPlant = hasAttributeValue(serverAttrs, 'isPlant') || hasAttributeValue(sharedAttrs, 'isPlant');
        var hasPlantAgg = hasAttributeValue(serverAttrs, 'isPlantAgg') || hasAttributeValue(sharedAttrs, 'isPlantAgg');
        var rawPlant = hasAttributeValue(serverAttrs, 'isPlant')
            ? getAttributeValueCaseInsensitive(serverAttrs, 'isPlant')
            : getAttributeValueCaseInsensitive(sharedAttrs, 'isPlant');
        var rawPlantAgg = hasAttributeValue(serverAttrs, 'isPlantAgg')
            ? getAttributeValueCaseInsensitive(serverAttrs, 'isPlantAgg')
            : getAttributeValueCaseInsensitive(sharedAttrs, 'isPlantAgg');

        return {
            hasPlant: hasPlant,
            hasPlantAgg: hasPlantAgg,
            isPlant: hasPlant ? normalizeBooleanFlag(rawPlant) : null,
            isPlantAgg: hasPlantAgg ? normalizeBooleanFlag(rawPlantAgg) : null
        };
    });
}

function buildEntityRoleInfo(entity, resolvedFlags) {
    var legacyPlant = isPlantProfile(getEntityProfile(entity));
    var hasPlant = !!(resolvedFlags && resolvedFlags.hasPlant);
    var hasPlantAgg = !!(resolvedFlags && resolvedFlags.hasPlantAgg);
    var explicitPlant = hasPlant && resolvedFlags.isPlant === true;
    var explicitPlantAgg = hasPlantAgg && resolvedFlags.isPlantAgg === true;
    var roleInfo = {
        isPlant: false,
        isPlantAgg: false,
        classification: 'other',
        classificationSource: 'attributes_explicit_other',
        hasExplicitFlags: hasPlant || hasPlantAgg,
        hasPlantAttr: hasPlant,
        hasPlantAggAttr: hasPlantAgg,
        rawIsPlant: hasPlant ? resolvedFlags.isPlant : null,
        rawIsPlantAgg: hasPlantAgg ? resolvedFlags.isPlantAgg : null,
        legacyProfilePlant: legacyPlant
    };

    if (explicitPlantAgg && explicitPlant) {
        roleInfo.isPlantAgg = true;
        roleInfo.classification = 'aggregation';
        roleInfo.classificationSource = 'attributes_conflict_prefer_aggregation';
        return roleInfo;
    }

    if (explicitPlantAgg) {
        roleInfo.isPlantAgg = true;
        roleInfo.classification = 'aggregation';
        roleInfo.classificationSource = 'attributes';
        return roleInfo;
    }

    if (explicitPlant) {
        roleInfo.isPlant = true;
        roleInfo.classification = 'plant';
        roleInfo.classificationSource = 'attributes';
        return roleInfo;
    }

    if (!roleInfo.hasExplicitFlags) {
        roleInfo.isPlant = legacyPlant;
        roleInfo.classification = legacyPlant ? 'plant' : 'other';
        roleInfo.classificationSource = legacyPlant ? 'profile_fallback' : 'profile_fallback_non_plant';
        return roleInfo;
    }

    return roleInfo;
}

function getEntityRoleInfo(entity) {
    if (!entity) {
        return {
            isPlant: false,
            isPlantAgg: false,
            classification: 'other',
            classificationSource: 'missing_entity',
            hasExplicitFlags: false
        };
    }

    if (entity._hwRoleInfo) {
        return entity._hwRoleInfo;
    }

    return buildEntityRoleInfo(entity, null);
}

function summarizeRoleInfo(entity) {
    var roleInfo = getEntityRoleInfo(entity);
    return {
        isPlant: !!roleInfo.isPlant,
        isPlantAgg: !!roleInfo.isPlantAgg,
        classification: roleInfo.classification || 'other',
        classificationSource: roleInfo.classificationSource || '',
        hasExplicitFlags: !!roleInfo.hasExplicitFlags,
        rawIsPlant: roleInfo.rawIsPlant,
        rawIsPlantAgg: roleInfo.rawIsPlantAgg,
        legacyProfilePlant: !!roleInfo.legacyProfilePlant
    };
}

function ensureEntityRoleInfo(entity, entityRef) {
    if (!entity) {
        return Promise.resolve(null);
    }

    var resolvedRef = entityRef || getEntityRef(entity);
    var cacheKey = getVisitedKey(resolvedRef);

    if (entity._hwRoleInfo) {
        return Promise.resolve(entity);
    }

    if (cacheKey && hwEntityRoleCache[cacheKey]) {
        entity._hwRoleInfo = hwEntityRoleCache[cacheKey];
        return Promise.resolve(entity);
    }

    if (!resolvedRef || !resolvedRef.id || !isSupportedTraversalEntityType(resolvedRef.entityType)) {
        entity._hwRoleInfo = buildEntityRoleInfo(entity, null);
        return Promise.resolve(entity);
    }

    return resolveEntityRoleFlags(resolvedRef).then(function(flags) {
        var roleInfo = buildEntityRoleInfo(entity, flags);

        hwStateLog('entity_role_resolved', {
            entity: summarizeEntityRef(resolvedRef),
            name: entity.name || '',
            role: summarizeRoleInfo({
                _hwRoleInfo: roleInfo
            })
        });

        if (roleInfo.rawIsPlant && roleInfo.rawIsPlantAgg) {
            hwStateWarn('entity_role_conflict', {
                entity: summarizeEntityRef(resolvedRef),
                role: summarizeRoleInfo({
                    _hwRoleInfo: roleInfo
                })
            });
        }

        if ((roleInfo.classificationSource || '').indexOf('profile_fallback') === 0) {
            hwStateLog('entity_role_profile_fallback', {
                entity: summarizeEntityRef(resolvedRef),
                name: entity.name || '',
                role: summarizeRoleInfo({
                    _hwRoleInfo: roleInfo
                })
            });
        }

        entity._hwRoleInfo = roleInfo;
        hwEntityRoleCache[cacheKey] = roleInfo;
        return entity;
    }).catch(function(error) {
        entity._hwRoleInfo = buildEntityRoleInfo(entity, null);
        hwStateWarn('entity_role_fallback', {
            entity: summarizeEntityRef(resolvedRef),
            message: error && error.message ? error.message : '',
            role: summarizeRoleInfo(entity)
        });
        return entity;
    });
}

function isPlantAggregationEntity(entity) {
    return !!getEntityRoleInfo(entity).isPlantAgg;
}

function isPlantEntity(entity) {
    return !!getEntityRoleInfo(entity).isPlant;
}

function getEntityIdValue(entityId) {
    if (!entityId) return '';
    if (typeof entityId === 'string') return entityId;
    if (entityId.id) return entityId.id;
    return '';
}

function buildEntityRef(entityId, entityType) {
    var id = getEntityIdValue(entityId);
    if (!id) return null;

    return {
        id: id,
        entityType: normalizeEntityType(entityType)
    };
}

function getEntityRef(entity, fallbackType) {
    if (!entity) return null;

    if (entity.id && typeof entity.id === 'object') {
        return buildEntityRef(entity.id.id, entity.id.entityType || entity._entityType || fallbackType);
    }

    return buildEntityRef(entity.id || entity, entity.entityType || entity._entityType || fallbackType);
}

function getVisitedKey(entityRef) {
    if (!entityRef || !entityRef.id) return '';
    return (entityRef.entityType || 'UNKNOWN') + ':' + entityRef.id;
}

function summarizeEntityRef(entityRef) {
    if (!entityRef || !entityRef.id) return null;
    return {
        id: getEntityIdValue(entityRef.id).substring(0, 8),
        entityType: normalizeEntityType(entityRef.entityType) || 'UNKNOWN'
    };
}

function summarizeEntity(entity) {
    if (!entity) return null;
    var entityRef = getEntityRef(entity);
    var roleInfo = getEntityRoleInfo(entity);
    return {
        id: entityRef && entityRef.id ? entityRef.id.substring(0, 8) : '',
        entityType: entityRef ? entityRef.entityType : 'UNKNOWN',
        name: entity.name || '',
        label: entity.label || '',
        profile: getEntityProfile(entity),
        role: roleInfo.classification || 'other',
        roleSource: roleInfo.classificationSource || '',
        isPlant: !!roleInfo.isPlant,
        isPlantAgg: !!roleInfo.isPlantAgg
    };
}

function getStateParams() {
    try {
        return self.ctx.stateController &&
            typeof self.ctx.stateController.getStateParams === 'function'
            ? (self.ctx.stateController.getStateParams() || {})
            : {};
    } catch (e) {
        return {};
    }
}

function tbGet(url) {
    return new Promise(function(resolve, reject) {
        try {
            var request = self.ctx.http.get(url);

            if (request && typeof request.then === 'function') {
                request.then(function(resp) {
                    resolve(resp && resp.data !== undefined ? resp.data : resp);
                }, reject);
                return;
            }

            if (request && typeof request.subscribe === 'function') {
                request.subscribe(function(resp) {
                    resolve(resp && resp.data !== undefined ? resp.data : resp);
                }, reject);
                return;
            }

            reject(new Error('Unsupported HTTP response type'));
        } catch (e) {
            reject(e);
        }
    });
}

function getEntityUrl(entityType, entityId) {
    var normalizedType = normalizeEntityType(entityType);
    if (normalizedType === 'ASSET') {
        return '/api/asset/' + entityId;
    }
    if (normalizedType === 'DEVICE') {
        return '/api/device/' + entityId;
    }
    return '';
}

function isSupportedTraversalEntityType(entityType) {
    var normalizedType = normalizeEntityType(entityType);
    return normalizedType === 'ASSET' || normalizedType === 'DEVICE';
}

function fetchEntityDetails(entityRef) {
    if (!entityRef || !entityRef.id || !isSupportedTraversalEntityType(entityRef.entityType)) {
        return Promise.resolve(null);
    }

    var cacheKey = getVisitedKey(entityRef);
    if (hwEntityDetailsCache[cacheKey]) {
        return ensureEntityRoleInfo(hwEntityDetailsCache[cacheKey], entityRef);
    }

    var url = getEntityUrl(entityRef.entityType, entityRef.id);
    if (!url) {
        return Promise.resolve(null);
    }

    return tbGet(url).then(function(entity) {
        if (!entity) return null;
        entity._entityType = normalizeEntityType(entityRef.entityType);
        return ensureEntityRoleInfo(entity, entityRef).then(function(resolvedEntity) {
            hwEntityDetailsCache[cacheKey] = resolvedEntity;
            return resolvedEntity;
        });
    }).catch(function(error) {
        hwStateWarn('entity_fetch_failed', {
            entity: summarizeEntityRef(entityRef),
            status: error && (error.status || error.statusCode || '')
        });
        return null;
    });
}

function getRootHierarchyEntityRef() {
    if (!self.ctx.data || !self.ctx.data.length) return null;

    for (var i = 0; i < self.ctx.data.length; i++) {
        var dsData = self.ctx.data[i];
        var ds = dsData && dsData.datasource;
        var entityId = ds && ds.entityId;
        var entityType = ds && (ds.entityType || (entityId && entityId.entityType));
        var entityRef = buildEntityRef(entityId, entityType);
        if (entityRef) {
            return entityRef;
        }
    }

    return null;
}

function getTreeRowsHost() {
    if (!widgetRoot) return null;

    return widgetRoot.querySelector('tb-nav-tree') ||
        widgetRoot.querySelector('.tb-nav-tree-container') ||
        widgetRoot.querySelector('.tb-entities-nav-tree-panel') ||
        widgetRoot;
}

function compareDomOrder(a, b) {
    if (a === b) return 0;
    if (!a || !b || !a.compareDocumentPosition) return 0;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function isElementVisible(el) {
    if (!el) return false;

    try {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }
    } catch (e) {}

    return true;
}

function isSelectionTreeRow(row) {
    var treeHost = getTreeRowsHost();

    if (!row || row === widgetRoot) return false;
    if (!isNodeRowElement(row)) return false;
    if (row.closest && row.closest('.hw-panel')) return false;
    if (treeHost && treeHost !== widgetRoot && !treeHost.contains(row)) return false;

    return !!getNodeText(row);
}

function collectVisibleTreeRows(clickedRow) {
    var rows = [];
    var seen = [];
    var searchRoots = [];
    var searchSelectors = [
        '[role="treeitem"]',
        'mat-nested-tree-node',
        'mat-tree-node',
        '.mat-nested-tree-node',
        '.mat-tree-node',
        '.mat-mdc-tree-node',
        '[class*="tree-node"]',
        '[class*="node-container"]'
    ];

    function pushRow(row) {
        if (!row || seen.indexOf(row) !== -1) return;
        if (!isSelectionTreeRow(row)) return;
        seen.push(row);
        rows.push(row);
    }

    function scanRoot(root, exhaustive) {
        if (!root) return;

        var selectorResults = [];
        var i;
        var j;

        for (i = 0; i < searchSelectors.length; i++) {
            try {
                var found = root.querySelectorAll(searchSelectors[i]);
                for (j = 0; j < found.length; j++) {
                    selectorResults.push(found[j]);
                }
            } catch (e) {}
        }

        if (!selectorResults.length && exhaustive) {
            selectorResults = root.querySelectorAll('*');
        }

        for (i = 0; i < selectorResults.length; i++) {
            pushRow(getPreferredTreeRow(selectorResults[i]) || findClickableRow(selectorResults[i]) || selectorResults[i]);
        }
    }

    if (clickedRow) {
        pushRow(clickedRow);
    }

    searchRoots.push(getTreeRowsHost());
    if (widgetRoot && searchRoots.indexOf(widgetRoot) === -1) {
        searchRoots.push(widgetRoot);
    }

    scanRoot(searchRoots[0], false);

    if (rows.length < 2) {
        for (var rootIndex = 0; rootIndex < searchRoots.length; rootIndex++) {
            scanRoot(searchRoots[rootIndex], true);
        }
    }

    rows = rows.filter(isElementVisible);
    rows.sort(compareDomOrder);
    return rows;
}

function getRowAriaLevel(row) {
    var current = row;
    var level;

    while (current && current !== widgetRoot) {
        level = parseInt(current.getAttribute('aria-level'), 10);
        if (!isNaN(level)) {
            return level;
        }
        current = current.parentElement;
    }

    return null;
}

function getStylePixels(el, propertyName) {
    if (!el) return null;

    try {
        var value = parseFloat(window.getComputedStyle(el)[propertyName]);
        return isNaN(value) ? null : value;
    } catch (e) {
        return null;
    }
}

function addIndentMetric(metrics, label, value) {
    if (value === null || value === undefined || isNaN(value) || value < 0) {
        return;
    }

    metrics.push({
        label: label,
        value: value
    });
}

function getRowIndentScore(row) {
    var metrics = [];
    var treeHost = getTreeRowsHost() || widgetRoot;
    var treeLeft = 0;
    var textInfo = getNodeTextInfo(row);

    try {
        treeLeft = treeHost ? treeHost.getBoundingClientRect().left : 0;
    } catch (e) {}

    addIndentMetric(metrics, 'row-padding-left', getStylePixels(row, 'paddingLeft'));
    addIndentMetric(metrics, 'row-margin-left', getStylePixels(row, 'marginLeft'));

    if (row && row.firstElementChild) {
        addIndentMetric(metrics, 'child-padding-left', getStylePixels(row.firstElementChild, 'paddingLeft'));
        addIndentMetric(metrics, 'child-margin-left', getStylePixels(row.firstElementChild, 'marginLeft'));
    }

    try {
        addIndentMetric(metrics, 'row-left', row.getBoundingClientRect().left - treeLeft);
    } catch (e) {}

    if (textInfo && textInfo.element) {
        addIndentMetric(metrics, 'text-padding-left', getStylePixels(textInfo.element, 'paddingLeft'));
        addIndentMetric(metrics, 'text-margin-left', getStylePixels(textInfo.element, 'marginLeft'));
        try {
            addIndentMetric(metrics, 'text-left', textInfo.element.getBoundingClientRect().left - treeLeft);
        } catch (e) {}
    }

    if (!metrics.length) {
        return 0;
    }

    metrics.sort(function(a, b) {
        return b.value - a.value;
    });

    return metrics[0].value;
}

function assignRowLevels(descriptors) {
    var indentValues = [];
    var clusters = [];
    var knownByIndent = [];
    var i;

    descriptors.forEach(function(descriptor) {
        descriptor.level = null;
        descriptor.levelSource = '';

        if (descriptor.ariaLevel !== null && descriptor.ariaLevel !== undefined) {
            descriptor.level = Math.max(0, descriptor.ariaLevel - 1);
            descriptor.levelSource = 'aria-level';
            knownByIndent.push(descriptor);
        }

        if (!isNaN(descriptor.indentScore)) {
            indentValues.push(descriptor.indentScore);
        }
    });

    if (!indentValues.length) {
        descriptors.forEach(function(descriptor) {
            if (descriptor.level === null) {
                descriptor.level = 0;
                descriptor.levelSource = 'fallback';
            }
        });
        return descriptors;
    }

    indentValues.sort(function(a, b) {
        return a - b;
    });

    indentValues.forEach(function(value) {
        var lastCluster = clusters.length ? clusters[clusters.length - 1] : null;
        if (!lastCluster || Math.abs(value - lastCluster.max) > 8) {
            clusters.push({
                min: value,
                max: value
            });
            return;
        }

        lastCluster.max = value;
    });

    descriptors.forEach(function(descriptor) {
        var bestIndex = 0;
        var bestDistance = Infinity;

        if (descriptor.level !== null) {
            return;
        }

        if (knownByIndent.length) {
            knownByIndent.forEach(function(knownDescriptor) {
                var distance = Math.abs(descriptor.indentScore - knownDescriptor.indentScore);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = knownDescriptor.level;
                }
            });
            descriptor.level = bestIndex;
            descriptor.levelSource = 'indent-nearest';
            return;
        }

        clusters.forEach(function(cluster, clusterIndex) {
            var center = (cluster.min + cluster.max) / 2;
            var distance = Math.abs(descriptor.indentScore - center);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = clusterIndex;
            }
        });

        descriptor.level = bestIndex;
        descriptor.levelSource = 'indent-cluster';
    });

    return descriptors;
}

function rowHasVisibleChildren(descriptors, index) {
    var current = descriptors[index];
    var i;

    if (!current) return false;

    for (i = index + 1; i < descriptors.length; i++) {
        if (descriptors[i].level <= current.level) {
            return false;
        }

        if (descriptors[i].level > current.level) {
            return true;
        }
    }

    return false;
}

function rowLooksExpandable(row, hasVisibleChildren) {
    if (hasVisibleChildren) return true;
    if (!row || !row.querySelectorAll) return false;

    var buttons = row.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
        var button = buttons[i];
        var icon = button.querySelector('mat-icon, .mat-icon, [class*="mat-icon"]');
        var iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
        var ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        var ariaExpanded = button.getAttribute('aria-expanded');

        if (ariaExpanded === 'true' || ariaExpanded === 'false') {
            return true;
        }

        if (iconText === 'chevron_right' || iconText === 'expand_more' ||
            iconText === 'keyboard_arrow_right' || iconText === 'keyboard_arrow_down' ||
            iconText === 'arrow_right' || iconText === 'arrow_drop_down' ||
            ariaLabel.indexOf('expand') !== -1 || ariaLabel.indexOf('collapse') !== -1) {
            return true;
        }
    }

    return false;
}

function summarizeBreadcrumbSegment(segment) {
    if (!segment) return null;

    return {
        name: segment.name,
        level: segment.level,
        levelSource: segment.levelSource,
        indentScore: Math.round(segment.indentScore || 0),
        expandable: !!segment.expandable,
        hasVisibleChildren: !!segment.hasVisibleChildren
    };
}

function getNodeBreadcrumb(nodeEl) {
    var clickedRow = getPreferredTreeRow(nodeEl) || findClickableRow(nodeEl) || nodeEl;
    var rows = collectVisibleTreeRows(clickedRow);
    var descriptors = [];
    var clickedIndex = -1;
    var currentLevel;
    var breadcrumb = [];
    var i;

    if (!rows.length && clickedRow) {
        rows = [clickedRow];
    }

    descriptors = rows.map(function(row, index) {
        return {
            row: row,
            rowIndex: index,
            name: getNodeText(row),
            ariaLevel: getRowAriaLevel(row),
            indentScore: getRowIndentScore(row)
        };
    }).filter(function(descriptor) {
        return !!descriptor.name;
    });

    assignRowLevels(descriptors);

    descriptors.forEach(function(descriptor, index) {
        descriptor.rowIndex = index;
        descriptor.hasVisibleChildren = rowHasVisibleChildren(descriptors, index);
        descriptor.expandable = rowLooksExpandable(descriptor.row, descriptor.hasVisibleChildren);
    });

    for (i = 0; i < descriptors.length; i++) {
        if (descriptors[i].row === clickedRow) {
            clickedIndex = i;
            break;
        }
    }

    if (clickedIndex === -1 && clickedRow) {
        descriptors.push({
            row: clickedRow,
            rowIndex: descriptors.length,
            name: getNodeText(clickedRow),
            ariaLevel: getRowAriaLevel(clickedRow),
            indentScore: getRowIndentScore(clickedRow),
            level: 0,
            levelSource: 'fallback',
            hasVisibleChildren: false,
            expandable: rowLooksExpandable(clickedRow, false)
        });
        clickedIndex = descriptors.length - 1;
    }

    if (clickedIndex === -1) {
        return [];
    }

    currentLevel = descriptors[clickedIndex].level;
    breadcrumb.unshift(descriptors[clickedIndex]);

    for (i = clickedIndex - 1; i >= 0; i--) {
        if (descriptors[i].level < currentLevel) {
            breadcrumb.unshift(descriptors[i]);
            currentLevel = descriptors[i].level;
        }

        if (currentLevel === 0) {
            break;
        }
    }

    return breadcrumb;
}

function getNodePathNames(nodeEl) {
    return getNodeBreadcrumb(nodeEl).map(function(segment) {
        return segment.name;
    }).filter(Boolean);
}

function getRelationEntityRef(side) {
    if (!side) return null;
    return buildEntityRef(side.id || side, side.entityType);
}

function getChildEntityRefs(parentEntityRef) {
    if (!parentEntityRef || !parentEntityRef.id) {
        return Promise.resolve([]);
    }

    var cacheKey = getVisitedKey(parentEntityRef);
    if (hwChildRelationsCache[cacheKey]) {
        return Promise.resolve(hwChildRelationsCache[cacheKey]);
    }

    var url = '/api/relations?fromId=' + parentEntityRef.id +
        '&fromType=' + encodeURIComponent(normalizeEntityType(parentEntityRef.entityType) || 'ASSET') +
        '&relationType=Contains';

    return tbGet(url).then(function(relations) {
        var childRefs = [];
        var seen = {};

        (relations || []).forEach(function(relation) {
            var childRef = getRelationEntityRef(relation && relation.to);
            var childKey = getVisitedKey(childRef);
            if (!childRef || !isSupportedTraversalEntityType(childRef.entityType) || seen[childKey]) {
                return;
            }
            seen[childKey] = true;
            childRefs.push(childRef);
        });

        hwChildRelationsCache[cacheKey] = childRefs;
        return childRefs;
    }).catch(function(error) {
        hwStateWarn('child_relations_failed', {
            parent: summarizeEntityRef(parentEntityRef),
            status: error && (error.status || error.statusCode || '')
        });
        return [];
    });
}

function entityMatchesNodeName(entity, nodeName) {
    var normalizedNodeName = normalizeName(nodeName);
    if (!normalizedNodeName) return false;

    var candidates = [
        entity && entity.name,
        entity && entity.label,
        entity && entity.title
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (normalizeName(candidates[i]) === normalizedNodeName) {
            return true;
        }
    }

    return false;
}

function uniqueEntities(entities) {
    var seen = {};
    var unique = [];

    (entities || []).forEach(function(entity) {
        var key = getVisitedKey(getEntityRef(entity));
        if (!key || seen[key]) {
            return;
        }
        seen[key] = true;
        unique.push(entity);
    });

    return unique;
}

function uniqueResolutionStates(states) {
    var seen = {};
    var unique = [];

    (states || []).forEach(function(state) {
        var key = (state.path || []).map(function(entity) {
            return getVisitedKey(getEntityRef(entity));
        }).join('>');

        if (!key || seen[key]) {
            return;
        }

        seen[key] = true;
        unique.push(state);
    });

    return unique;
}

function getEntityChildren(parentEntity) {
    var parentRef = getEntityRef(parentEntity);

    if (!parentRef) {
        return Promise.resolve([]);
    }

    return getChildEntityRefs(parentRef).then(function(childRefs) {
        return Promise.all(childRefs.map(function(childRef) {
            return fetchEntityDetails(childRef);
        })).then(function(childEntities) {
            return uniqueEntities(childEntities.filter(Boolean));
        });
    });
}

function summarizeBranchScopeFact(fact) {
    if (!fact) return null;

    return {
        entity: summarizeEntity(fact.entity),
        isPlant: !!fact.isPlant,
        isPlantAgg: !!fact.isPlantAgg,
        isSelectedEntity: !!fact.isSelectedEntity,
        deepestPlantIndex: typeof fact.deepestPlantIndex === 'number' ? fact.deepestPlantIndex : -1,
        plantIndex: typeof fact.plantIndex === 'number' ? fact.plantIndex : -1,
        isDeepestPlant: !!fact.isDeepestPlant,
        scopeReason: fact.scopeReason || '',
        roleSource: fact.roleSource || '',
        classification: fact.classification || '',
        segment: summarizeBreadcrumbSegment(fact.segment)
    };
}

function determineBranchScopeRoot(resolvedPath, breadcrumb, selectedEntity) {
    breadcrumb = breadcrumb || [];

    if (!resolvedPath || !resolvedPath.length) {
        return Promise.resolve(null);
    }

    var pathOffset = resolvedPath.length - breadcrumb.length;

    return Promise.all(resolvedPath.map(function(entity, index) {
        return ensureEntityRoleInfo(entity, getEntityRef(entity)).then(function(resolvedEntity) {
            var segmentIndex = index - pathOffset;
            var roleInfo = getEntityRoleInfo(resolvedEntity);
            return {
                entity: resolvedEntity,
                index: index,
                segment: segmentIndex >= 0 && segmentIndex < breadcrumb.length
                    ? breadcrumb[segmentIndex]
                    : null,
                isPlant: !!roleInfo.isPlant,
                isPlantAgg: !!roleInfo.isPlantAgg,
                classification: roleInfo.classification || 'other',
                roleSource: roleInfo.classificationSource || '',
                isSelectedEntity: index === resolvedPath.length - 1,
                plantIndex: index
            };
        });
    })).then(function(scopeFacts) {
        var selectedFact = null;
        var selectedRef = getEntityRef(selectedEntity);
        var branchScopeFact = null;
        var deepestPlantIndex = -1;
        var deepestPlantFact = deepestPlantIndex >= 0 ? scopeFacts[deepestPlantIndex] : null;

        function findNearestAggregationAbove(startIndex) {
            for (var i = startIndex - 1; i >= 0; i--) {
                if (scopeFacts[i].isPlantAgg) {
                    return scopeFacts[i];
                }
            }
            return null;
        }

        scopeFacts.forEach(function(fact, index) {
            fact.deepestPlantIndex = -1;
            fact.isDeepestPlant = false;
            if (fact.isPlant) {
                deepestPlantIndex = index;
            }
        });

        deepestPlantFact = deepestPlantIndex >= 0 ? scopeFacts[deepestPlantIndex] : null;

        scopeFacts.forEach(function(fact) {
            if (!selectedRef) return;
            if (getVisitedKey(getEntityRef(fact.entity)) === getVisitedKey(selectedRef)) {
                selectedFact = fact;
            }
            fact.deepestPlantIndex = deepestPlantIndex;
            fact.isDeepestPlant = deepestPlantIndex === fact.index;
        });

        hwStateLog('branch_scope_evaluated', {
            selectedEntity: summarizeEntity(selectedEntity),
            selectedRole: summarizeRoleInfo(selectedEntity),
            resolvedPath: scopeFacts.map(summarizeBranchScopeFact)
        });

        if (selectedFact && selectedFact.isPlantAgg) {
            branchScopeFact = selectedFact;
            branchScopeFact.scopeReason = 'selected_plant_aggregation';
        }

        if (!branchScopeFact && selectedFact && selectedFact.isPlant) {
            branchScopeFact = findNearestAggregationAbove(selectedFact.index);
            if (branchScopeFact) {
                branchScopeFact.scopeReason = 'nearest_plant_aggregation_above_selected_plant';
            }
        }

        if (!branchScopeFact && selectedFact && selectedFact.isPlant) {
            branchScopeFact = selectedFact;
            branchScopeFact.scopeReason = 'fallback_selected_plant';
            hwStateWarn('branch_scope_missing_aggregation_ancestor', {
                selectedEntity: summarizeEntity(selectedEntity),
                deepestPlant: summarizeEntity(selectedFact.entity),
                resolvedPath: scopeFacts.map(summarizeBranchScopeFact)
            });
        }

        if (!branchScopeFact && deepestPlantFact) {
            branchScopeFact = findNearestAggregationAbove(deepestPlantIndex);
            if (branchScopeFact) {
                branchScopeFact.scopeReason = 'nearest_plant_aggregation_above_deepest_plant';
            }
        }

        if (!branchScopeFact && deepestPlantFact) {
            branchScopeFact = deepestPlantFact;
            branchScopeFact.scopeReason = 'fallback_deepest_plant';
            hwStateWarn('branch_scope_fallback_to_plant', {
                selectedEntity: summarizeEntity(selectedEntity),
                deepestPlant: summarizeEntity(deepestPlantFact.entity),
                resolvedPath: scopeFacts.map(summarizeBranchScopeFact)
            });
        }

        if (!branchScopeFact && selectedFact) {
            branchScopeFact = selectedFact;
            branchScopeFact.scopeReason = 'selected_container';
        }

        if (!branchScopeFact) {
            return null;
        }

        hwStateLog('branch_scope_selected', {
            selectedEntity: summarizeEntity(selectedEntity),
            selectedRole: summarizeRoleInfo(selectedEntity),
            scopeRoot: summarizeEntity(branchScopeFact && branchScopeFact.entity),
            scopeRootIsPlant: !!(branchScopeFact && branchScopeFact.isPlant),
            scopeRootIsPlantAgg: !!(branchScopeFact && branchScopeFact.isPlantAgg),
            scopeRootReason: branchScopeFact && branchScopeFact.scopeReason ? branchScopeFact.scopeReason : '',
            deepestPlant: summarizeEntity(deepestPlantFact && deepestPlantFact.entity)
        });

        return branchScopeFact;
    });
}

function filterCandidateEntities(candidates, segment, nextSegment, context) {
    if (!candidates || candidates.length <= 1) {
        return Promise.resolve(candidates || []);
    }

    return Promise.all(candidates.map(function(candidate) {
        return getEntityChildren(candidate).then(function(children) {
            return {
                entity: candidate,
                children: children,
                childCount: children.length,
                hasChildren: children.length > 0,
                matchesNextSegment: !!(nextSegment && nextSegment.name && children.some(function(child) {
                    return entityMatchesNodeName(child, nextSegment.name);
                })),
                isPlant: isPlantEntity(candidate),
                isPlantAgg: isPlantAggregationEntity(candidate),
                roleSource: getEntityRoleInfo(candidate).classificationSource || ''
            };
        });
    })).then(function(candidateFacts) {
        var filteredFacts = candidateFacts.slice();
        var matchedNextSegment;

        if (nextSegment && nextSegment.name) {
            matchedNextSegment = filteredFacts.filter(function(fact) {
                return fact.matchesNextSegment;
            });

            if (matchedNextSegment.length) {
                filteredFacts = matchedNextSegment;
            }
        }

        hwStateLog('selection_candidates_filtered', {
            segment: summarizeBreadcrumbSegment(segment),
            parent: summarizeEntity(context && context.parentEntity),
            nextSegment: summarizeBreadcrumbSegment(nextSegment),
            remaining: filteredFacts.map(function(fact) {
                return {
                    entity: summarizeEntity(fact.entity),
                    childCount: fact.childCount,
                    isPlant: fact.isPlant,
                    isPlantAgg: fact.isPlantAgg,
                    roleSource: fact.roleSource,
                    matchesNextSegment: fact.matchesNextSegment
                };
            })
        });

        return filteredFacts.map(function(fact) {
            return fact.entity;
        });
    });
}

function resolveChildEntityByName(parentEntity, segment, nextSegment, context) {
    var childName = segment && segment.name ? segment.name : segment;

    if (!parentEntity || !childName) {
        return Promise.resolve([]);
    }

    return getEntityChildren(parentEntity).then(function(childEntities) {
        var exactMatches = childEntities.filter(function(childEntity) {
            return entityMatchesNodeName(childEntity, childName);
        });

        if (!exactMatches.length) {
            hwStateWarn('child_resolution_failed', {
                parent: summarizeEntity(parentEntity),
                childName: childName,
                availableChildren: childEntities.slice(0, 8).map(summarizeEntity)
            });
            return [];
        }

        hwStateLog('selection_candidates', {
            segment: summarizeBreadcrumbSegment(segment),
            parent: summarizeEntity(parentEntity),
            candidates: exactMatches.map(summarizeEntity)
        });

        return filterCandidateEntities(uniqueEntities(exactMatches), segment, nextSegment, context);
    });
}

function resolveSelectionStateFromNode(nodeEl) {
    var clickedRow = getPreferredTreeRow(nodeEl) || findClickableRow(nodeEl) || nodeEl;
    var breadcrumb = getNodeBreadcrumb(clickedRow);
    var pathNames = breadcrumb.map(function(segment) {
        return segment.name;
    });
    var clickedSegment = breadcrumb.length ? breadcrumb[breadcrumb.length - 1] : null;
    var rootRef = getRootHierarchyEntityRef();

    hwStateLog('selection_click', {
        clickedLabel: getNodeText(clickedRow),
        pathNames: pathNames,
        breadcrumb: breadcrumb.map(summarizeBreadcrumbSegment),
        clickedRow: summarizeBreadcrumbSegment(clickedSegment),
        rootEntity: summarizeEntityRef(rootRef)
    });

    if (!rootRef) {
        hwStateWarn('selection_resolution_failed', {
            reason: 'missing_root_entity',
            pathNames: pathNames
        });
        return Promise.resolve(null);
    }

    return fetchEntityDetails(rootRef).then(function(rootEntity) {
        var remainingSegments = breadcrumb.slice();
        var states;

        if (!rootEntity) {
            return null;
        }

        states = [{
            entity: rootEntity,
            path: [rootEntity]
        }];

        if (remainingSegments.length && entityMatchesNodeName(rootEntity, remainingSegments[0].name)) {
            remainingSegments = remainingSegments.slice(1);
        }

        function step(currentStates, segmentIndex) {
            var segment;
            var nextSegment;

            if (!currentStates || !currentStates.length) {
                return Promise.resolve([]);
            }

            if (segmentIndex >= remainingSegments.length) {
                return Promise.resolve(uniqueResolutionStates(currentStates));
            }

            segment = remainingSegments[segmentIndex];
            nextSegment = remainingSegments[segmentIndex + 1] || null;

            return Promise.all(currentStates.map(function(state) {
                return resolveChildEntityByName(state.entity, segment, nextSegment, {
                    parentEntity: state.entity,
                    isTopLevel: segmentIndex === 0,
                    isFinalSegment: segmentIndex === remainingSegments.length - 1
                }).then(function(matches) {
                    return matches.map(function(match) {
                        return {
                            entity: match,
                            path: state.path.concat([match])
                        };
                    });
                });
            })).then(function(stateGroups) {
                var nextStates = [];

                stateGroups.forEach(function(group) {
                    nextStates = nextStates.concat(group || []);
                });

                nextStates = uniqueResolutionStates(nextStates);

                if (!nextStates.length) {
                    return [];
                }

                return step(nextStates, segmentIndex + 1);
            });
        }

        return step(states, 0);
    }).then(function(resolvedStates) {
        var resolvedPath;
        var selectedEntity;
        var plantIndex = -1;
        var selectedKind = 'container';
        var selectedRole;
        var i;

        if (!resolvedStates || !resolvedStates.length) {
            hwStateWarn('selection_resolution_failed', {
                reason: 'path_resolution_failed',
                pathNames: pathNames,
                breadcrumb: breadcrumb.map(summarizeBreadcrumbSegment)
            });
            return null;
        }

        if (resolvedStates.length > 1) {
            hwStateWarn('selection_resolution_ambiguous', {
                pathNames: pathNames,
                breadcrumb: breadcrumb.map(summarizeBreadcrumbSegment),
                matches: resolvedStates.map(function(state) {
                    return (state.path || []).map(summarizeEntity);
                })
            });
            return null;
        }

        resolvedPath = resolvedStates[0].path || [];

        if (!resolvedPath.length) {
            hwStateWarn('selection_resolution_failed', {
                reason: 'empty_resolved_path',
                pathNames: pathNames
            });
            return null;
        }

        selectedEntity = resolvedPath[resolvedPath.length - 1];
        selectedRole = getEntityRoleInfo(selectedEntity);

        return determineBranchScopeRoot(resolvedPath, breadcrumb, selectedEntity).then(function(branchScopeFact) {
            var branchRoot = branchScopeFact && branchScopeFact.entity ? branchScopeFact.entity : null;

            for (i = resolvedPath.length - 1; i >= 0; i--) {
                if (isPlantEntity(resolvedPath[i])) {
                    plantIndex = i;
                    break;
                }
            }

            if (selectedRole.isPlantAgg || (!selectedRole.isPlant && plantIndex === -1)) {
                selectedKind = 'container';
            } else if (selectedRole.isPlant) {
                selectedKind = 'plant';
            } else {
                selectedKind = 'descendant_below_plant';
            }

            hwStateLog('selection_resolved', {
                clickedEntity: summarizeEntity(selectedEntity),
                clickedRole: summarizeRoleInfo(selectedEntity),
                selectedKind: selectedKind,
                branchRoot: summarizeEntity(branchRoot),
                scopeRootReason: branchScopeFact && branchScopeFact.scopeReason ? branchScopeFact.scopeReason : '',
                scopeRootIsPlant: !!(branchScopeFact && branchScopeFact.isPlant),
                scopeRootIsPlantAgg: !!(branchScopeFact && branchScopeFact.isPlantAgg),
                breadcrumb: breadcrumb.map(summarizeBreadcrumbSegment),
                resolvedPath: resolvedPath.map(summarizeEntity)
            });

            return {
                selectedEntity: selectedEntity,
                branchRoot: branchRoot,
                selectedKind: selectedKind,
                scopeRootReason: branchScopeFact && branchScopeFact.scopeReason ? branchScopeFact.scopeReason : '',
                scopeRootIsPlant: !!(branchScopeFact && branchScopeFact.isPlant),
                scopeRootIsPlantAgg: !!(branchScopeFact && branchScopeFact.isPlantAgg),
                pathNames: pathNames,
                breadcrumb: breadcrumb,
                resolvedPath: resolvedPath
            };
        });
    }).catch(function(error) {
        hwStateWarn('selection_resolution_failed', {
            reason: 'unexpected_error',
            message: error && error.message ? error.message : ''
        });
        return null;
    });
}

function buildSelectedAssetParam(entity) {
    var entityRef = getEntityRef(entity);
    if (!entityRef) return null;

    return {
        entityId: {
            id: entityRef.id,
            entityType: entityRef.entityType
        },
        entityType: entityRef.entityType,
        entityName: entity && entity.name ? entity.name : '',
        entityLabel: entity && entity.label ? entity.label : (entity && entity.name ? entity.name : ''),
        id: entityRef.id,
        name: entity && entity.name ? entity.name : ''
    };
}

function buildBranchRootParam(entity) {
    var entityRef = getEntityRef(entity);
    if (!entityRef) return null;

    return {
        id: entityRef.id,
        entityType: entityRef.entityType,
        name: entity && entity.name ? entity.name : ''
    };
}

function pushSelectionToDashboardState(selectionState) {
    if (!self.ctx.stateController || !selectionState || !selectionState.selectedEntity) {
        return;
    }

    var selectedAssetParam = buildSelectedAssetParam(selectionState.selectedEntity);
    if (!selectedAssetParam) {
        return;
    }

    var branchRootParam = selectionState.branchRoot ? buildBranchRootParam(selectionState.branchRoot) : null;
    var params = {};
    var currentParams = getStateParams();
    var key;

    for (key in currentParams) {
        if (Object.prototype.hasOwnProperty.call(currentParams, key)) {
            params[key] = currentParams[key];
        }
    }

    params.SelectedAsset = selectedAssetParam;
    params.entityId = selectedAssetParam.entityId;

    if (branchRootParam) {
        params.SelectedBranchRoot = branchRootParam;
        hwStateLog('branch_root_emitted', {
            clickedEntity: summarizeEntity(selectionState.selectedEntity),
            branchRoot: safeParseJson(params.SelectedBranchRoot),
            scopeRootReason: selectionState.scopeRootReason || '',
            scopeRootIsPlant: !!selectionState.scopeRootIsPlant,
            scopeRootIsPlantAgg: !!selectionState.scopeRootIsPlantAgg
        });
    } else {
        delete params.SelectedBranchRoot;
        hwStateWarn('branch_root_missing', {
            clickedEntity: summarizeEntity(selectionState.selectedEntity),
            selectedKind: selectionState.selectedKind
        });
    }

    hwStateLog('state_payload', {
        SelectedAsset: safeParseJson(params.SelectedAsset),
        SelectedBranchRoot: safeParseJson(params.SelectedBranchRoot),
        selectedKind: selectionState.selectedKind,
        scopeRootReason: selectionState.scopeRootReason || '',
        scopeRootIsPlant: !!selectionState.scopeRootIsPlant,
        scopeRootIsPlantAgg: !!selectionState.scopeRootIsPlantAgg
    });

    try {
        var currentState = self.ctx.stateController.getStateId ? self.ctx.stateController.getStateId() : null;
        if (currentState) {
            self.ctx.stateController.openState(currentState, params, false);
        }
    } catch (e) {
        hwStateWarn('state_push_failed', {
            message: e && e.message ? e.message : ''
        });
    }
}

self.onInit = function() {
    var settings = self.ctx.settings || {};
    var title = settings.title || 'windforce';

    widgetRoot = null;
    try {
        var $el = self.ctx.$element;
        if ($el && $el[0]) {
            widgetRoot = $el[0];
        }
    } catch (e) {}

    if (!widgetRoot) {
        widgetRoot = document.querySelector('tb-entities-hierarchy-widget');
    }

    console.log('[HW-DARK] widgetRoot:', widgetRoot ? widgetRoot.tagName : 'NOT FOUND');

    waitForTree(function() {
        injectPanel(title);
        debugTreeStructure();
    });
};

self.onDataUpdated = function() {
    self.ctx.$scope.entitiesHierarchyWidget.onDataUpdated();
    if (hasActiveCheckedFilter) {
        setTimeout(function() {
            applyCheckedFilter();
        }, 250);
    }
};

self.onEditModeChanged = function() {
    self.ctx.$scope.entitiesHierarchyWidget.onEditModeChanged();
};

self.typeParameters = function() {
    return { dataKeysOptional: true };
};

self.actionSources = function() {
    return {
        nodeSelected: {
            name: 'widget-action.node-selected',
            multiple: false
        }
    };
};

self.onDestroy = function() {
    if (searchTimer) clearTimeout(searchTimer);
    if (statusPollTimer) clearInterval(statusPollTimer);
};

function waitForTree(callback) {
    var attempts = 0;
    var check = setInterval(function() {
        attempts++;
        if (!widgetRoot) {
            try {
                var $el = self.ctx.$element;
                if ($el && $el[0]) widgetRoot = $el[0];
            } catch (e) {}
            if (!widgetRoot) widgetRoot = document.querySelector('tb-entities-hierarchy-widget');
        }
        if (widgetRoot) {
            var hasContent = widgetRoot.querySelector('mat-tree, .mat-tree, mat-nested-tree-node, mat-tree-node, [class*="tree"], [class*="hierarchy"], [class*="node"]');
            if (hasContent || attempts > 30) {
                clearInterval(check);
                callback();
            }
        }
        if (attempts > 60) clearInterval(check);
    }, 200);
}

function debugTreeStructure() {
    if (!widgetRoot) return;
    console.log('[HW-DARK] === TREE DEBUG ===');
    console.log('[HW-DARK] widgetRoot innerHTML (first 500):', widgetRoot.innerHTML.substring(0, 500));

    var allEls = widgetRoot.querySelectorAll('*');
    var tags = {};
    var classes = {};
    for (var i = 0; i < allEls.length && i < 200; i++) {
        var tag = allEls[i].tagName.toLowerCase();
        tags[tag] = (tags[tag] || 0) + 1;

        var cls = allEls[i].className;
        if (cls && typeof cls === 'string') {
            var parts = cls.split(/\s+/);
            for (var j = 0; j < parts.length; j++) {
                if (parts[j]) classes[parts[j]] = (classes[parts[j]] || 0) + 1;
            }
        }
    }
    console.log('[HW-DARK] Tags:', JSON.stringify(tags));
    console.log('[HW-DARK] Classes:', JSON.stringify(classes));

    var nodeTests = [
        'mat-nested-tree-node',
        'mat-tree-node',
        '.mat-nested-tree-node',
        '.mat-tree-node',
        '[class*="node"]',
        '[class*="tree-node"]',
        '[class*="hierarchy"]',
        'li',
        '.node-container'
    ];
    for (var k = 0; k < nodeTests.length; k++) {
        try {
            var found = widgetRoot.querySelectorAll(nodeTests[k]);
            if (found.length > 0) {
                console.log('[HW-DARK] Selector "' + nodeTests[k] + '" -> ' + found.length + ' elements');
                if (found[0]) {
                    console.log('[HW-DARK]   First:', found[0].tagName, found[0].className, '| text:', (found[0].textContent || '').substring(0, 60));
                }
            }
        } catch (e) {}
    }

    var testNodes = findTreeNodes();
    console.log('[HW-DARK] findTreeNodes() returned ' + testNodes.length + ' nodes');
    for (var n = 0; n < Math.min(testNodes.length, 8); n++) {
        var name = getNodeText(testNodes[n]);
        console.log('[HW-DARK]   Node ' + n + ': tag=' + testNodes[n].tagName + ', extracted="' + name + '"');
    }

    console.log('[HW-DARK] === END DEBUG ===');
}

function injectPanel(title) {
    if (!widgetRoot) return;

    if (widgetRoot.querySelector('.hw-panel')) return;

    hwPanel = document.createElement('div');
    hwPanel.className = 'hw-panel';
    hwPanel.innerHTML =
        '<div class="hw-header">' +
            '<div class="hw-header-icon">' +
                '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#24e9ff" stroke-width="1.5">' +
                    '<circle cx="12" cy="12" r="10"/>' +
                    '<path d="M2 12h20"/>' +
                    '<path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2z"/>' +
                '</svg>' +
            '</div>' +
            '<span class="hw-header-title">' + title + '</span>' +
        '</div>' +
        '<div class="hw-search-bar">' +
            '<div class="hw-search-input-wrap">' +
                '<svg class="hw-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#7dd6e5" stroke-width="2">' +
                    '<circle cx="11" cy="11" r="8"/>' +
                    '<line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
                '</svg>' +
                '<input class="hw-search-input" type="text" placeholder="Search site, district, inverter..." />' +
            '</div>' +
            '<button class="hw-filter-btn" title="Filter">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#7dd6e5" stroke-width="2">' +
                    '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>' +
                '</svg>' +
            '</button>' +
        '</div>' +
        '<div id="locationPopup" class="popup">' +
            '<div class="popup-section">' +
                '<div class="popup-section-title">Location Filter</div>' +
                '<label><input type="checkbox" id="allLocations"> <b>All Locations</b></label>' +
            '</div>' +
            '<div class="popup-divider"></div>' +
            '<div class="popup-section" id="provinceList"></div>' +
            '<div class="popup-divider"></div>' +
            '<div class="popup-section">' +
                '<div class="popup-section-title">Building Type</div>' +
                '<label><input type="checkbox" id="allBuildings"> <b>All Buildings</b></label>' +
                '<label><input type="checkbox" id="school"> School</label>' +
                '<label><input type="checkbox" id="hospital"> Hospital</label>' +
                '<label><input type="checkbox" id="library"> Library</label>' +
            '</div>' +
            '<div class="popup-footer">' +
                '<button id="clearBtn" class="popup-btn popup-clear">Clear</button>' +
                '<button id="applyBtn" class="popup-btn popup-apply">Apply</button>' +
            '</div>' +
        '</div>' +
        '<div class="hw-section-title">DEVICE HIERARCHY</div>';

    widgetRoot.insertBefore(hwPanel, widgetRoot.firstChild);

    var searchInput = hwPanel.querySelector('.hw-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            var text = searchInput.value;
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(function() {
                filterNodes(text);
            }, 250);
        });
        searchInput.addEventListener('keydown', function(e) { e.stopPropagation(); });
        searchInput.addEventListener('keyup', function(e) { e.stopPropagation(); });
        searchInput.addEventListener('keypress', function(e) { e.stopPropagation(); });
    }

    initFilter();
    checkDeviceStatuses();
    bindNodeSelection();
    observeTree();
}

function bindNodeSelection() {
    if (!widgetRoot || widgetRoot.__hwSelectionBound) return;
    widgetRoot.__hwSelectionBound = true;

    widgetRoot.addEventListener('click', function(e) {
        if (e.target.closest && e.target.closest('.hw-panel')) return;
        if (e.target.closest && e.target.closest('button')) return;
        if (e.target.closest && e.target.closest('input')) return;
        if (e.target.closest && e.target.closest('label')) return;

        var row = findClickableRow(e.target);
        if (!row) return;

        var nodeName = getNodeText(row);
        if (!nodeName) return;

        var selectionToken = ++hwSelectionSeq;

        resolveSelectionStateFromNode(row).then(function(selectionState) {
            if (selectionToken !== hwSelectionSeq) return;
            if (!selectionState || !selectionState.selectedEntity) return;
            pushSelectionToDashboardState(selectionState);
        });
    }, true);
}

function isTreeWrapperElement(el) {
    if (!el || !el.tagName) return false;

    var tag = (el.tagName || '').toLowerCase();
    return tag === 'mat-nested-tree-node' ||
        tag === 'mat-tree-node' ||
        el.getAttribute('role') === 'treeitem';
}

function getPreferredTreeRow(el) {
    if (!el || !el.tagName) return null;

    if (isTreeWrapperElement(el)) {
        var row = getNodeRow(el);
        if (row && ((row.textContent || '').trim() || getNodeText(row))) {
            return row;
        }
    }

    return isNodeRowElement(el) ? el : null;
}

function findClickableRow(el) {
    var current = el;
    while (current && current !== widgetRoot) {
        var preferred = getPreferredTreeRow(current);
        if (preferred) {
            return preferred;
        }
        current = current.parentElement;
    }
    return null;
}

function isNodeRowElement(el) {
    if (!el || !el.tagName) return false;
    if (el.classList.contains('hw-panel')) return false;

    var text = (el.textContent || '').trim();
    if (!text) return false;

    var style = '';
    try { style = window.getComputedStyle(el).cursor || ''; } catch (e) {}

    return !!(
        el.classList.contains('node-container') ||
        el.classList.contains('mat-tree-node') ||
        el.classList.contains('mat-mdc-tree-node') ||
        el.getAttribute('role') === 'treeitem' ||
        style === 'pointer'
    );
}

function findNodeElement(row) {
    var current = row;
    while (current && current !== widgetRoot) {
        var tag = (current.tagName || '').toLowerCase();
        if (tag === 'mat-nested-tree-node' || tag === 'mat-tree-node' || current.getAttribute('role') === 'treeitem') {
            return current;
        }
        current = current.parentElement;
    }
    return row;
}

function findTreeNodes() {
    if (!widgetRoot) return [];

    var nodes = widgetRoot.querySelectorAll('mat-nested-tree-node');
    if (nodes.length > 0) {
        console.log('[HW-DARK] Search: found ' + nodes.length + ' mat-nested-tree-node');
        return nodes;
    }

    nodes = widgetRoot.querySelectorAll('mat-tree-node');
    if (nodes.length > 0) {
        console.log('[HW-DARK] Search: found ' + nodes.length + ' mat-tree-node');
        return nodes;
    }

    nodes = widgetRoot.querySelectorAll('.mat-nested-tree-node, .mat-tree-node');
    if (nodes.length > 0) return nodes;

    nodes = widgetRoot.querySelectorAll('[class*="node-container"]');
    if (nodes.length > 0) return nodes;

    nodes = widgetRoot.querySelectorAll('[class*="node"]');
    if (nodes.length > 0) return nodes;

    nodes = widgetRoot.querySelectorAll('li');
    if (nodes.length > 0) return nodes;

    console.log('[HW-DARK] Search: no nodes found with any strategy');
    return [];
}

var ICON_NAMES = ['chevron_right', 'expand_more', 'expand_less',
    'keyboard_arrow_right', 'keyboard_arrow_down', 'keyboard_arrow_up',
    'arrow_right', 'arrow_drop_down', 'arrow_drop_up', 'more_vert',
    'more_horiz', 'unfold_more', 'unfold_less', 'add', 'remove', 'close',
    'fiber_manual_record'];

function isIconText(t) {
    return ICON_NAMES.indexOf(t) !== -1;
}

function normalizeName(s) {
    return (s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function getNodeTextInfo(nodeEl) {
    var nameEl = nodeEl.querySelector(
        ':scope > * [class*="node-name"], :scope > * [class*="entity-name"], ' +
        ':scope > * [class*="node-text"], :scope > [class*="node-name"]'
    );
    if (nameEl) {
        var t = nameEl.textContent.trim();
        if (t && !isIconText(t)) {
            return {
                text: t,
                element: nameEl
            };
        }
    }

    var rowEl = null;
    var children = nodeEl.children;
    for (var i = 0; i < children.length; i++) {
        var tag = children[i].tagName.toLowerCase();
        var role = children[i].getAttribute('role');
        if (tag === 'ul' || role === 'group' || tag === 'mat-nested-tree-node' || tag === 'mat-tree-node') continue;
        if (children[i].classList.contains('hw-panel')) continue;
        rowEl = children[i];
        break;
    }

    if (rowEl) {
        var spans = rowEl.querySelectorAll('span');
        for (var s = 0; s < spans.length; s++) {
            if (spans[s].closest && spans[s].closest('mat-icon')) continue;
            if (spans[s].classList.contains('mat-icon') || spans[s].classList.contains('node-icon')) continue;

            var directText = '';
            for (var c = 0; c < spans[s].childNodes.length; c++) {
                if (spans[s].childNodes[c].nodeType === 3) {
                    directText += spans[s].childNodes[c].textContent;
                }
            }
            directText = directText.trim();
            if (directText.length > 1 && !isIconText(directText)) {
                return {
                    text: directText,
                    element: spans[s]
                };
            }

            var fullText = spans[s].textContent.trim();
            fullText = fullText.replace(/fiber_manual_record/g, '').trim();
            if (fullText.length > 1 && !isIconText(fullText)) {
                return {
                    text: fullText,
                    element: spans[s]
                };
            }
        }

        var walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT, null, false);
        var textNode;
        while (textNode = walker.nextNode()) {
            var tx = textNode.textContent.trim();
            if (tx.length > 1 && !isIconText(tx)) {
                return {
                    text: tx,
                    element: textNode.parentElement || rowEl
                };
            }
        }
    }

    var directTextFallback = '';
    for (var d = 0; d < nodeEl.childNodes.length; d++) {
        var child = nodeEl.childNodes[d];
        if (child.nodeType === 3) {
            directTextFallback += child.textContent;
        } else if (child.nodeType === 1) {
            var ctag = child.tagName.toLowerCase();
            if (ctag !== 'ul' && ctag !== 'mat-nested-tree-node' && ctag !== 'mat-tree-node' && child.getAttribute('role') !== 'group') {
                directTextFallback += child.textContent;
            }
        }
    }
    var trimmed = directTextFallback.trim().substring(0, 80);
    trimmed = trimmed.replace(/fiber_manual_record/g, '');
    for (var k = 0; k < ICON_NAMES.length; k++) {
        trimmed = trimmed.replace(new RegExp(ICON_NAMES[k], 'g'), '');
    }
    trimmed = trimmed.trim();

    return {
        text: trimmed,
        element: nodeEl
    };
}

function getNodeText(nodeEl) {
    var info = getNodeTextInfo(nodeEl);
    return info && info.text ? info.text : '';
}

function filterNodes(text) {
    var term = (text || '').trim().toLowerCase();
    var nodes = findTreeNodes();

    console.log('[HW-DARK] Filtering "' + term + '" across ' + nodes.length + ' nodes');

    if (!term) {
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].style.removeProperty('display');
            nodes[i].classList.remove('hw-highlight');
            var row = getNodeRow(nodes[i]);
            if (row) row.style.removeProperty('display');
        }
        return;
    }

    var matchSet = [];
    for (var m = 0; m < nodes.length; m++) {
        var name = getNodeText(nodes[m]);
        if (name.toLowerCase().indexOf(term) !== -1) {
            matchSet.push(m);
        }
    }

    var ancestorSet = [];
    for (var a = 0; a < nodes.length; a++) {
        if (matchSet.indexOf(a) !== -1) continue;
        for (var mm = 0; mm < matchSet.length; mm++) {
            if (nodes[a].contains(nodes[matchSet[mm]])) {
                ancestorSet.push(a);
                break;
            }
        }
    }

    for (var v = 0; v < nodes.length; v++) {
        var isMatch = matchSet.indexOf(v) !== -1;
        var isAncestor = ancestorSet.indexOf(v) !== -1;
        var rowEl = getNodeRow(nodes[v]);

        if (isMatch) {
            nodes[v].style.removeProperty('display');
            if (rowEl) rowEl.style.removeProperty('display');
            nodes[v].classList.add('hw-highlight');
        } else if (isAncestor) {
            nodes[v].style.removeProperty('display');
            if (rowEl) rowEl.style.removeProperty('display');
            nodes[v].classList.remove('hw-highlight');
        } else {
            nodes[v].style.display = 'none';
            nodes[v].classList.remove('hw-highlight');
        }
    }
}

function getNodeRow(nodeEl) {
    var children = nodeEl.children;
    for (var i = 0; i < children.length; i++) {
        var tag = children[i].tagName.toLowerCase();
        var role = children[i].getAttribute('role');
        if (tag === 'ul' || role === 'group' || tag === 'mat-nested-tree-node' || tag === 'mat-tree-node') continue;
        if (children[i].classList.contains('hw-panel')) continue;
        return children[i];
    }
    return null;
}

var provinceDistrictMap = {
    Western: ['Colombo', 'Gampaha', 'Kalutara'],
    Central: ['Kandy', 'Matale', 'NuwaraEliya'],
    Southern: ['Galle', 'Matara', 'Hambantota'],
    Northern: ['Jaffna', 'Kilinochchi', 'Mannar', 'Mullaitivu', 'Vavuniya'],
    Eastern: ['Trincomalee', 'Batticaloa', 'Ampara'],
    NorthWestern: ['Kurunegala', 'Puttalam'],
    NorthCentral: ['Anuradhapura', 'Polonnaruwa'],
    Uva: ['Badulla', 'Moneragala'],
    Sabaragamuwa: ['Ratnapura', 'Kegalle']
};

var districtState = {};
var provinceState = {};
var hasActiveCheckedFilter = false;
var siteBuildingTypeMap = {};
var siteDistrictMap = {};
var siteProvinceMap = {};
var buildingTypeFetched = false;
var buildingTypeFetchInFlight = false;

function canonicalLocationName(v) {
    return (v || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDistrictName(v) {
    return (v || '').toString().trim();
}

function normalizeProvinceName(v) {
    return (v || '').toString().trim();
}

function normalizeBuildingType(v) {
    var s = (v || '').toString().trim().toLowerCase();
    if (!s) return null;
    if (s === 'school') return 'school';
    if (s === 'hospital' || s === 'hostpital') return 'hospital';
    if (s === 'library') return 'library';
    return null;
}

function inferBuildingTypeFromSiteName(siteName) {
    var n = (siteName || '').trim();
    var m = n.match(/^GP_([A-Za-z]{3})\d+/);
    if (!m || !m[1]) return null;

    var code = m[1].toUpperCase();
    var third = code.charAt(2);

    if (third === 'S') return 'school';
    if (third === 'L') return 'library';
    if (third === 'H') return 'hospital';
    return null;
}

function getSiteBuildingType(siteName) {
    var key = (siteName || '').trim();
    if (!key) return null;
    if (siteBuildingTypeMap[key]) return siteBuildingTypeMap[key];
    return inferBuildingTypeFromSiteName(key);
}

function getSiteDistrict(siteName) {
    var key = (siteName || '').trim();
    if (!key) return null;
    if (siteDistrictMap[key]) return siteDistrictMap[key];
    return null;
}

function getSiteProvince(siteName) {
    var key = (siteName || '').trim();
    if (!key) return null;
    if (siteProvinceMap[key]) return siteProvinceMap[key];
    return null;
}

function isLikelySiteName(name) {
    var n = (name || '').trim();
    if (!n) return false;
    if (siteBuildingTypeMap[n]) return true;
    return /^GP_[A-Za-z]{3}\d+/.test(n);
}

function fetchSiteBuildingTypes(callback) {
    if (buildingTypeFetched) {
        callback();
        return;
    }

    if (buildingTypeFetchInFlight) {
        var wait = setInterval(function() {
            if (!buildingTypeFetchInFlight) {
                clearInterval(wait);
                callback();
            }
        }, 120);
        return;
    }

    buildingTypeFetchInFlight = true;

    var body = {
        entityFilter: {
            type: 'assetType',
            assetType: 'GP_Site'
        },
        entityFields: [
            { type: 'ENTITY_FIELD', key: 'name' }
        ],
        latestValues: [
            { type: 'ATTRIBUTE', key: 'buildingType' },
            { type: 'ATTRIBUTE', key: 'District' },
            { type: 'ATTRIBUTE', key: 'district' },
            { type: 'ATTRIBUTE', key: 'Province' },
            { type: 'ATTRIBUTE', key: 'province' }
        ],
        pageLink: {
            page: 0,
            pageSize: 1000,
            sortOrder: {
                key: { key: 'name', type: 'ENTITY_FIELD' },
                direction: 'ASC'
            }
        }
    };

    self.ctx.http.post('/api/entitiesQuery/find', body).subscribe(
        function(resp) {
            try {
                var rows = (resp && resp.data) ? resp.data : [];
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i] || {};
                    var siteName = null;
                    var bType = null;
                    var district = null;
                    var province = null;

                    if (row.entityFields) {
                        siteName = row.entityFields.name || row.entityFields['ENTITY_FIELD.name'] || null;
                    }
                    if (!siteName && row.latest && row.latest.ENTITY_FIELD && row.latest.ENTITY_FIELD.name) {
                        siteName = row.latest.ENTITY_FIELD.name.value;
                    }

                    if (row.latest && row.latest.ATTRIBUTE && row.latest.ATTRIBUTE.buildingType) {
                        bType = row.latest.ATTRIBUTE.buildingType.value;
                    }
                    if (!bType && row.latestValues && row.latestValues.ATTRIBUTE && row.latestValues.ATTRIBUTE.buildingType) {
                        bType = row.latestValues.ATTRIBUTE.buildingType.value;
                    }

                    if (row.latest && row.latest.ATTRIBUTE) {
                        if (row.latest.ATTRIBUTE.District) district = row.latest.ATTRIBUTE.District.value;
                        if (!district && row.latest.ATTRIBUTE.district) district = row.latest.ATTRIBUTE.district.value;
                        if (row.latest.ATTRIBUTE.Province) province = row.latest.ATTRIBUTE.Province.value;
                        if (!province && row.latest.ATTRIBUTE.province) province = row.latest.ATTRIBUTE.province.value;
                    }
                    if (row.latestValues && row.latestValues.ATTRIBUTE) {
                        if (!district && row.latestValues.ATTRIBUTE.District) district = row.latestValues.ATTRIBUTE.District.value;
                        if (!district && row.latestValues.ATTRIBUTE.district) district = row.latestValues.ATTRIBUTE.district.value;
                        if (!province && row.latestValues.ATTRIBUTE.Province) province = row.latestValues.ATTRIBUTE.Province.value;
                        if (!province && row.latestValues.ATTRIBUTE.province) province = row.latestValues.ATTRIBUTE.province.value;
                    }

                    var normalized = normalizeBuildingType(bType);
                    if (siteName && normalized) {
                        siteBuildingTypeMap[siteName] = normalized;
                    }
                    if (siteName && district) {
                        siteDistrictMap[siteName] = normalizeDistrictName(district);
                    }
                    if (siteName && province) {
                        siteProvinceMap[siteName] = normalizeProvinceName(province);
                    }
                }
            } catch (e) {
                console.log('[HW-DARK] buildingType parse error:', e);
            }

            buildingTypeFetched = true;
            buildingTypeFetchInFlight = false;
            callback();
        },
        function(err) {
            console.log('[HW-DARK] buildingType query failed:', err && err.message ? err.message : err);
            buildingTypeFetched = true;
            buildingTypeFetchInFlight = false;
            callback();
        }
    );
}

function initFilter() {
    var $panel = $(hwPanel);
    var userId = self.ctx.currentUser.userId;
    var baseUrl = '/api/plugins/telemetry/USER/' + userId + '/SERVER_SCOPE';

    Object.keys(provinceDistrictMap).forEach(function(p) {
        provinceState['show' + p] = 'unset';
        provinceDistrictMap[p].forEach(function(d) {
            districtState['show' + d] = 'unset';
        });
    });

    fetchSiteBuildingTypes(function() {
        console.log('[HW-DARK] buildingType map loaded:', Object.keys(siteBuildingTypeMap).length, 'sites');
    });

    var $provinceList = $panel.find('#provinceList');

    Object.keys(provinceDistrictMap).forEach(function(province) {
        $provinceList.append(
            '<div class="province">' +
                '<label class="province-label"><input type="checkbox" class="provinceChk" data-prov="' + province + '"> <b>' +
                    province + '</b></label>' +
                '<div class="districts" id="dist_' + province + '"></div>' +
            '</div>'
        );

        provinceDistrictMap[province].forEach(function(d) {
            $panel.find('#dist_' + province).append(
                '<label><input type="checkbox" class="districtChk" data-dist="' + d + '"> ' +
                d + '</label>'
            );
        });
    });

    function closeAll() {
        $panel.find('.popup').hide();
        $panel.find('.hw-filter-btn').removeClass('hw-filter-active');
    }

    $panel.find('.hw-filter-btn').click(function(e) {
        e.stopPropagation();
        var $popup = $panel.find('#locationPopup');
        if ($popup.is(':visible')) {
            closeAll();
        } else {
            $popup.show();
            $panel.find('.hw-filter-btn').addClass('hw-filter-active');
        }
    });

    $panel.find('.popup').click(function(e) {
        e.stopPropagation();
    });

    $(document).click(function() {
        closeAll();
    });

    function selectAllLocations(checked) {
        $panel.find('.provinceChk, .districtChk').prop('checked', checked);

        Object.keys(districtState).forEach(function(k) {
            districtState[k] = checked ? k.replace('show', '') : 'unset';
        });
        Object.keys(provinceState).forEach(function(k) {
            provinceState[k] = checked ? k.replace('show', '') : 'unset';
        });

        $panel.find('#allLocations').prop('checked', checked);
    }

    $panel.find('#allLocations').change(function() {
        selectAllLocations($(this).is(':checked'));
    });

    $panel.on('change', '.provinceChk', function() {
        var province = $(this).data('prov');
        var checked = $(this).is(':checked');

        $panel.find('#dist_' + province + ' .districtChk').each(function() {
            var d = $(this).data('dist');
            $(this).prop('checked', checked);
            districtState['show' + d] = checked ? d : 'unset';
        });

        provinceState['show' + province] = checked ? province : 'unset';

        $panel.find('#allLocations').prop(
            'checked',
            $panel.find('.districtChk:not(:checked)').length === 0
        );
    });

    $panel.on('change', '.districtChk', function() {
        var district = $(this).data('dist');
        var province = $(this).closest('.province').find('.provinceChk').data('prov');

        districtState['show' + district] = $(this).is(':checked') ? district : 'unset';

        var anyChecked = false;
        $panel.find('#dist_' + province + ' .districtChk').each(function() {
            if ($(this).is(':checked')) anyChecked = true;
        });

        $panel.find('.provinceChk[data-prov="' + province + '"]').prop('checked', anyChecked);

        provinceState['show' + province] = anyChecked ? province : 'unset';

        $panel.find('#allLocations').prop(
            'checked',
            $panel.find('.districtChk:not(:checked)').length === 0
        );
    });

    function updateAllBuildingsCheckbox() {
        $panel.find('#allBuildings').prop(
            'checked',
            $panel.find('#school:not(:checked), #hospital:not(:checked), #library:not(:checked)').length === 0
        );
    }

    $panel.find('#allBuildings').change(function() {
        var checked = $(this).is(':checked');
        $panel.find('#school, #hospital, #library').prop('checked', checked);
    });

    $panel.on('change', '#school, #hospital, #library', function() {
        updateAllBuildingsCheckbox();
    });

    $panel.find('#applyBtn').click(function() {
        var payload = {
            showSchool: $panel.find('#school').is(':checked') ? 'School' : 'unset',
            showHospital: $panel.find('#hospital').is(':checked') ? 'Hospital' : 'unset',
            showLibrary: $panel.find('#library').is(':checked') ? 'Library' : 'unset'
        };

        Object.keys(districtState).forEach(function(k) {
            payload[k] = districtState[k];
        });
        Object.keys(provinceState).forEach(function(k) {
            payload[k] = provinceState[k];
        });

        self.ctx.http.post(baseUrl, payload).subscribe(function() {
            console.log('[HW-DARK] Filter payload saved to server scope');
        });

        applyCheckedFilter();
        hasActiveCheckedFilter = true;

        closeAll();
    });

    $panel.find('#clearBtn').click(function() {
        selectAllLocations(true);

        $panel.find('#allBuildings').prop('checked', true);
        $panel.find('#school, #hospital, #library').prop('checked', true);

        var payload = {
            showSchool: 'School',
            showHospital: 'Hospital',
            showLibrary: 'Library'
        };

        Object.keys(districtState).forEach(function(k) {
            payload[k] = k.replace('show', '');
        });
        Object.keys(provinceState).forEach(function(k) {
            payload[k] = k.replace('show', '');
        });

        self.ctx.http.post(baseUrl, payload).subscribe(function() {
            console.log('[HW-DARK] Filter cleared and saved');
        });

        resetTreeFilter();
        hasActiveCheckedFilter = false;

        closeAll();
    });
}

function applyCheckedFilter() {
    if (!hwPanel) {
        return;
    }

    if (!buildingTypeFetched && !buildingTypeFetchInFlight) {
        fetchSiteBuildingTypes(function() {
            applyCheckedFilter();
        });
        return;
    }

    var $panel = $(hwPanel);

    var selectedDistricts = [];
    var selectedProvinces = [];

    Object.keys(districtState).forEach(function(k) {
        if (districtState[k] !== 'unset') {
            selectedDistricts.push(districtState[k]);
        }
    });
    Object.keys(provinceState).forEach(function(k) {
        if (provinceState[k] !== 'unset') {
            selectedProvinces.push(provinceState[k]);
        }
    });

    var selectedDistrictCanonical = {};
    for (var sd = 0; sd < selectedDistricts.length; sd++) {
        selectedDistrictCanonical[canonicalLocationName(selectedDistricts[sd])] = true;
    }

    var selectedProvinceCanonical = {};
    for (var sp = 0; sp < selectedProvinces.length; sp++) {
        selectedProvinceCanonical[canonicalLocationName(selectedProvinces[sp])] = true;
    }

    var selectedBuildingTypes = [];
    if ($panel.find('#school').is(':checked')) selectedBuildingTypes.push('school');
    if ($panel.find('#hospital').is(':checked')) selectedBuildingTypes.push('hospital');
    if ($panel.find('#library').is(':checked')) selectedBuildingTypes.push('library');

    var nodes = findTreeNodes();

    if (selectedDistricts.length === 0 && selectedProvinces.length === 0 && selectedBuildingTypes.length === 0) {
        for (var h = 0; h < nodes.length; h++) {
            nodes[h].style.display = 'none';
            nodes[h].classList.remove('hw-highlight');
        }
        return;
    }

    if (selectedDistricts.length === 0 && selectedProvinces.length === 0 && selectedBuildingTypes.length === 3) {
        resetTreeFilter();
        return;
    }

    var allowedSiteSet = [];
    for (var s = 0; s < nodes.length; s++) {
        var siteName = getNodeText(nodes[s]);
        if (!isLikelySiteName(siteName)) {
            continue;
        }

        var siteDistrict = getSiteDistrict(siteName);
        var siteProvince = getSiteProvince(siteName);

        var districtCanonical = canonicalLocationName(siteDistrict);
        var provinceCanonical = canonicalLocationName(siteProvince);

        var locationAllowed = false;
        if (selectedDistricts.length === 0 && selectedProvinces.length === 0) {
            locationAllowed = true;
        } else {
            if (districtCanonical && selectedDistrictCanonical[districtCanonical]) {
                locationAllowed = true;
            } else if (provinceCanonical && selectedProvinceCanonical[provinceCanonical]) {
                locationAllowed = true;
            }
        }

        var buildingAllowed = false;
        if (selectedBuildingTypes.length === 3) {
            buildingAllowed = true;
        } else if (selectedBuildingTypes.length > 0) {
            var bt = getSiteBuildingType(siteName);
            buildingAllowed = !!bt && selectedBuildingTypes.indexOf(bt) !== -1;
        }

        if (locationAllowed && buildingAllowed) {
            allowedSiteSet.push(s);
        }
    }

    var visibleSet = [];
    for (var m = 0; m < allowedSiteSet.length; m++) {
        var siteIdx = allowedSiteSet[m];
        if (visibleSet.indexOf(siteIdx) === -1) {
            visibleSet.push(siteIdx);
        }

        for (var p = 0; p < nodes.length; p++) {
            if (p === siteIdx) continue;
            if (nodes[p].contains(nodes[siteIdx]) && visibleSet.indexOf(p) === -1) {
                visibleSet.push(p);
            }
        }
    }

    for (var v = 0; v < nodes.length; v++) {
        var isVisible = visibleSet.indexOf(v) !== -1;
        var isAllowedSite = allowedSiteSet.indexOf(v) !== -1;

        if (isVisible) {
            nodes[v].style.removeProperty('display');
        } else {
            nodes[v].style.display = 'none';
        }

        if (isAllowedSite) {
            nodes[v].classList.add('hw-highlight');
        } else {
            nodes[v].classList.remove('hw-highlight');
        }
    }
}

function resetTreeFilter() {
    var nodes = findTreeNodes();
    for (var i = 0; i < nodes.length; i++) {
        nodes[i].style.removeProperty('display');
        nodes[i].classList.remove('hw-highlight');
    }
}

var siteStatusMap = {};
var statusFetched = false;
var deviceStatusMap = {};
var deviceStatusFetched = false;
var statusPollTimer = null;

var STATUS_COLORS = {
    online: { bg: '#1ef49d', shadow: '0 0 8px rgba(30,244,157,0.55)' },
    offline: { bg: '#ff4d6d', shadow: '0 0 8px rgba(255,77,109,0.55)' },
    partial: { bg: '#ffc857', shadow: '0 0 8px rgba(255,200,87,0.55)' }
};

function checkDeviceStatuses() {
    if (!widgetRoot) return;
    console.log('[HW-DARK] === STATUS CHECK (GP_Site active_num + Device active attribute) ===');

    fetchSiteStatuses(function() {
        fetchDeviceStatuses(function() {
            applyStatusesToTree();

            if (!statusPollTimer) {
                statusPollTimer = setInterval(function() {
                    statusFetched = false;
                    siteStatusMap = {};
                    deviceStatusFetched = false;
                    deviceStatusMap = {};
                    fetchSiteStatuses(function() {
                        fetchDeviceStatuses(function() {
                            applyStatusesToTree();
                        });
                    });
                }, 60000);
            }
        });
    });
}

function fetchSiteStatuses(callback) {
    if (statusFetched) { callback(); return; }

    var body = {
        entityFilter: {
            type: 'assetType',
            assetType: 'GP_Site'
        },
        entityFields: [
            { type: 'ENTITY_FIELD', key: 'name' },
            { type: 'ENTITY_FIELD', key: 'type' },
            { type: 'ENTITY_FIELD', key: 'label' }
        ],
        latestValues: [
            { type: 'TIME_SERIES', key: 'active_num' }
        ],
        pageLink: {
            page: 0,
            pageSize: 1000,
            sortOrder: {
                key: { key: 'name', type: 'ENTITY_FIELD' },
                direction: 'ASC'
            }
        }
    };

    try {
        self.ctx.http.post('/api/entitiesQuery/find', body).subscribe(
            function(resp) {
                if (resp && resp.data && resp.data.length > 0) {
                    parseSiteResponse(resp.data);
                    statusFetched = true;
                } else {
                    statusFetched = true;
                }
                callback();
            },
            function() {
                statusFetched = true;
                callback();
            }
        );
    } catch (e) {
        statusFetched = true;
        callback();
    }
}

function fetchDeviceStatuses(callback) {
    if (deviceStatusFetched) { callback(); return; }

    try {
        self.ctx.http.get('/api/entityGroups/DEVICE').subscribe(
            function(groups) {
                var groupId = null;
                if (Array.isArray(groups)) {
                    for (var g = 0; g < groups.length; g++) {
                        if (groups[g].name === 'GP Inv') {
                            groupId = groups[g].id ? (groups[g].id.id || groups[g].id) : null;
                            break;
                        }
                    }
                }
                if (groupId) {
                    fetchDevicesByGroupId(groupId, callback);
                } else {
                    fetchDevicesByType('default', callback);
                }
            },
            function() {
                deviceStatusFetched = true;
                callback();
            }
        );
    } catch (e) {
        deviceStatusFetched = true;
        callback();
    }
}

function fetchDevicesByGroupId(groupId, callback) {
    var body = {
        entityFilter: {
            type: 'entityGroupList',
            entityType: 'DEVICE',
            entityGroupList: [groupId]
        },
        entityFields: [
            { type: 'ENTITY_FIELD', key: 'name' }
        ],
        latestValues: [
            { type: 'TIME_SERIES', key: 'active_num' }
        ],
        pageLink: {
            page: 0,
            pageSize: 1000,
            sortOrder: {
                key: { key: 'name', type: 'ENTITY_FIELD' },
                direction: 'ASC'
            }
        }
    };

    try {
        self.ctx.http.post('/api/entitiesQuery/find', body).subscribe(
            function(resp) {
                if (resp && resp.data && resp.data.length > 0) {
                    parseDeviceResponse(resp.data);
                    deviceStatusFetched = true;
                } else {
                    deviceStatusFetched = true;
                }
                callback();
            },
            function() {
                deviceStatusFetched = true;
                callback();
            }
        );
    } catch (e) {
        deviceStatusFetched = true;
        callback();
    }
}

function fetchDevicesByType(deviceType, callback) {
    var body = {
        entityFilter: {
            type: 'deviceType',
            deviceType: deviceType
        },
        entityFields: [
            { type: 'ENTITY_FIELD', key: 'name' }
        ],
        latestValues: [
            { type: 'TIME_SERIES', key: 'active_num' }
        ],
        pageLink: {
            page: 0,
            pageSize: 1000,
            sortOrder: {
                key: { key: 'name', type: 'ENTITY_FIELD' },
                direction: 'ASC'
            }
        }
    };

    try {
        self.ctx.http.post('/api/entitiesQuery/find', body).subscribe(
            function(resp) {
                if (resp && resp.data && resp.data.length > 0) {
                    parseDeviceResponse(resp.data);
                    deviceStatusFetched = true;
                } else {
                    deviceStatusFetched = true;
                }
                callback();
            },
            function() {
                deviceStatusFetched = true;
                callback();
            }
        );
    } catch (e) {
        deviceStatusFetched = true;
        callback();
    }
}

function parseDeviceResponse(data) {
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var name = '';

        try {
            if (item.latest && item.latest.ENTITY_FIELD && item.latest.ENTITY_FIELD.name) {
                name = item.latest.ENTITY_FIELD.name.value || '';
            }
        } catch (e) {}
        if (!name) {
            try { name = item.entityName || item.name || ''; } catch (ee) {}
        }

        var activeNum = null;
        try {
            var ts = item.latest ? (item.latest.TIME_SERIES || item.latest.TIMESERIES || null) : null;
            if (ts && ts.active_num !== undefined) {
                activeNum = parseFloat(ts.active_num.value);
            }
        } catch (e2) {}

        var status;
        if (activeNum === null || isNaN(activeNum)) {
            status = 'offline';
        } else if (activeNum >= 1) {
            status = 'online';
        } else {
            status = 'offline';
        }

        if (name) {
            deviceStatusMap[name] = status;
            deviceStatusMap[name.toLowerCase()] = status;
            deviceStatusMap[normalizeName(name)] = status;
        }
    }
}

function parseSiteResponse(data) {
    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var name = '';

        try {
            if (item.latest && item.latest.ENTITY_FIELD && item.latest.ENTITY_FIELD.name) {
                name = item.latest.ENTITY_FIELD.name.value || '';
            }
        } catch (e) {}
        if (!name) {
            try { name = item.entityName || item.name || ''; } catch (ee) {}
        }

        var activeNum = null;
        try {
            var ts = null;
            if (item.latest) {
                ts = item.latest.TIME_SERIES || item.latest.TIMESERIES || null;
            }
            if (ts && ts.active_num) {
                activeNum = parseFloat(ts.active_num.value);
            }
        } catch (e2) {}

        var status;
        if (activeNum === null || isNaN(activeNum)) {
            status = 'offline';
        } else if (activeNum >= 1.0) {
            status = 'online';
        } else if (activeNum <= 0) {
            status = 'offline';
        } else {
            status = 'partial';
        }

        if (name) {
            siteStatusMap[name] = status;
            siteStatusMap[name.toLowerCase()] = status;
        }
    }
}

function applyStatusesToTree() {
    var nodes = findTreeNodes();
    if (nodes.length === 0) {
        return;
    }

    var mapKeys = Object.keys(siteStatusMap);

    injectAllBullets();

    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var name = getNodeText(node);
        if (!name) continue;

        var status = siteStatusMap[name] || deviceStatusMap[name] ||
            siteStatusMap[name.toLowerCase()] || deviceStatusMap[name.toLowerCase()] || null;

        if (!status) {
            var cleaned = name.replace(/\s+/g, '').trim();
            status = siteStatusMap[cleaned] || deviceStatusMap[cleaned] ||
                siteStatusMap[cleaned.toLowerCase()] || deviceStatusMap[cleaned.toLowerCase()] || null;
        }

        if (!status) {
            var normNode = normalizeName(name);
            status = siteStatusMap[normNode] || deviceStatusMap[normNode] || null;
        }

        if (!status) {
            var nameLower = name.toLowerCase();
            var normNodeFuzzy = normalizeName(name);
            for (var mk = 0; mk < mapKeys.length; mk++) {
                var key = mapKeys[mk];
                var normKey = normalizeName(key);
                if (nameLower.indexOf(key.toLowerCase()) !== -1 || key.toLowerCase().indexOf(nameLower) !== -1 ||
                    normNodeFuzzy === normKey || normNodeFuzzy.indexOf(normKey) !== -1 || normKey.indexOf(normNodeFuzzy) !== -1) {
                    status = siteStatusMap[key];
                    break;
                }
            }

            if (!status) {
                var devKeys = Object.keys(deviceStatusMap);
                for (var dk = 0; dk < devKeys.length; dk++) {
                    var dkey = devKeys[dk];
                    var normDkey = normalizeName(dkey);
                    if (nameLower.indexOf(dkey.toLowerCase()) !== -1 || dkey.toLowerCase().indexOf(nameLower) !== -1 ||
                        normNodeFuzzy === normDkey || normNodeFuzzy.indexOf(normDkey) !== -1 || normDkey.indexOf(normNodeFuzzy) !== -1) {
                        status = deviceStatusMap[dkey];
                        break;
                    }
                }
            }
        }

        if (status) {
            node.setAttribute('data-hw-status', status);
            colorNodeIcon(node, status);
        }
    }

    propagateParentStatuses(nodes);
}

function insertBulletIntoRow(row) {
    var bullet = document.createElement('span');
    bullet.className = 'hw-bullet';
    row.appendChild(bullet);
    return bullet;
}

function injectAllBullets() {
    var nodes = findTreeNodes();
    for (var i = 0; i < nodes.length; i++) {
        var row = getNodeRow(nodes[i]);
        if (!row) continue;
        if (row.querySelector('.hw-bullet')) continue;
        insertBulletIntoRow(row);
    }
}

function colorNodeIcon(node, status) {
    var c = STATUS_COLORS[status] || STATUS_COLORS.offline;
    var row = getNodeRow(node);
    if (!row) return false;

    var bullet = row.querySelector('.hw-bullet');
    if (!bullet) {
        bullet = insertBulletIntoRow(row);
    }

    bullet.style.setProperty('background', c.bg, 'important');
    bullet.style.setProperty('box-shadow', c.shadow, 'important');
    return true;
}

function propagateParentStatuses(nodes) {
    for (var pass = 0; pass < 5; pass++) {
        var anyChanged = false;
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var name = getNodeText(node);

            if (siteStatusMap[name] || siteStatusMap[(name || '').toLowerCase()]) continue;

            var childStatusNodes = node.querySelectorAll(
                ':scope > ul [data-hw-status], :scope > [role="group"] [data-hw-status]'
            );
            if (childStatusNodes.length === 0) continue;

            var hasOnline = false;
            var hasOffline = false;
            var hasPartial = false;
            for (var j = 0; j < childStatusNodes.length; j++) {
                var st = childStatusNodes[j].getAttribute('data-hw-status');
                if (st === 'online') hasOnline = true;
                if (st === 'offline') hasOffline = true;
                if (st === 'partial') hasPartial = true;
            }

            var newStatus = '';
            if (hasPartial || (hasOnline && hasOffline)) newStatus = 'partial';
            else if (hasOffline && !hasOnline) newStatus = 'offline';
            else if (hasOnline && !hasOffline) newStatus = 'online';

            if (newStatus && node.getAttribute('data-hw-status') !== newStatus) {
                node.setAttribute('data-hw-status', newStatus);
                colorNodeIcon(node, newStatus);
                anyChanged = true;
            }
        }
        if (!anyChanged) break;
    }
}

function expandAllNodes() {
    if (!widgetRoot) return;
    var clicked = clickToggleButtons(true);
    if (clicked > 0) {
        setTimeout(function() { expandAllNodes(); }, 600);
    }
}

function collapseAllNodes() {
    if (!widgetRoot) return;
    clickToggleButtons(false);
}

function clickToggleButtons(expand) {
    var allButtons = widgetRoot.querySelectorAll('button');
    var clicked = 0;
    for (var i = 0; i < allButtons.length; i++) {
        var btn = allButtons[i];
        if (btn.closest('.hw-panel') || btn.closest('.hw-fp')) continue;

        var icon = btn.querySelector('mat-icon, .mat-icon, [class*="mat-icon"]');
        var iconText = icon ? icon.textContent.trim() : '';
        var ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

        var isCollapsed = (iconText === 'chevron_right' || iconText === 'keyboard_arrow_right' ||
            iconText === 'arrow_right' || iconText === 'navigate_next' ||
            ariaLabel.indexOf('expand') !== -1);
        var isExpanded = (iconText === 'expand_more' || iconText === 'keyboard_arrow_down' ||
            iconText === 'arrow_drop_down' || ariaLabel.indexOf('collapse') !== -1);

        if (expand && isCollapsed) { btn.click(); clicked++; }
        else if (!expand && isExpanded) { btn.click(); clicked++; }
    }
    return clicked;
}

function observeTree() {
    if (!widgetRoot) return;

    var debounceTimer = null;
    var statusTimer = null;
    var observer = new MutationObserver(function() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            var searchInput = widgetRoot.querySelector('.hw-search-input');
            if (searchInput && searchInput.value && searchInput.value.trim()) {
                filterNodes(searchInput.value);
            } else if (hasActiveCheckedFilter) {
                applyCheckedFilter();
            }
        }, 150);

        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(function() {
            injectAllBullets();
            if (statusFetched) {
                applyStatusesToTree();
            }
        }, 500);
    });
    observer.observe(widgetRoot, { childList: true, subtree: true });
}
