// ============================================
// Portfolio Site Status Map
// ThingsBoard v4.3.0 PE | Latest Values
// Dynamic hierarchy traversal - no hardcoded names
// ============================================

self.onInit = function () {
    self.ctx.settings = self.ctx.settings || {};
    self.ctx.$widget = self.ctx.$container;
    self.map = null;
    self.layerGroup = null;
    self.ctx.__portfolioMapRenderSeq = self.ctx.__portfolioMapRenderSeq || 0;
    self._renderSeq = self.ctx.__portfolioMapRenderSeq;

    // Pending state tracking
    self._pendingRender = null;

    // Load Leaflet CSS dynamically (if not already present)
    var cssId = 'leaflet-css-v1';
    if (!document.getElementById(cssId)) {
        var link = document.createElement('link');
        link.id = cssId;
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
    }

    // Load Leaflet JS if missing
    if (typeof L === 'undefined') {
        var script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = function () { startWidget(); };
        document.head.appendChild(script);
    } else {
        startWidget();
    }
};

// ============================================================
// KEY / ALIAS MATCHING
// ============================================================
var KEY_ALIASES = {
    lat:      ['latitude', 'lat'],
    lon:      ['longitude', 'lon'],
    capacity: ['Plant Total Capacity', 'plant total capacity', 'capacity'],
    name:     ['plant_name', 'name'],
    status:   ['status'],
    rarLkr:   ['rar_lkr'],
    cfStatus: ['cf_status']
};

function normalizeKey(value) {
    return (value || '').toString().trim().toLowerCase();
}

function normalizeProfile(value) {
    return normalizeKey(value).replace(/\s+/g, '');
}

function normalizeEntityType(value) {
    return (value || '').toString().trim().toUpperCase();
}

function getEntityIdValue(entityId) {
    if (!entityId) { return ''; }
    if (typeof entityId === 'string') { return entityId; }
    if (entityId.id) { return entityId.id; }
    return '';
}

function getDatasourceEntityType(datasource) {
    if (!datasource) { return ''; }
    return normalizeEntityType(
        datasource.entityType ||
        (datasource.entityId && datasource.entityId.entityType) ||
        ''
    );
}

function getDatasourceProfile(datasource) {
    if (!datasource) { return ''; }
    return datasource.entityProfileName || datasource.deviceProfileName || '';
}

function isDebugMode() {
    return !!(self.ctx && self.ctx.settings && self.ctx.settings.debugMode);
}

function isStrictDuckTypingEnabled() {
    var value = self.ctx && self.ctx.settings
        ? self.ctx.settings.strictDuckTyping
        : false;
    return value === true || value === 'true';
}

function getRenderId(renderToken) {
    return renderToken && renderToken.id ? renderToken.id : 'no-render';
}

function nextRenderToken() {
    self.ctx.__portfolioMapRenderSeq = (self.ctx.__portfolioMapRenderSeq || 0) + 1;
    self._renderSeq = self.ctx.__portfolioMapRenderSeq;

    return {
        id: 'render-' + self._renderSeq + '-' + Date.now().toString(36)
    };
}

function shortId(value) {
    var id = getEntityIdValue(value);
    return id ? id.substring(0, 8) : '';
}

function parseStateParamValue(value) {
    if (typeof value !== 'string') { return value; }

    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
}

function buildEntityRef(entityId, entityType) {
    var id = getEntityIdValue(entityId);
    if (!id) { return null; }

    return {
        id: id,
        entityType: normalizeEntityType(entityType)
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

function getStateEntityRef(paramName, stateParams) {
    stateParams = stateParams || getStateParams();
    var raw = parseStateParamValue(stateParams && stateParams[paramName]);

    if (!raw) { return null; }

    if (typeof raw === 'string') {
        return buildEntityRef(raw, '');
    }

    if (raw.entityId) {
        return buildEntityRef(
            getEntityIdValue(raw.entityId),
            raw.entityType || raw.type || raw.entityId.entityType
        );
    }

    return buildEntityRef(
        getEntityIdValue(raw.id || raw.entityId),
        raw.entityType || raw.type
    );
}

function getEntityRef(entity, fallbackType) {
    if (!entity) { return null; }

    if (entity.id && typeof entity.id === 'object') {
        return buildEntityRef(entity.id.id, entity.id.entityType || entity._entityType || fallbackType);
    }

    return buildEntityRef(entity.id || entity, entity.entityType || entity._entityType || fallbackType);
}

function summarizeEntityRef(entityRef) {
    if (!entityRef || !entityRef.id) { return null; }
    return {
        id: shortId(entityRef.id),
        entityType: normalizeEntityType(entityRef.entityType) || 'UNKNOWN'
    };
}

function getRelationEntityRef(side, fallbackType) {
    if (!side) { return null; }
    return buildEntityRef(side.id || side, side.entityType || fallbackType);
}

function getEntityProfile(entity) {
    if (!entity) { return ''; }
    return entity.assetProfileName || entity.deviceProfileName || entity.type || '';
}

function annotateEntityType(entity, entityType) {
    if (!entity) { return entity; }
    entity._entityType = normalizeEntityType(entityType) || normalizeEntityType(entity._entityType);
    return entity;
}

function summarizeEntity(entity) {
    if (!entity) { return null; }
    return {
        id: shortId(entity.id && entity.id.id || entity.id),
        entityType: normalizeEntityType(
            entity._entityType ||
            (entity.id && entity.id.entityType) ||
            entity.entityType ||
            ''
        ) || 'UNKNOWN',
        profile: getEntityProfile(entity),
        name: entity.name || ''
    };
}

function summarizeEntityRefs(entityRefs, limit) {
    limit = limit || 6;
    return (entityRefs || []).slice(0, limit).map(function (entityRef) {
        return summarizeEntityRef(entityRef);
    });
}

function summarizeEntities(entities, limit) {
    limit = limit || 6;
    return (entities || []).slice(0, limit).map(function (entity) {
        return summarizeEntity(entity);
    });
}

function debugLog(renderToken, stage, payload) {
    if (!isDebugMode() || typeof console === 'undefined' || !console.log) { return; }
    console.log('[PortfolioMap][' + getRenderId(renderToken) + '] ' + stage, payload || {});
}

function debugWarn(renderToken, stage, payload) {
    if (!isDebugMode() || typeof console === 'undefined' || !console.warn) { return; }
    console.warn('[PortfolioMap][' + getRenderId(renderToken) + '] ' + stage, payload || {});
}

function isPlantEntity(entity) {
    return isPlantProfile(getEntityProfile(entity));
}

function getVisitedKey(entityRef) {
    if (!entityRef || !entityRef.id) { return ''; }
    return (entityRef.entityType || 'UNKNOWN') + ':' + entityRef.id;
}

function uniqueEntityRefs(entityRefs) {
    var seen = {};
    var unique = [];

    (entityRefs || []).forEach(function (entityRef) {
        var key = getVisitedKey(entityRef);
        if (!key || seen[key]) { return; }
        seen[key] = true;
        unique.push(entityRef);
    });

    return unique;
}

function uniqueEntities(entities) {
    var seen = {};
    var unique = [];

    (entities || []).forEach(function (entity) {
        var key = getVisitedKey(getEntityRef(entity));
        if (!key || seen[key]) { return; }
        seen[key] = true;
        unique.push(entity);
    });

    return unique;
}

function getEntityKey(datasource) {
    if (!datasource) { return ''; }
    var entityId = getEntityIdValue(datasource.entityId);
    if (entityId) { return entityId; }
    var entityType = datasource.entityType || 'ENTITY';
    var entityName = datasource.entityName || datasource.name || 'unknown';
    return entityType + ':' + entityName;
}

function matchesAnyKey(dataKey, aliases) {
    var keyName = normalizeKey(dataKey && dataKey.name);
    var keyLabel = normalizeKey(dataKey && dataKey.label);
    return aliases.indexOf(keyName) > -1 || aliases.indexOf(keyLabel) > -1;
}

// ============================================================
// PLANT PROFILE DETECTION
// ============================================================
function getTargetProfiles() {
    var raw = self.ctx.settings.targetAssetProfiles || 'SolarPlant';
    return raw.split(',').map(function (p) { return normalizeProfile(p); }).filter(Boolean);
}

function isPlantProfile(profileName) {
    var targets = getTargetProfiles();
    var normalized = normalizeProfile(profileName || '');
    return targets.indexOf(normalized) > -1;
}

// ============================================================
// TB REST API HELPERS
// Uses self.ctx.http (Angular $http exposed by ThingsBoard)
// ============================================================

function getChildRelations(entityId, entityType, token) {
    var url = '/api/relations?fromId=' + entityId +
              '&fromType=' + encodeURIComponent(normalizeEntityType(entityType) || 'ASSET') +
              '&relationType=Contains';
    return apiGet(url, token);
}

function getParentRelations(entityId, entityType, token) {
    var url = '/api/relations/info?toId=' + entityId +
              '&toType=' + encodeURIComponent(normalizeEntityType(entityType) || 'ASSET') +
              '&relationType=Contains';
    return apiGet(url, token);
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

function isNotFoundError(error) {
    return !!(error && (error.status === 404 || error.statusCode === 404));
}

function isSupportedTraversalEntityType(entityType) {
    var normalizedType = normalizeEntityType(entityType);
    return normalizedType === 'ASSET' || normalizedType === 'DEVICE';
}

function getSelectedEntityCandidateTypes(entityType) {
    var normalizedType = normalizeEntityType(entityType);
    var supported = ['ASSET', 'DEVICE'];

    if (supported.indexOf(normalizedType) > -1) {
        return [normalizedType].concat(supported.filter(function (type) {
            return type !== normalizedType;
        }));
    }

    return supported;
}

function getEntityByType(entityId, entityType, token) {
    var url = getEntityUrl(entityType, entityId);
    if (!url) {
        return Promise.reject(new Error('Unsupported entity type: ' + entityType));
    }
    return apiGet(url, token);
}

function resolveSelectedEntity(entityId, entityType, token, renderToken, context) {
    if (!entityId) {
        debugWarn(renderToken, 'resolve_selected_entity_failed', {
            context: context || 'selected_entity',
            reason: 'missing_entity_id'
        });
        return Promise.reject(new Error('Missing entity ID'));
    }

    var candidates = getSelectedEntityCandidateTypes(entityType);
    var attemptedTypes = [];

    debugLog(renderToken, 'resolve_selected_entity_start', {
        context: context || 'selected_entity',
        entityId: shortId(entityId),
        requestedType: normalizeEntityType(entityType) || 'UNKNOWN',
        candidates: candidates
    });

    function tryAt(index) {
        if (index >= candidates.length) {
            debugWarn(renderToken, 'resolve_selected_entity_failed', {
                context: context || 'selected_entity',
                entityId: shortId(entityId),
                attemptedTypes: attemptedTypes,
                reason: 'entity_not_found'
            });
            return Promise.reject(new Error('Entity not found for supported ThingsBoard types'));
        }

        var currentType = candidates[index];
        attemptedTypes.push(currentType);
        return getEntityByType(entityId, currentType, token).then(function (entity) {
            var annotated = annotateEntityType(entity, currentType);
            debugLog(renderToken, 'resolve_selected_entity_success', {
                context: context || 'selected_entity',
                entityId: shortId(entityId),
                attemptedTypes: attemptedTypes,
                entity: summarizeEntity(annotated)
            });
            return annotated;
        }).catch(function (error) {
            if (isNotFoundError(error)) {
                debugLog(renderToken, 'resolve_selected_entity_retry', {
                    context: context || 'selected_entity',
                    entityId: shortId(entityId),
                    attemptedType: currentType
                });
                return tryAt(index + 1);
            }
            debugWarn(renderToken, 'resolve_selected_entity_failed', {
                context: context || 'selected_entity',
                entityId: shortId(entityId),
                attemptedTypes: attemptedTypes,
                reason: 'request_failed',
                status: error && (error.status || error.statusCode || '')
            });
            return Promise.reject(error);
        });
    }

    return tryAt(0);
}

function fetchTraversalEntity(entityRef, token, renderToken, context) {
    if (!entityRef || !entityRef.id) {
        return Promise.resolve(null);
    }

    var entityType = normalizeEntityType(entityRef.entityType);
    if (!isSupportedTraversalEntityType(entityType)) {
        debugLog(renderToken, 'fetch_traversal_entity_skipped', {
            context: context || 'traversal',
            entity: summarizeEntityRef(entityRef),
            reason: 'unsupported_entity_type'
        });
        return Promise.resolve(null);
    }

    return getEntityByType(entityRef.id, entityType, token).then(function (entity) {
        return annotateEntityType(entity, entityType);
    }).catch(function (error) {
        if (isNotFoundError(error)) {
            debugWarn(renderToken, 'fetch_traversal_entity_not_found', {
                context: context || 'traversal',
                entity: summarizeEntityRef(entityRef)
            });
            return null;
        }
        debugWarn(renderToken, 'fetch_traversal_entity_failed', {
            context: context || 'traversal',
            entity: summarizeEntityRef(entityRef),
            status: error && (error.status || error.statusCode || '')
        });
        return Promise.reject(error);
    });
}

function getSupportedRelationEntityRefs(relations, side) {
    if (!relations || relations.length === 0) { return []; }

    return uniqueEntityRefs(relations.map(function (relation) {
        return getRelationEntityRef(relation && relation[side]);
    }).filter(function (entityRef) {
        return entityRef && isSupportedTraversalEntityType(entityRef.entityType);
    }));
}

function apiGet(url, token) {
    var headers = {};
    if (token) {
        headers['X-Authorization'] = 'Bearer ' + token;
    }

    return new Promise(function (resolve, reject) {
        try {
            var request = self.ctx.http.get(url, { headers: headers });

            if (request && typeof request.then === 'function') {
                request.then(function (resp) {
                    resolve(resp && resp.data !== undefined ? resp.data : resp);
                }, reject);
                return;
            }

            if (request && typeof request.subscribe === 'function') {
                request.subscribe(function (resp) {
                    resolve(resp && resp.data !== undefined ? resp.data : resp);
                }, reject);
                return;
            }

            reject(new Error('Unsupported ThingsBoard HTTP client response type'));
        } catch (err) {
            reject(err);
        }
    });
}

function getSupportedParentRefs(entityRef, authToken, renderToken, context) {
    if (!entityRef || !entityRef.id) {
        return Promise.resolve([]);
    }

    return getParentRelations(entityRef.id, entityRef.entityType, authToken).then(function (relations) {
        var supportedParents = getSupportedRelationEntityRefs(relations, 'from');
        debugLog(renderToken, 'parent_candidates', {
            context: context || 'parent_lookup',
            entity: summarizeEntityRef(entityRef),
            relationCount: (relations || []).length,
            supportedParentCount: supportedParents.length,
            parents: summarizeEntityRefs(supportedParents),
            ambiguityCount: supportedParents.length > 1 ? supportedParents.length : 0
        });
        return supportedParents;
    }).catch(function (error) {
        debugWarn(renderToken, 'parent_candidates_failed', {
            context: context || 'parent_lookup',
            entity: summarizeEntityRef(entityRef),
            status: error && (error.status || error.statusCode || '')
        });
        return [];
    });
}

function findNearestAncestorMatches(startRef, authToken, renderToken, maxUp, matcher, label) {
    maxUp = maxUp || 5;
    var visited = {};

    function step(frontier, depth) {
        frontier = uniqueEntityRefs(frontier).filter(function (entityRef) {
            var key = getVisitedKey(entityRef);
            return key && !visited[key];
        });

        if (depth > maxUp || !frontier.length) {
            debugWarn(renderToken, 'ancestor_search_no_match', {
                label: label,
                start: summarizeEntityRef(startRef),
                maxUp: maxUp
            });
            return Promise.resolve([]);
        }

        frontier.forEach(function (entityRef) {
            visited[getVisitedKey(entityRef)] = true;
        });

        debugLog(renderToken, 'ancestor_search_level', {
            label: label,
            depth: depth,
            frontier: summarizeEntityRefs(frontier)
        });

        return Promise.all(frontier.map(function (entityRef) {
            return fetchTraversalEntity(entityRef, authToken, renderToken, label + '_depth_' + depth).then(function (entity) {
                return { ref: entityRef, entity: entity };
            }).catch(function () {
                return { ref: entityRef, entity: null };
            });
        })).then(function (results) {
            var matches = [];
            var parentPromises = [];

            results.forEach(function (result) {
                if (!result.entity) { return; }

                if (matcher(result.entity)) {
                    matches.push(result.entity);
                    return;
                }

                parentPromises.push(getSupportedParentRefs(result.ref, authToken, renderToken, label + '_depth_' + depth));
            });

            matches = uniqueEntities(matches);

            if (matches.length > 0) {
                debugLog(renderToken, 'ancestor_search_match', {
                    label: label,
                    depth: depth,
                    matchCount: matches.length,
                    matches: summarizeEntities(matches),
                    ambiguityCount: matches.length > 1 ? matches.length : 0
                });
                return matches;
            }

            return Promise.all(parentPromises).then(function (parentLists) {
                var nextFrontier = [];
                parentLists.forEach(function (parentRefs) {
                    nextFrontier = nextFrontier.concat(parentRefs || []);
                });
                return step(nextFrontier, depth + 1);
            });
        });
    }

    return step([startRef], 0);
}

function findNearestPlantAncestors(entityRef, authToken, renderToken, maxUp) {
    return findNearestAncestorMatches(entityRef, authToken, renderToken, maxUp, function (entity) {
        return isPlantEntity(entity);
    }, 'plant_ancestor_search');
}

function findNearestNonPlantAncestors(entityRef, authToken, renderToken, maxUp) {
    return findNearestAncestorMatches(entityRef, authToken, renderToken, maxUp, function (entity) {
        return !isPlantEntity(entity);
    }, 'non_plant_ancestor_search');
}

function renderSelectedPlantOnly(plantEntity, authToken, renderToken, reason, details) {
    debugWarn(renderToken, 'render_selected_plant_only', {
        reason: reason,
        plant: summarizeEntity(plantEntity),
        details: details || {}
    });
    return renderPlantAssets([plantEntity], authToken, renderToken, {
        branchRootKind: 'plant_leaf',
        branchRoot: plantEntity
    });
}

function fetchPlantTree(rootEntityRef, token, renderToken, options) {
    options = options || {};

    var maxDepth = options.maxDepth || 8;
    var includeRootPlant = !!options.includeRootPlant;
    var descendIntoPlantChildren = !!options.descendIntoPlantChildren;
    var plants = [];
    var visited = {};

    debugLog(renderToken, 'plant_tree_start', {
        root: summarizeEntityRef(rootEntityRef),
        includeRootPlant: includeRootPlant,
        descendIntoPlantChildren: descendIntoPlantChildren,
        maxDepth: maxDepth
    });

    function walk(entityRef, depth) {
        var visitKey = getVisitedKey(entityRef);
        if (depth > maxDepth || !visitKey || visited[visitKey]) {
            return Promise.resolve();
        }
        visited[visitKey] = true;

        return getChildRelations(entityRef.id, entityRef.entityType, token).then(function (relations) {
            if (!relations || relations.length === 0) { return; }

            var childRefs = getSupportedRelationEntityRefs(relations, 'to');

            debugLog(renderToken, 'plant_tree_walk', {
                depth: depth,
                root: summarizeEntityRef(entityRef),
                relationCount: relations.length,
                supportedChildCount: childRefs.length,
                skippedRelationCount: relations.length - childRefs.length
            });

            var promises = childRefs.map(function (childRef) {
                var childKey = getVisitedKey(childRef);
                if (visited[childKey]) {
                    return Promise.resolve();
                }

                return fetchTraversalEntity(childRef, token, renderToken, 'plant_tree_depth_' + depth).then(function (entity) {
                    if (!entity) { return; }

                    if (isPlantEntity(entity)) {
                        plants.push(entity);
                        debugLog(renderToken, 'plant_tree_plant_found', {
                            depth: depth + 1,
                            plant: summarizeEntity(entity)
                        });
                        if (!descendIntoPlantChildren) {
                            return Promise.resolve();
                        }
                    }

                    return walk(getEntityRef(entity, childRef.entityType), depth + 1);
                }).catch(function () {
                    debugWarn(renderToken, 'plant_tree_child_failed', {
                        depth: depth + 1,
                        child: summarizeEntityRef(childRef)
                    });
                    return Promise.resolve();
                });
            });

            return Promise.all(promises);
        });
    }

    function complete() {
        plants = uniqueEntities(plants);
        debugLog(renderToken, 'plant_tree_complete', {
            root: summarizeEntityRef(rootEntityRef),
            includeRootPlant: includeRootPlant,
            descendIntoPlantChildren: descendIntoPlantChildren,
            plantCount: plants.length,
            plants: summarizeEntities(plants)
        });
        return plants;
    }

    if (!rootEntityRef || !rootEntityRef.id) {
        return Promise.resolve([]);
    }

    if (!includeRootPlant) {
        return walk(rootEntityRef, 0).then(complete);
    }

    return fetchTraversalEntity(rootEntityRef, token, renderToken, 'plant_tree_root').then(function (rootEntity) {
        if (rootEntity && isPlantEntity(rootEntity)) {
            plants.push(rootEntity);
            debugLog(renderToken, 'plant_tree_root_included', {
                root: summarizeEntity(rootEntity)
            });
        }
        return walk(rootEntityRef, 0);
    }).then(complete);
}

function tryRenderPlantSubtree(plantEntity, authToken, renderToken, context) {
    var plantRef = getEntityRef(plantEntity);

    return fetchPlantTree(plantRef, authToken, renderToken, {
        includeRootPlant: true,
        descendIntoPlantChildren: true
    }).then(function (plants) {
        if (renderToken !== self._pendingRender) { return false; }

        if (!plants || plants.length <= 1) {
            debugLog(renderToken, 'plant_subtree_not_used', {
                context: context,
                plant: summarizeEntity(plantEntity),
                plantCount: (plants || []).length
            });
            return false;
        }

        debugLog(renderToken, 'plant_subtree_used', {
            context: context,
            branchRootKind: 'plant_subtree',
            branchRoot: summarizeEntity(plantEntity),
            plantCount: plants.length,
            plants: summarizeEntities(plants)
        });
        renderPlantAssets(plants, authToken, renderToken, {
            branchRootKind: 'plant_subtree',
            branchRoot: plantEntity
        });
        return true;
    });
}

function resolveBranchFromPlant(plantEntity, authToken, renderToken, context) {
    var plantRef = getEntityRef(plantEntity);

    debugLog(renderToken, 'resolve_branch_from_plant_start', {
        context: context,
        plant: summarizeEntity(plantEntity)
    });

    return tryRenderPlantSubtree(plantEntity, authToken, renderToken, context).then(function (usedPlantSubtree) {
        if (renderToken !== self._pendingRender || usedPlantSubtree) { return; }

        return findNearestNonPlantAncestors(plantRef, authToken, renderToken).then(function (branchAncestors) {
            if (renderToken !== self._pendingRender) { return; }

            if (!branchAncestors || branchAncestors.length === 0) {
                return renderSelectedPlantOnly(plantEntity, authToken, renderToken, 'no_supported_parents', {
                    context: context
                });
            }

            if (branchAncestors.length > 1) {
                return renderSelectedPlantOnly(plantEntity, authToken, renderToken, 'ambiguous_branch', {
                    context: context,
                    branchCandidates: summarizeEntities(branchAncestors)
                });
            }

            debugLog(renderToken, 'resolve_branch_from_plant_success', {
                context: context,
                plant: summarizeEntity(plantEntity),
                branchRoot: summarizeEntity(branchAncestors[0])
            });

            return fetchAndRender(getEntityRef(branchAncestors[0]), authToken, renderToken, {
                branchRootKind: 'container',
                branchRoot: branchAncestors[0]
            });
        });
    });
}

function tryRenderBranchRoot(branchRootRef, authToken, renderToken) {
    if (!branchRootRef || !branchRootRef.id) {
        return Promise.resolve(false);
    }

    debugLog(renderToken, 'branch_root_attempt', {
        branchRoot: summarizeEntityRef(branchRootRef)
    });

    return resolveSelectedEntity(branchRootRef.id, branchRootRef.entityType, authToken, renderToken, 'branch_root').then(function (branchRootEntity) {
        if (renderToken !== self._pendingRender) { return false; }

        if (isPlantEntity(branchRootEntity)) {
            return fetchPlantTree(getEntityRef(branchRootEntity, branchRootRef.entityType), authToken, renderToken, {
                includeRootPlant: true,
                descendIntoPlantChildren: true
            }).then(function (plants) {
                var branchRootKind = plants && plants.length > 1 ? 'plant_subtree' : 'plant_leaf';

                if (renderToken !== self._pendingRender) { return false; }
                if (!plants || plants.length === 0) {
                    debugWarn(renderToken, 'branch_root_invalid', {
                        reason: 'branch_root_invalid',
                        branchRoot: summarizeEntity(branchRootEntity),
                        detail: 'plant_branch_root_has_no_renderable_plants'
                    });
                    return false;
                }

                debugLog(renderToken, 'branch_root_used', {
                    branchRoot: summarizeEntity(branchRootEntity),
                    branchRootKind: branchRootKind,
                    branchRootUsed: true,
                    descendantPlantCount: plants.length
                });
                renderPlantAssets(plants, authToken, renderToken, {
                    branchRootKind: branchRootKind,
                    branchRoot: branchRootEntity
                });
                return true;
            });
        }

        return fetchPlantTree(getEntityRef(branchRootEntity, branchRootRef.entityType), authToken, renderToken, {
            includeRootPlant: false,
            descendIntoPlantChildren: true
        }).then(function (plants) {
            if (renderToken !== self._pendingRender) { return false; }
            debugLog(renderToken, 'branch_root_descendants', {
                branchRoot: summarizeEntity(branchRootEntity),
                descendantPlantCount: (plants || []).length
            });
            if (plants && plants.length > 0) {
                debugLog(renderToken, 'branch_root_used', {
                    branchRoot: summarizeEntity(branchRootEntity),
                    branchRootKind: 'container',
                    branchRootUsed: true,
                    descendantPlantCount: plants.length
                });
                renderPlantAssets(plants, authToken, renderToken, {
                    branchRootKind: 'container',
                    branchRoot: branchRootEntity
                });
                return true;
            }
            debugWarn(renderToken, 'branch_root_invalid', {
                reason: 'branch_root_invalid',
                branchRoot: summarizeEntity(branchRootEntity),
                detail: 'branch_root_has_no_plant_descendants'
            });
            return false;
        });
    }).catch(function () {
        debugWarn(renderToken, 'branch_root_invalid', {
            reason: 'branch_root_invalid',
            branchRoot: summarizeEntityRef(branchRootRef)
        });
        return false;
    });
}

// ============================================================
// RECURSIVE DESCENDANT FETCH
// ============================================================
function fetchPlantDescendants(rootEntityRef, token, renderToken, maxDepth) {
    return fetchPlantTree(rootEntityRef, token, renderToken, {
        maxDepth: maxDepth || 8,
        includeRootPlant: false,
        descendIntoPlantChildren: false
    });
}

// ============================================================
// TELEMETRY / ATTRIBUTE FETCH
// ============================================================
var TELEMETRY_KEYS = ['latitude', 'lat', 'longitude', 'lon',
                      'Plant Total Capacity', 'plant total capacity', 'capacity',
                      'plant_name', 'name',
                      'status', 'rar_lkr', 'cf_status'];

function getTelemetryEntityType(entity) {
    var entityType = normalizeEntityType(
        (entity && entity._entityType) ||
        (entity && entity.id && entity.id.entityType) ||
        (entity && entity.entityType) ||
        ''
    );

    return entityType || 'ASSET';
}

function getServerAttributes(entityId, entityType, token) {
    var url = '/api/plugins/telemetry/' + (normalizeEntityType(entityType) || 'ASSET') + '/' + entityId +
              '/values/attributes/SERVER_SCOPE?keys=' +
              encodeURIComponent(TELEMETRY_KEYS.join(','));
    return apiGet(url, token);
}

function normalizeAttributeMap(attributeData) {
    if (!attributeData) {
        return {};
    }

    if (Array.isArray(attributeData)) {
        return attributeData.reduce(function (acc, entry) {
            if (entry && entry.key !== undefined) {
                acc[entry.key] = entry.value;
            }
            return acc;
        }, {});
    }

    return attributeData;
}

function fetchTelemetryForAssets(assets, token) {
    var promises = assets.map(function (asset) {
        var id = asset.id && asset.id.id || asset.id;
        var entityType = getTelemetryEntityType(asset);
        var telemetryUrl = '/api/plugins/telemetry/' + entityType + '/' + id +
                           '/values/timeseries?keys=' + encodeURIComponent(TELEMETRY_KEYS.join(',')) +
                           '&limit=1';

        return Promise.all([
            apiGet(telemetryUrl, token).catch(function () { return {}; }),
            getServerAttributes(id, entityType, token).catch(function () { return {}; })
        ]).then(function (result) {
            return {
                asset: asset,
                telemetry: result[0] || {},
                attributes: normalizeAttributeMap(result[1])
            };
        });
    });

    return Promise.all(promises);
}

// ============================================================
// SITE OBJECT FROM TELEMETRY / ATTRIBUTES
// ============================================================
function extractLatestValue(telemetryEntry) {
    if (!telemetryEntry || !telemetryEntry.length) { return null; }
    return telemetryEntry[0].value;
}

function buildSiteFromTelemetry(asset, telemetry, attributes) {
    var assetId = asset.id && asset.id.id || asset.id;
    var assetName = asset.name || 'Unknown';

    function tv(keys) {
        for (var i = 0; i < keys.length; i++) {
            var telemetryValue = extractLatestValue(telemetry[keys[i]]);
            if (telemetryValue !== null && telemetryValue !== undefined) {
                return telemetryValue;
            }

            if (attributes && attributes[keys[i]] !== null && attributes[keys[i]] !== undefined) {
                return attributes[keys[i]];
            }
        }
        return null;
    }

    var lat = parseFloat(tv(['latitude', 'lat']));
    var lon = parseFloat(tv(['longitude', 'lon']));
    var capacity = parseFloat(tv(['Plant Total Capacity', 'plant total capacity', 'capacity']));
    var name = tv(['plant_name', 'name']) || assetName;
    var status = tv(['status']);
    var rar_lkr = parseFloat(tv(['rar_lkr']));
    var cf_status = tv(['cf_status']);

    return {
        entityId: assetId,
        name: name,
        lat: isNaN(lat) ? null : lat,
        lon: isNaN(lon) ? null : lon,
        capacity: isNaN(capacity) ? null : capacity,
        status: status,
        rar_lkr: isNaN(rar_lkr) ? null : rar_lkr,
        cf_status: cf_status
    };
}

// ============================================================
// TOKEN HELPER
// ============================================================
function getAuthToken() {
    try {
        return self.ctx.authService
            ? self.ctx.authService.getJwtToken()
            : null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// WIDGET BOOTSTRAP
// ============================================================
function startWidget() {
    self.updateDom();
    setTimeout(initMap, 150);
}

self.updateDom = function () {
    var s = self.ctx.settings;
    self.ctx.$widget.find('.js-title').text(
        s.widgetTitle || 'Portfolio Site Locations'
    );
};

// ============================================================
// MAP INIT
// ============================================================
function initMap() {
    var $el = self.ctx.$widget;
    var container = $el.find('.js-map-canvas')[0];
    if (!container) { return; }

    if (self.map) {
        self.map.remove();
        self.map = null;
    }

    self.map = L.map(container, {
        center: [7.87, 80.70],
        zoom: 7,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(self.map);

    self.map.zoomControl.setPosition('topright');
    self.layerGroup = L.layerGroup().addTo(self.map);

    self.onDataUpdated();
}

// ============================================================
// MAIN DATA HANDLER
// ============================================================
self.onDataUpdated = function () {
    if (!self.map || !self.layerGroup) { return; }

    var selectedEntityId = null;
    var selectedEntityType = null;
    var selectedProfile = null;
    var stateParams = getStateParams();
    var rawSelectedBranchRoot = stateParams && stateParams.SelectedBranchRoot;
    var selectedBranchRootRef = getStateEntityRef('SelectedBranchRoot', stateParams);

    if (self.ctx.data && self.ctx.data.length > 0) {
        self.ctx.data.forEach(function (dsData) {
            if (!dsData || !dsData.datasource) { return; }
            var ds = dsData.datasource;
            var eId = getEntityIdValue(ds.entityId);
            if (eId && !selectedEntityId) {
                selectedEntityId = eId;
                selectedEntityType = getDatasourceEntityType(ds);
                selectedProfile = normalizeProfile(getDatasourceProfile(ds));
            }
        });
    }

    if (!selectedEntityId) {
        renderEmptyState();
        return;
    }

    var renderToken = nextRenderToken();
    self._pendingRender = renderToken;

    debugLog(renderToken, 'selection', {
        selectedEntity: summarizeEntityRef(buildEntityRef(selectedEntityId, selectedEntityType)),
        selectedProfile: selectedProfile || '',
        rawSelectedBranchRoot: rawSelectedBranchRoot,
        parsedSelectedBranchRoot: summarizeEntityRef(selectedBranchRootRef)
    });

    if (!selectedBranchRootRef) {
        debugWarn(renderToken, 'branch_root_missing', {
            reason: 'branch_root_missing'
        });
    }

    resolveRenderRoot(
        buildEntityRef(selectedEntityId, selectedEntityType),
        selectedProfile,
        selectedBranchRootRef,
        renderToken
    );
};

// ============================================================
// RESOLVE ROOT AND RENDER
// ============================================================
function resolveRenderRoot(selectedEntityRef, selectedProfile, selectedBranchRootRef, renderToken) {
    var authToken = getAuthToken();

    setLoadingState(true);

    resolveSelectedEntity(selectedEntityRef.id, selectedEntityRef.entityType, authToken, renderToken, 'selected_entity').then(function (asset) {
        if (renderToken !== self._pendingRender) { return; }

        if (selectedBranchRootRef && selectedBranchRootRef.id) {
            return tryRenderBranchRoot(selectedBranchRootRef, authToken, renderToken).then(function (usedBranchRoot) {
                if (renderToken !== self._pendingRender || usedBranchRoot) { return; }
                return continueResolveRenderRoot(asset, selectedEntityRef, selectedProfile, authToken, renderToken);
            });
        }

        return continueResolveRenderRoot(asset, selectedEntityRef, selectedProfile, authToken, renderToken);
    }).catch(function () {
        if (renderToken !== self._pendingRender) { return; }
        debugWarn(renderToken, 'resolve_render_root_failed', {
            selectedEntity: summarizeEntityRef(selectedEntityRef),
            reason: 'selected_entity_resolution_failed'
        });
        setLoadingState(false);
        renderEmptyState(renderToken, 'selected_entity_resolution_failed');
    });
}

function continueResolveRenderRoot(asset, selectedEntityRef, selectedProfile, authToken, renderToken) {
    if (renderToken !== self._pendingRender) { return Promise.resolve(); }

    var profile = normalizeProfile(
        getEntityProfile(asset) || selectedProfile || ''
    );
    var selectedResolvedRef = getEntityRef(asset, selectedEntityRef.entityType);

    debugLog(renderToken, 'continue_resolve_render_root', {
        selectedEntity: summarizeEntity(asset),
        selectedProfile: profile || '',
        selectedKind: isPlantProfile(profile) ? 'plant' : 'non_plant'
    });

    if (isPlantProfile(profile)) {
        return resolveBranchFromPlant(asset, authToken, renderToken, 'selected_plant');
    }

    return fetchPlantTree(selectedResolvedRef, authToken, renderToken, {
        includeRootPlant: false,
        descendIntoPlantChildren: true
    }).then(function (plants) {
        if (renderToken !== self._pendingRender) { return; }

        if (plants && plants.length > 0) {
            debugLog(renderToken, 'selected_container_descendants', {
                selectedEntity: summarizeEntity(asset),
                branchRootKind: 'container',
                descendantPlantCount: plants.length,
                plantIds: plants.map(function (plant) {
                    return shortId(plant && plant.id && plant.id.id || plant && plant.id);
                })
            });
            renderPlantAssets(plants, authToken, renderToken, {
                branchRootKind: 'container',
                branchRoot: asset
            });
            return;
        }

        return findNearestPlantAncestors(selectedResolvedRef, authToken, renderToken).then(function (plantAncestors) {
            if (renderToken !== self._pendingRender) { return; }

            if (!plantAncestors || plantAncestors.length === 0) {
                debugWarn(renderToken, 'container_descendants_empty', {
                    reason: 'container_descendants_empty',
                    selectedEntity: summarizeEntity(asset)
                });
                setLoadingState(false);
                renderEmptyState(renderToken, 'container_descendants_empty', {
                    selectedEntity: summarizeEntity(asset)
                });
                return;
            }

            if (plantAncestors.length > 1) {
                debugWarn(renderToken, 'ambiguous_branch', {
                    reason: 'ambiguous_branch',
                    selectedEntity: summarizeEntity(asset),
                    plantAncestors: summarizeEntities(plantAncestors)
                });
                setLoadingState(false);
                renderEmptyState(renderToken, 'ambiguous_branch', {
                    selectedEntity: summarizeEntity(asset),
                    plantAncestors: summarizeEntities(plantAncestors)
                });
                return;
            }

            return resolveBranchFromPlant(plantAncestors[0], authToken, renderToken, 'descendant_below_plant');
        }).catch(function () {
            if (renderToken !== self._pendingRender) { return; }
            debugWarn(renderToken, 'continue_resolve_render_root_failed', {
                selectedEntity: summarizeEntity(asset)
            });
            setLoadingState(false);
            renderEmptyState(renderToken, 'continue_resolve_render_root_failed', {
                selectedEntity: summarizeEntity(asset)
            });
        });
    });
}

function fetchAndRender(rootEntityRef, authToken, renderToken, renderMeta) {
    renderMeta = renderMeta || {};

    debugLog(renderToken, 'fetch_and_render_start', {
        rootEntity: summarizeEntityRef(rootEntityRef),
        branchRootKind: renderMeta.branchRootKind || '',
        branchRoot: summarizeEntity(renderMeta.branchRoot)
    });

    fetchPlantTree(rootEntityRef, authToken, renderToken, {
        includeRootPlant: false,
        descendIntoPlantChildren: true
    }).then(function (plants) {
        if (renderToken !== self._pendingRender) { return; }
        renderPlantAssets(plants, authToken, renderToken, renderMeta);
    }).catch(function () {
        if (renderToken !== self._pendingRender) { return; }
        debugWarn(renderToken, 'fetch_and_render_failed', {
            rootEntity: summarizeEntityRef(rootEntityRef),
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot)
        });
        setLoadingState(false);
        renderEmptyState(renderToken, 'fetch_and_render_failed', {
            rootEntity: summarizeEntityRef(rootEntityRef),
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot)
        });
    });
}

function renderPlantAssets(assets, authToken, renderToken, renderMeta) {
    renderMeta = renderMeta || {};

    if (!assets || assets.length === 0) {
        setLoadingState(false);
        renderEmptyState(renderToken, 'no_assets_to_render', {
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot)
        });
        return;
    }

    assets = uniqueEntities(assets);

    debugLog(renderToken, 'telemetry_fetch_start', {
        branchRootKind: renderMeta.branchRootKind || '',
        branchRoot: summarizeEntity(renderMeta.branchRoot),
        telemetryFetchCount: assets.length,
        assets: summarizeEntities(assets)
    });

    fetchTelemetryForAssets(assets, authToken).then(function (results) {
        if (renderToken !== self._pendingRender) { return; }
        setLoadingState(false);

        var useDuckTyping = isStrictDuckTypingEnabled();
        var sites = [];
        var droppedMissingLocation = 0;
        var droppedMissingCapacity = 0;
        var renderedWithoutCapacity = 0;

        results.forEach(function (result) {
            var site = buildSiteFromTelemetry(result.asset, result.telemetry, result.attributes);
            if (site.lat === null || site.lon === null) {
                droppedMissingLocation++;
                return;
            }
            if (useDuckTyping && site.capacity === null) {
                droppedMissingCapacity++;
                return;
            }
            if (site.capacity === null) {
                renderedWithoutCapacity++;
            }
            sites.push(site);
        });

        debugLog(renderToken, 'render_summary', {
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot),
            strictDuckTyping: useDuckTyping,
            telemetryFetchCount: results.length,
            renderedCount: sites.length,
            renderedWithoutCapacity: renderedWithoutCapacity,
            droppedMissingLocation: droppedMissingLocation,
            droppedMissingCapacity: droppedMissingCapacity,
            plantIds: sites.map(function (site) { return shortId(site.entityId); })
        });

        if (sites.length === 0) {
            debugWarn(renderToken, 'telemetry_filtered_all', {
                reason: 'telemetry_filtered_all',
                branchRootKind: renderMeta.branchRootKind || '',
                branchRoot: summarizeEntity(renderMeta.branchRoot),
                droppedMissingLocation: droppedMissingLocation,
                droppedMissingCapacity: droppedMissingCapacity
            });
            renderEmptyState(renderToken, 'telemetry_filtered_all', {
                branchRootKind: renderMeta.branchRootKind || '',
                branchRoot: summarizeEntity(renderMeta.branchRoot),
                droppedMissingLocation: droppedMissingLocation,
                droppedMissingCapacity: droppedMissingCapacity
            });
            return;
        }

        renderMarkers(sites);
    }).catch(function () {
        if (renderToken !== self._pendingRender) { return; }
        debugWarn(renderToken, 'telemetry_fetch_failed', {
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot),
            assetCount: assets.length
        });
        setLoadingState(false);
        renderEmptyState(renderToken, 'telemetry_fetch_failed', {
            branchRootKind: renderMeta.branchRootKind || '',
            branchRoot: summarizeEntity(renderMeta.branchRoot),
            assetCount: assets.length
        });
    });
}

// ============================================================
// MARKER RENDERING
// ============================================================
function renderMarkers(sites) {
    if (!self.map || !self.layerGroup) { return; }
    self.layerGroup.clearLayers();

    if (sites.length === 0) {
        renderEmptyState();
        return;
    }

    var $el = self.ctx.$widget;
    var $card = $el.find('.map-card');
    var cardFont = parseFloat($card.css('font-size')) || 14;
    var scaleFactor = cardFont / 14;

    var countOk = 0;
    var countWarn = 0;
    var countFault = 0;
    var bounds = [];
    var displayUnit = (self.ctx.settings.capacityUnit || 'MW').trim();

    sites.forEach(function (site) {
        var lat = site.lat;
        var lon = site.lon;
        var hasCapacity = site.capacity !== null && site.capacity !== undefined;
        var capVal = hasCapacity ? site.capacity : null;
        var capMW = hasCapacity ? capVal : 0;
        var unitUpperCase = displayUnit.toUpperCase();
        if (hasCapacity && unitUpperCase === 'W') {
            capMW = capVal / 1000000;
        } else if (hasCapacity && unitUpperCase === 'KW') {
            capMW = capVal / 1000;
        }

        var baseRadius = 6;
        if (capMW >= 50) {
            baseRadius = 14;
        } else if (capMW >= 10) {
            baseRadius = 10;
        }
        var radius = Math.max(4, baseRadius * scaleFactor);

        var color = '#66BB6A';
        var status = (site.status || 'healthy').toLowerCase();

        if (status === 'warning') {
            color = '#FFC107';
            countWarn++;
        } else if (status === 'fault') {
            color = '#FF5252';
            countFault++;
        } else {
            countOk++;
        }

        var marker = L.circleMarker([lat, lon], {
            radius: radius,
            fillColor: color,
            color: '#FFFFFF',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.75
        });

        var name = site.name || 'Unknown';
        var capText = hasCapacity
            ? ('Capacity: ' + capVal + ' ' + displayUnit)
            : 'Capacity: N/A';
        var statusText = '<span style="color:' + color + '; text-transform:uppercase; font-weight:600;">' + status + '</span>';

        var tooltipHtml =
            '<div class="tt-name">' + name + '</div>' +
            '<div class="tt-detail">' + capText + ' &nbsp;|&nbsp; ' + statusText + '</div>';

        if (site.rar_lkr && site.rar_lkr > 0) {
            var rarM = (site.rar_lkr / 1000000).toFixed(2);
            tooltipHtml += '<div class="tt-rar">RaR: ' + rarM + ' M LKR</div>';
        }

        if (site.cf_status) {
            var cfColor = site.cf_status.toLowerCase() === 'warning' ? '#FFC107' : '#66BB6A';
            tooltipHtml += '<div class="tt-detail">CF: <span style="color:' + cfColor + ';">' + site.cf_status + '</span></div>';
        }

        marker.bindTooltip(tooltipHtml, {
            permanent: false,
            direction: 'top',
            className: 'leaflet-tooltip-custom',
            offset: [0, -radius]
        });

        marker.addTo(self.layerGroup);
        bounds.push([lat, lon]);
    });

    if (bounds.length > 1) {
        self.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } else if (bounds.length === 1) {
        self.map.setView(bounds[0], 10);
    }

    var statsHtml =
        '<span class="stat-ok">' + countOk + '</span> | ' +
        '<span class="stat-warn">' + countWarn + '</span> | ' +
        '<span class="stat-fault">' + countFault + '</span>';
    $el.find('.js-stats').html(statsHtml);

    if (self.ctx.detectChanges) { self.ctx.detectChanges(); }
}

// ============================================================
// EMPTY / LOADING STATES
// ============================================================
function renderEmptyState(renderToken, reason, details) {
    if (self.layerGroup) { self.layerGroup.clearLayers(); }
    self.ctx.$widget.find('.js-stats').html(
        '<span class="stat-ok">0</span> | ' +
        '<span class="stat-warn">0</span> | ' +
        '<span class="stat-fault">0</span>'
    );
    if (reason) {
        debugWarn(renderToken, 'empty_state', {
            reason: reason,
            details: details || {}
        });
    }
    if (self.ctx.detectChanges) { self.ctx.detectChanges(); }
}

function setLoadingState(isLoading) {
    if (isLoading) {
        self.ctx.$widget.find('.js-stats').html(
            '<span style="color:#90A4AE; font-style:italic;">Loading...</span>'
        );
    }
}

// ============================================================
// RESPONSIVE SCALING
// ============================================================
self.onResize = function () {
    var $el = self.ctx.$widget;
    var $card = $el.find('.map-card');
    var w = $el.width();
    var h = $el.height();

    var fromWidth = w / 30;
    var fromHeight = h / 16;
    var fontSize = Math.min(fromWidth, fromHeight);
    if (fontSize < 8) { fontSize = 8; }
    if (fontSize > 20) { fontSize = 20; }
    $card.css('font-size', fontSize + 'px');

    if (self.map) { self.map.invalidateSize(); }
};

// ============================================================
// CLEANUP
// ============================================================
self.onDestroy = function () {
    self._pendingRender = null;
    if (self.map) {
        self.map.remove();
        self.map = null;
    }
    self.layerGroup = null;
};
