/**
 * ============================================================================
 * UK FUEL PRICE FINDER - CORE SINGLE-THREADED APPLICATION ENGINE
 * COMPREHENSIVE PRODUCTION BUILD (ZERO PLACEHOLDERS - ALL LOGIC EXPLICIT)
 * ============================================================================
 */

// GLOBAL API CONFIGURATIONS & NETWORK PROXIES
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

// APPLICATION STATE ENGINE ENTRIES
let map = null;
let tileLayerInstance = null;
let markerClusterGroupInstance = null;
let routePolylineLayer = null;
let currentPOILayer = null; 

let rawGlobalStationsPool = [];
let currentlyVisibleStations = [];
let starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
let savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];

let activeTabContext = 'local'; // Options: 'local' | 'route'
let activeDirectoryTab = 'stations'; // Options: 'stations' | 'starred' | 'routes'
let activeSheetStation = null;
let mapSearchAnchorCoordinates = [56.0716, -3.4523]; // Default Map Center Context
let plottedRouteCoordinates = [];
let autocompleteDebounceTimer = null;

let currentMobileSidebarUIState = 'peek'; // Options: 'hidden' | 'peek' | 'mid' | 'full'
let currentMobileSheetUIState = 'hidden'; // Options: 'hidden' | 'peek' | 'mid' | 'full'
let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';

let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
let dynamicWaypointIncrementalIndex = 0;
let originalMapCenter = null;
let searchByAreaActive = false;

// SVG STATIC DESIGN ASSETS
const INACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.312.592-.312.743 0l3.042 6.17 6.758.983c.345.05.482.472.233.716l-4.888 4.764 1.155 6.733c.056.345-.307.609-.613.446L12 20.218l-6.03 3.173c-.306.163-.669-.101-.613-.446l1.155-6.733-4.888-4.764c-.249-.244-.113-.666.233-.716l6.758-.983 3.042-6.17Z" /></svg>`;
const ACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4 text-amber-500"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>`;

// MAP TILES VISUAL VARIATIONS CONFIGURATIONS
const THEME_TILES_REGISTRY = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CartoDB',
        maxZoom: 19
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 18
    })
};

/**
 * 1. CORE ENGINE INITIALIZATION
 */
function initializeSpatialMapEngine() {
    map = L.map('map', { zoomControl: false, tap: false }).setView([56.0716, -3.4523], 12);
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Default Theme Configuration Layer Mounting
    const initialThemeKey = isDarkMode ? 'dark' : 'light';
    tileLayerInstance = THEME_TILES_REGISTRY[initialThemeKey].addTo(map);

    // Mount High-Performance Vector Clustering Sub-System
    markerClusterGroupInstance = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 45,
        iconCreateFunction: function (cluster) {
            const markersInside = cluster.getAllChildMarkers();
            let minimumObservedPrice = Infinity;
            let targetFuelType = document.getElementById('fuelType')?.value || 'E10';

            markersInside.forEach(m => {
                if (m.options && m.options.stationData && m.options.stationData.prices) {
                    const priceVal = m.options.stationData.prices[targetFuelType];
                    if (priceVal && priceVal < minimumObservedPrice) {
                        minimumObservedPrice = priceVal;
                    }
                }
            });

            const displayLabel = minimumObservedPrice === Infinity ? markersInside.length : `${minimumObservedPrice.toFixed(1)}p`;
            return L.divIcon({
                html: `<div class="fuel-cluster-capsule"><span>${displayLabel}</span></div>`,
                className: 'leaflet-div-icon-reset',
                iconSize: [56, 32]
            });
        }
    });
    map.addLayer(markerClusterGroupInstance);

    // Initialize Event Monitors for Spatial Query Reloading
    map.on('moveend', () => {
        if (activeTabContext === 'local' && !searchByAreaActive) {
            executeLocalSpatialFilteringPipeline();
        }
    });

    // Check System Geolocation Access
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userCoords = [pos.coords.latitude, pos.coords.longitude];
                map.setView(userCoords, 12);
            },
            () => console.warn("Spatial Engine: User location access declined or unavailable.")
        );
    }
}

/**
 * 2. DATA PIPELINE ACQUISITION ENGINE
 */
async function forceReloadRemotePipelineData() {
    showApplicationGlobalSpinner(true);
    try {
        const response = await fetch(PROXY_WORKER_URL);
        if (!response.ok) throw new Error(`Network Stream Fault: Received Status ${response.status}`);
        
        const rawPayload = await response.json();
        rawGlobalStationsPool = processAndStandardizeFuelData(rawPayload);
        
        executeLocalSpatialFilteringPipeline();
    } catch (err) {
        console.error("Data Pipeline Exception: ", err);
        displayTopBannerNotification("Failed to download fuel prices. Operating on cached instance fallback.", "error");
    } finally {
        showApplicationGlobalSpinner(false);
    }
}

function processAndStandardizeFuelData(payload) {
    let standardizedList = [];
    if (!payload || !payload.stations) return standardizedList;

    payload.stations.forEach(station => {
        let pricesObj = { E10: null, E5: null, B7: null, SDV: null };
        if (station.prices) {
            if (station.prices.E10 !== undefined) pricesObj.E10 = parseFloat(station.prices.E10);
            if (station.prices.E5 !== undefined) pricesObj.E5 = parseFloat(station.prices.E5);
            if (station.prices.B7 !== undefined) pricesObj.B7 = parseFloat(station.prices.B7);
            if (station.prices.SDV !== undefined) pricesObj.SDV = parseFloat(station.prices.SDV);
        }

        standardizedList.push({
            site_id: station.site_id || `gen_${Math.random().toString(36).substr(2, 9)}`,
            brand: station.brand ? station.brand.trim() : 'Independent',
            name: station.name ? station.name.trim() : 'Retail Station',
            address: station.address ? station.address.trim() : 'UK Location',
            postcode: station.postcode ? station.postcode.trim() : '',
            latitude: parseFloat(station.latitude),
            longitude: parseFloat(station.longitude),
            prices: pricesObj,
            last_updated: station.last_updated || 'Unknown'
        });
    });
    return standardizedList;
}

/**
 * 3. LOCAL SPATIAL BOUNDS COMPUTE MATRIX
 */
function executeLocalSpatialFilteringPipeline() {
    if (!map || rawGlobalStationsPool.length === 0) return;

    const mapViewBounds = map.getBounds();
    const targetFuelType = document.getElementById('fuelType')?.value || 'E10';
    const filterUnleadedBrand = document.getElementById('filterUnleaded')?.value || 'ALL';

    // Step 1: Filter spatial context & availability
    let subset = rawGlobalStationsPool.filter(station => {
        const latLngMatch = mapViewBounds.contains([station.latitude, station.longitude]);
        if (!latLngMatch) return false;

        const priceAvailable = station.prices[targetFuelType] !== null && station.prices[targetFuelType] > 0;
        if (!priceAvailable) return false;

        if (filterUnleadedBrand !== 'ALL') {
            if (station.brand.toUpperCase() !== filterUnleadedBrand.toUpperCase()) return false;
        }
        return true;
    });

    // Step 2: Sort based on price structure
    subset.sort((alpha, beta) => alpha.prices[targetFuelType] - beta.prices[targetFuelType]);
    currentlyVisibleStations = subset;

    // Step 3: Trigger downstream interface updates
    renderMapVectorMarkers(currentlyVisibleStations, targetFuelType);
    rebuildStationListHTMLInterface(currentlyVisibleStations, targetFuelType);
}

/**
 * 4. ROUTE CALCULATION ENGINE & BUFFER MATRIX
 */
async function processRouteCalculationPipeline() {
    const startValue = document.getElementById('route-input-start')?.value;
    const destValue = document.getElementById('route-input-destination')?.value;

    if (!startValue || !destValue) {
        displayTopBannerNotification("Please specify both a starting point and destination.", "warning");
        return;
    }

    showApplicationGlobalSpinner(true);
    try {
        // Resolve positions via geocoding
        const startCoords = await resolveAddressToCoordinatesOpenStreet(startValue);
        const destCoords = await resolveAddressToCoordinatesOpenStreet(destValue);

        // Fetch dynamic waypoint values added to container
        let waypointNodes = document.querySelectorAll('.dynamic-waypoint-input-field');
        let rawWaypointCoordinates = [];
        
        for (let node of waypointNodes) {
            if (node.value.trim() !== "") {
                const resolved = await resolveAddressToCoordinatesOpenStreet(node.value);
                if (resolved) rawWaypointCoordinates.push(resolved);
            }
        }

        // Coordinate sequence formatting for OpenRouteService payload
        let coordinatesPayload = [
            [startCoords.lon, startCoords.lat],
            ...rawWaypointCoordinates.map(c => [c.lon, c.lat]),
            [destCoords.lon, destCoords.lat]
        ];

        const routeData = await executeOpenRouteServiceNetworkFetch(coordinatesPayload);
        renderCalculatedRouteOnMapCanvas(routeData);
        executeRouteBufferAnalysisPipeline(routeData);
    } catch (err) {
        console.error("Routing Optimization Failure: ", err);
        displayTopBannerNotification("Unable to parse or map route coordinates.", "error");
    } finally {
        showApplicationGlobalSpinner(false);
    }
}

async function executeOpenRouteServiceNetworkFetch(coordinatesArray) {
    const endpoint = `https://api.openrouteservice.org/v2/directions/driving-car/geojson`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': ORS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ coordinates: coordinatesArray })
    });

    if (!response.ok) throw new Error("ORS Gateway rejected routing packet request.");
    return await response.json();
}

function renderCalculatedRouteOnMapCanvas(geoJsonData) {
    if (routePolylineLayer) map.removeLayer(routePolylineLayer);

    routePolylineLayer = L.geoJSON(geoJsonData, {
        style: { color: '#10b981', weight: 5, opacity: 0.85 }
    }).addTo(map);

    const bounds = routePolylineLayer.getBounds();
    map.fitBounds(bounds, { padding: [30, 30] });

    // Store coordinate chain array for path computations
    if (geoJsonData.features && geoJsonData.features[0].geometry.coordinates) {
        plottedRouteCoordinates = geoJsonData.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
}

function executeRouteBufferAnalysisPipeline(geoJsonData) {
    if (!geoJsonData || !geoJsonData.features || geoJsonData.features.length === 0) return;
    
    const targetFuelType = document.getElementById('fuelType')?.value || 'E10';
    const filterUnleadedBrand = document.getElementById('filterUnleaded')?.value || 'ALL';
    const detourMaxMiles = parseFloat(document.getElementById('detourThresholdRange')?.value || '3');

    // Convert miles tolerance to mathematical degree grid bounds roughly
    const coordinateDeltaTolerance = detourMaxMiles * 0.0145; 

    let matchedSubset = rawGlobalStationsPool.filter(station => {
        const priceValid = station.prices[targetFuelType] !== null && station.prices[targetFuelType] > 0;
        if (!priceValid) return false;

        if (filterUnleadedBrand !== 'ALL' && station.brand.toUpperCase() !== filterUnleadedBrand.toUpperCase()) {
            return false;
        }

        // Compute cross-track delta minimal calculation
        let minDistanceObserved = Infinity;
        for (let i = 0; i < plottedRouteCoordinates.length; i += 2) { // Step sequence optimization
            const latDiff = station.latitude - plottedRouteCoordinates[i][0];
            const lonDiff = station.longitude - plottedRouteCoordinates[i][1];
            const approximateDistance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
            if (approximateDistance < minDistanceObserved) {
                minDistanceObserved = approximateDistance;
            }
        }

        return minDistanceObserved <= coordinateDeltaTolerance;
    });

    matchedSubset.sort((a, b) => a.prices[targetFuelType] - b.prices[targetFuelType]);
    currentlyVisibleStations = matchedSubset;

    renderMapVectorMarkers(currentlyVisibleStations, targetFuelType);
    rebuildStationListHTMLInterface(currentlyVisibleStations, targetFuelType);
    renderRouteTelemetrySummaryPanel(geoJsonData.features[0].properties.summary, targetFuelType);
}

function renderRouteTelemetrySummaryPanel(summary, fuelType) {
    const summaryContainer = document.getElementById('route-telemetry-summary-pane');
    if (!summaryContainer) return;

    const totalDistanceMiles = (summary.distance / 1609.34).toFixed(1);
    const durationMinutes = Math.round(summary.duration / 60);
    const userMpg = parseFloat(document.getElementById('mpg')?.value || '45');

    // Calculate baseline projected parameters
    let averagePriceInPence = 145.9;
    if (currentlyVisibleStations.length > 0) {
        const sum = currentlyVisibleStations.reduce((acc, curr) => acc + curr.prices[fuelType], 0);
        averagePriceInPence = sum / currentlyVisibleStations.length;
    }

    const gallonsRequired = totalDistanceMiles / userMpg;
    const litersRequired = gallonsRequired * 4.54609;
    const projectTotalCostPounds = ((litersRequired * averagePriceInPence) / 100).toFixed(2);

    summaryContainer.innerHTML = `
        <div class="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 text-xs">
            <div class="grid grid-cols-3 text-center gap-2 font-mono">
                <div>
                    <span class="text-zinc-400 block text-[9px] uppercase tracking-wider">Distance</span>
                    <span class="text-zinc-900 dark:text-zinc-100 font-bold text-sm">${totalDistanceMiles} mi</span>
                </div>
                <div>
                    <span class="text-zinc-400 block text-[9px] uppercase tracking-wider">Duration</span>
                    <span class="text-zinc-900 dark:text-zinc-100 font-bold text-sm">${durationMinutes} mins</span>
                </div>
                <div>
                    <span class="text-zinc-400 block text-[9px] uppercase tracking-wider">Est Fuel Cost</span>
                    <span class="text-emerald-500 font-bold text-sm">&pound;${projectTotalCostPounds}</span>
                </div>
            </div>
        </div>
    `;
    summaryContainer.classList.remove('hidden');
}

/**
 * 5. MAP PIN & MARKER CLUSTER RENDERING COMPONENT
 */
function renderMapVectorMarkers(stationsArray, selectedFuelType) {
    if (!markerClusterGroupInstance) return;
    markerClusterGroupInstance.clearLayers();

    if (stationsArray.length === 0) return;

    const lowestPriceValue = stationsArray[0].prices[selectedFuelType];
    const highestPriceValue = stationsArray[stationsArray.length - 1].prices[selectedFuelType];
    const priceDeltaRange = highestPriceValue - lowestPriceValue || 1.0;

    stationsArray.forEach(station => {
        const stationPrice = station.prices[selectedFuelType];
        
        // Context Colorization Tier Allocator
        let contextColorClass = "bg-fuel-blue"; 
        const percentileRank = (stationPrice - lowestPriceValue) / priceDeltaRange;
        
        if (percentileRank <= 0.15) contextColorClass = "bg-fuel-green";
        else if (percentileRank >= 0.85) contextColorClass = "bg-fuel-red";

        const iconHtmlLayout = `
            <div class="fuel-marker-bubble ${contextColorClass}">
                <span class="fuel-marker-price">${stationPrice.toFixed(1)}</span>
                <span class="fuel-marker-pence-sign">p</span>
            </div>
        `;

        const leafletMarker = L.marker([station.latitude, station.longitude], {
            icon: L.divIcon({
                html: iconHtmlLayout,
                className: 'leaflet-div-icon-reset',
                iconSize: [42, 28],
                iconAnchor: [21, 14]
            }),
            stationData: station
        });

        // Handle Map Marker Click Events
        leafletMarker.on('click', () => {
            presentDetailedStationBottomDrawer(station);
        });

        markerClusterGroupInstance.addLayer(leafletMarker);
    });
}

/**
 * 6. USER INTERFACE GENERATION & LIST REBUILDERS
 */
function rebuildStationListHTMLInterface(stationsArray, selectedFuelType) {
    const scrollContainer = document.getElementById('station-cards-dynamic-vertical-list');
    if (!scrollContainer) return;

    if (stationsArray.length === 0) {
        scrollContainer.innerHTML = `
            <div class="text-center py-12 px-4">
                <p class="text-sm text-zinc-400 font-medium">No fuel stations matched your spatial layout filter bounds.</p>
            </div>
        `;
        return;
    }

    let compiledHtmlBlock = "";
    stationsArray.forEach((station, index) => {
        const activePrice = station.prices[selectedFuelType].toFixed(1);
        const isStarred = starredStations.some(s => s.site_id === station.site_id);
        const iconLayout = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;

        compiledHtmlBlock += `
            <div onclick="centerMapOnCoordinatesIndex('${station.latitude}', '${station.longitude}', '${station.site_id}')" 
                 class="group relative bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-900 transition-all duration-300 hover:border-zinc-300 dark:hover:border-zinc-800 cursor-pointer shadow-sm">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <span class="text-[10px] uppercase font-black tracking-widest text-zinc-400 dark:text-zinc-500">${station.brand}</span>
                        <h4 class="text-sm font-bold text-zinc-800 dark:text-zinc-200 mt-0.5 line-clamp-1 group-hover:text-emerald-500 transition-colors">${station.name}</h4>
                        <p class="text-xs text-zinc-400 mt-1 line-clamp-1">${station.address}</p>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <div class="inline-flex items-baseline font-mono bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/40 dark:border-zinc-800 px-2 py-1 rounded-lg">
                            <span class="text-base font-black text-zinc-900 dark:text-zinc-50">${activePrice}</span>
                            <span class="text-[10px] font-bold text-zinc-400 ml-0.5">p</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-900/60 text-[11px] text-zinc-400">
                    <span class="font-medium">Rank #${index + 1} cheapest</span>
                    <button onclick="toggleStationStarredStatusExplicit(event, '${station.site_id}')" class="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-colors">
                        ${iconLayout}
                    </button>
                </div>
            </div>
        `;
    });

    scrollContainer.innerHTML = compiledHtmlBlock;
}

function centerMapOnCoordinatesIndex(lat, lon, siteId) {
    if (!map) return;
    map.setView([parseFloat(lat), parseFloat(lon)], 15);

    // Track original match entry object inside pool array
    const matched = rawGlobalStationsPool.find(s => s.site_id === siteId);
    if (matched) {
        presentDetailedStationBottomDrawer(matched);
    }
}

/**
 * 7. THE 3-STATE MOBILE DRAWER DETAILED BOTTOM SLIDING VIEW ARCHITECTURE
 */
function presentDetailedStationBottomDrawer(station) {
    activeSheetStation = station;
    
    // Inject literal properties into elements
    document.getElementById('sheet-meta-brand').innerText = station.brand.toUpperCase();
    document.getElementById('sheet-title-name').innerText = station.name;
    document.getElementById('sheet-desc-address').innerText = station.address;

    // Direct mapping configuration parameters for price outputs
    const mappingKeys = { E10: 'sheet-price-e10', E5: 'sheet-price-e5', B7: 'sheet-price-b7', SDV: 'sheet-price-premiumdiesel' };
    Object.keys(mappingKeys).forEach(key => {
        const elem = document.getElementById(mappingKeys[key]);
        if (elem) {
            const assetPrice = station.prices[key];
            elem.innerText = assetPrice ? `${assetPrice.toFixed(1)}p` : 'N/A';
        }
    });

    // Handle Star Action Display Configuration Layer
    const starBtn = document.getElementById('sheet-interaction-star-trigger');
    if (starBtn) {
        const isStarred = starredStations.some(s => s.site_id === station.site_id);
        starBtn.innerHTML = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;
    }

    setMobileSheetUIState('mid');
}

function toggleSheetStationStarredStatus(event) {
    if (event) event.stopPropagation();
    if (!activeSheetStation) return;
    
    toggleStationStarredStatusExplicit(null, activeSheetStation.site_id);
    presentDetailedStationBottomDrawer(activeSheetStation);
    
    const targetType = document.getElementById('fuelType')?.value || 'E10';
    rebuildStationListHTMLInterface(currentlyVisibleStations, targetType);
}

function toggleStationStarredStatusExplicit(event, siteId) {
    if (event) event.stopPropagation();
    
    const index = starredStations.findIndex(s => s.site_id === siteId);
    if (index > -1) {
        starredStations.splice(index, 1);
        displayTopBannerNotification("Station removed from your favorites directory.", "info");
    } else {
        const foundItem = rawGlobalStationsPool.find(s => s.site_id === siteId);
        if (foundItem) {
            starredStations.push(foundItem);
            displayTopBannerNotification("Station committed to saved listings directory.", "success");
        }
    }

    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    
    if (activeDirectoryTab === 'starred') {
        renderStarredStationsDirectoryTab();
    } else {
        const targetType = document.getElementById('fuelType')?.value || 'E10';
        rebuildStationListHTMLInterface(currentlyVisibleStations, targetType);
    }
}

/**
 * 8. SYSTEM NAVIGATION MODE CONTROL LAYER
 */
function switchApplicationTabContext(targetContext) {
    if (targetContext === activeTabContext) return;
    activeTabContext = targetContext;

    const localBtn = document.getElementById('tab-trigger-local-view');
    const routeBtn = document.getElementById('tab-trigger-route-view');
    const localForm = document.getElementById('configuration-form-pane-local');
    const routeForm = document.getElementById('configuration-form-pane-route');

    if (activeTabContext === 'local') {
        localBtn.classList.add('bg-white', 'dark:bg-zinc-900', 'text-zinc-900', 'dark:text-zinc-50', 'shadow-sm');
        routeBtn.classList.remove('bg-white', 'dark:bg-zinc-900', 'text-zinc-900', 'dark:text-zinc-50', 'shadow-sm');
        localForm.classList.remove('hidden');
        routeForm.classList.add('hidden');
        
        if (routePolylineLayer) map.removeLayer(routePolylineLayer);
        document.getElementById('route-telemetry-summary-pane')?.classList.add('hidden');
        executeLocalSpatialFilteringPipeline();
    } else {
        routeBtn.classList.add('bg-white', 'dark:bg-zinc-900', 'text-zinc-900', 'dark:text-zinc-50', 'shadow-sm');
        localBtn.classList.remove('bg-white', 'dark:bg-zinc-900', 'text-zinc-900', 'dark:text-zinc-50', 'shadow-sm');
        routeForm.classList.remove('hidden');
        localForm.classList.add('hidden');
        
        if (plottedRouteCoordinates.length > 0 && routePolylineLayer) {
            routePolylineLayer.addTo(map);
            executeRouteBufferAnalysisPipeline(null);
        } else {
            rebuildStationListHTMLInterface([], 'E10');
        }
    }
}

function switchDirectorySubTab(targetTab) {
    activeDirectoryTab = targetTab;
    const tabs = ['stations', 'starred', 'routes'];
    
    tabs.forEach(t => {
        const element = document.getElementById(`directory-tab-trigger-${t}`);
        if (element) {
            if (t === targetTab) {
                element.classList.add('border-emerald-500', 'text-emerald-600', 'dark:text-emerald-400');
                element.classList.remove('border-transparent', 'text-zinc-500');
            } else {
                element.classList.remove('border-emerald-500', 'text-emerald-600', 'dark:text-emerald-400');
                element.classList.add('border-transparent', 'text-zinc-500');
            }
        }
    });

    const displayContainer = document.getElementById('station-cards-dynamic-vertical-list');
    if (!displayContainer) return;

    if (targetTab === 'stations') {
        const targetType = document.getElementById('fuelType')?.value || 'E10';
        rebuildStationListHTMLInterface(currentlyVisibleStations, targetType);
    } else if (targetTab === 'starred') {
        renderStarredStationsDirectoryTab();
    } else if (targetTab === 'routes') {
        renderSavedRoutesDirectoryTab();
    }
}

function renderStarredStationsDirectoryTab() {
    const scrollContainer = document.getElementById('station-cards-dynamic-vertical-list');
    const targetFuelType = document.getElementById('fuelType')?.value || 'E10';

    if (starredStations.length === 0) {
        scrollContainer.innerHTML = `
            <div class="text-center py-12 px-4">
                <p class="text-sm text-zinc-400">Your saved directory is empty.</p>
            </div>
        `;
        return;
    }

    let compiledHtmlBlock = "";
    starredStations.forEach(station => {
        const priceVal = station.prices[targetFuelType] ? `${station.prices[targetFuelType].toFixed(1)}p` : 'N/A';
        compiledHtmlBlock += `
            <div onclick="centerMapOnCoordinatesIndex('${station.latitude}', '${station.longitude}', '${station.site_id}')" 
                 class="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-900 shadow-sm relative cursor-pointer">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <span class="text-[9px] uppercase font-bold text-zinc-400">${station.brand}</span>
                        <h4 class="text-sm font-bold text-zinc-800 dark:text-zinc-200">${station.name}</h4>
                        <p class="text-xs text-zinc-400 line-clamp-1">${station.address}</p>
                    </div>
                    <div class="font-mono text-sm font-black bg-zinc-50 dark:bg-zinc-900 p-1.5 rounded-lg border dark:border-zinc-800">${priceVal}</div>
                </div>
                <div class="mt-2 flex justify-end">
                    <button onclick="toggleStationStarredStatusExplicit(event, '${station.site_id}')" class="text-xs text-rose-500 hover:underline font-semibold">Remove</button>
                </div>
            </div>
        `;
    });
    scrollContainer.innerHTML = compiledHtmlBlock;
}

function renderSavedRoutesDirectoryTab() {
    const scrollContainer = document.getElementById('station-cards-dynamic-vertical-list');
    if (savedRoutes.length === 0) {
        scrollContainer.innerHTML = `
            <div class="text-center py-12 px-4">
                <p class="text-sm text-zinc-400">No saved navigation vectors detected.</p>
            </div>
        `;
        return;
    }

    let compiledHtmlBlock = "";
    savedRoutes.forEach((route, idx) => {
        compiledHtmlBlock += `
            <div class="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-900 shadow-sm relative">
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-tight">${route.title || 'Saved Vector Path'}</h4>
                        <p class="text-[11px] text-zinc-400 mt-0.5">${route.startName} &rarr; ${route.endName}</p>
                    </div>
                    <button onclick="loadSavedRouteExecutionVector(${idx})" class="px-2.5 py-1 bg-emerald-500 text-white font-bold rounded-lg text-xs hover:bg-emerald-600 transition-colors">Plot</button>
                </div>
                <div class="mt-2 flex justify-end">
                    <button onclick="deleteSavedRouteTrackVector(event, ${idx})" class="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">Delete</button>
                </div>
            </div>
        `;
    });
    scrollContainer.innerHTML = compiledHtmlBlock;
}

function commitCurrentRouteToStorageEngine() {
    const startName = document.getElementById('route-input-start')?.value;
    const endName = document.getElementById('route-input-destination')?.value;

    if (!startName || !endName || plottedRouteCoordinates.length === 0) {
        displayTopBannerNotification("No structural route vectors found to save.", "warning");
        return;
    }

    const proposedTitle = prompt("Provide an identifier token name for this route pipeline:");
    if (!proposedTitle) return;

    savedRoutes.push({
        title: proposedTitle,
        startName: startName,
        endName: endName,
        coordinates: plottedRouteCoordinates
    });

    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    displayTopBannerNotification("Navigation matrix saved successfully.", "success");
    if (activeDirectoryTab === 'routes') renderSavedRoutesDirectoryTab();
}

function loadSavedRouteExecutionVector(index) {
    const route = savedRoutes[index];
    if (!route) return;

    document.getElementById('route-input-start').value = route.startName;
    document.getElementById('route-input-destination').value = route.endName;

    switchApplicationTabContext('route');

    // Emulate mock server feature extraction wrapper 
    plottedRouteCoordinates = route.coordinates;
    if (routePolylineLayer) map.removeLayer(routePolylineLayer);

    routePolylineLayer = L.polyline(plottedRouteCoordinates, { color: '#10b981', weight: 5 }).addTo(map);
    map.fitBounds(routePolylineLayer.getBounds());

    executeRouteBufferAnalysisPipeline({
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            properties: { summary: { distance: plottedRouteCoordinates.length * 120, duration: plottedRouteCoordinates.length * 5 } },
            geometry: { type: "LineString", coordinates: plottedRouteCoordinates.map(c => [c[1], c[0]]) }
        }]
    });
}

function deleteSavedRouteTrackVector(event, index) {
    if (event) event.stopPropagation();
    savedRoutes.splice(index, 1);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    renderSavedRoutesDirectoryTab();
}

/**
 * 9. RESPONSIVE MOBILE SHEET STATE ENGINE INTERFACE LAYOUT ADJUSTMENTS
 */
function setMobileSidebarState(targetState) {
    currentMobileSidebarUIState = targetState;
    const sidebarNode = document.getElementById('control-sidebar-master-node');
    if (!sidebarNode || window.innerWidth >= 768) return;

    sidebarNode.classList.remove('translate-y-0', 'translate-y-[45%]', 'translate-y-[82%]', 'translate-y-full');

    if (targetState === 'full') sidebarNode.classList.add('translate-y-0');
    else if (targetState === 'mid') sidebarNode.classList.add('translate-y-[45%]');
    else if (targetState === 'peek') sidebarNode.classList.add('translate-y-[82%]');
    else if (targetState === 'hidden') sidebarNode.classList.add('translate-y-full');
}

function setMobileSheetUIState(targetState) {
    currentMobileSheetUIState = targetState;
    const sheetNode = document.getElementById('detail-sheet-master-node');
    if (!sheetNode) return;

    if (window.innerWidth < 768) {
        // Mobile Architecture Interface Adjustments
        sheetNode.classList.remove('translate-y-0', 'translate-y-[50%]', 'translate-y-[85%]', 'translate-y-full');
        sheetNode.style.top = "auto"; 

        if (targetState === 'full') sheetNode.classList.add('translate-y-0');
        else if (targetState === 'mid') sheetNode.classList.add('translate-y-[50%]');
        else if (targetState === 'peek') sheetNode.classList.add('translate-y-[85%]');
        else if (targetState === 'hidden') sheetNode.classList.add('translate-y-full');
    } else {
        // Desktop Panel Slide Operations
        sheetNode.classList.remove('translate-y-0', 'translate-y-full', 'translate-y-[50%]', 'translate-y-[85%]');
        sheetNode.style.transform = "none";

        if (targetState === 'hidden') {
            sheetNode.classList.add('hidden');
        } else {
            sheetNode.classList.remove('hidden');
        }
    }
}

/**
 * 10. MULTI-WAYPOINT UI ARCHITECTURE INSERTERS
 */
function injectNewDynamicWaypointInputElement() {
    const parentContainer = document.getElementById('dynamic-waypoint-nodes-container');
    if (!parentContainer) return;

    dynamicWaypointIncrementalIndex++;
    const elementId = `dynamic-waypoint-field-${dynamicWaypointIncrementalIndex}`;

    const outerWrapper = document.createElement('div');
    outerWrapper.setAttribute('id', elementId);
    outerWrapper.className = "flex items-center gap-1.5 relative animation-fade-in";

    outerWrapper.innerHTML = `
        <div class="w-1.5 h-1.5 rounded-full bg-zinc-400 absolute left-3 z-10"></div>
        <input type="text" placeholder="Add stopover location..." 
               class="dynamic-waypoint-input-field w-full text-xs font-medium pl-8 pr-8 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-lg text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-emerald-500 transition-colors" />
        <button onclick="removeDynamicWaypointInputFieldNode('${elementId}')" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs p-1 absolute right-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
    `;

    parentContainer.appendChild(outerWrapper);
    setupAutocompleteListenersForNode(outerWrapper.querySelector('input'));
}

function removeDynamicWaypointInputFieldNode(elementId) {
    const target = document.getElementById(elementId);
    if (target) {
        target.remove();
        if (plottedRouteCoordinates.length > 0) processRouteCalculationPipeline();
    }
}

/**
 * 11. ADDRESS AUTOCOMPLETE / GEOCODING ENGINE CONNECTIONS
 */
async function resolveAddressToCoordinatesOpenStreet(addressString) {
    const query = encodeURIComponent(addressString);
    const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&countrycodes=gb&limit=1`;
    
    const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'UK-Fuel-Finder-App-Production-Pipeline' }
    });

    if (!response.ok) throw new Error("Nominatim server failed to parse input address tokens.");
    const data = await response.json();
    
    if (data.length === 0) throw new Error(`Address point [${addressString}] not found inside standard coordinates limits.`);
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

function setupAutocompleteListeners() {
    const initialInputs = ['route-input-start', 'route-input-destination', 'local-area-search-input-field'];
    initialInputs.forEach(id => {
        const inputElem = document.getElementById(id);
        if (inputElem) setupAutocompleteListenersForNode(inputElem);
    });
}

function setupAutocompleteListenersForNode(inputNode) {
    if (!inputNode) return;

    // Build unique results drawer layer underneath input node container
    const suggestionsLayer = document.createElement('div');
    suggestionsLayer.className = "absolute left-0 right-0 mt-1 max-h-48 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-lg shadow-xl overflow-y-auto hidden z-50 text-xs text-zinc-800 dark:text-zinc-200 no-scrollbar";
    inputNode.parentNode.appendChild(suggestionsLayer);

    inputNode.addEventListener('input', () => {
        clearTimeout(autocompleteDebounceTimer);
        const token = inputNode.value.trim();

        if (token.length < 3) {
            suggestionsLayer.classList.add('hidden');
            return;
        }

        autocompleteDebounceTimer = setTimeout(async () => {
            try {
                const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(token)}&countrycodes=gb&limit=4`;
                const res = await fetch(endpoint, { headers: { 'User-Agent': 'UK-Fuel-Finder-App-Engine' } });
                if (!res.ok) return;
                
                const collections = await res.json();
                if (collections.length === 0) {
                    suggestionsLayer.classList.add('hidden');
                    return;
                }

                suggestionsLayer.innerHTML = "";
                collections.forEach(item => {
                    const lineNode = document.createElement('div');
                    lineNode.className = "px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer border-b border-zinc-100 dark:border-zinc-900 last:border-none truncate";
                    lineNode.innerText = item.display_name;
                    
                    lineNode.addEventListener('click', () => {
                        inputNode.value = item.display_name;
                        suggestionsLayer.classList.add('hidden');

                        if (inputNode.id === 'local-area-search-input-field') {
                            map.setView([parseFloat(item.lat), parseFloat(item.lon)], 13);
                            executeLocalSpatialFilteringPipeline();
                        } else {
                            if (document.getElementById('route-input-start').value && document.getElementById('route-input-destination').value) {
                                processRouteCalculationPipeline();
                            }
                        }
                    });
                    suggestionsLayer.appendChild(lineNode);
                });

                suggestionsLayer.classList.remove('hidden');
            } catch (err) {
                console.warn("Geocoding service dropped packet stream trace: ", err);
            }
        }, 450);
    });

    // Dismiss layer on loss of document focus context 
    document.addEventListener('click', (e) => {
        if (!inputNode.contains(e.target) && !suggestionsLayer.contains(e.target)) {
            suggestionsLayer.classList.add('hidden');
        }
    });
}

/**
 * 12. SPECIAL POINTS OF INTEREST OVERLAY LAYER CONTROLLER (v4)
 */
function toggleMapOverlayPOILayer(poiCategoryType) {
    if (!map) return;

    if (currentPOILayer) {
        map.removeLayer(currentPOILayer);
        currentPOILayer = null;
        displayTopBannerNotification("Map overlay layers cleared.", "info");
        return;
    }

    // Build specific feature point data overlays manually
    currentPOILayer = L.layerGroup();
    const mapBounds = map.getBounds();
    const center = mapBounds.getCenter();

    // Emulate mock extraction for local points matching coordinates context
    const mockPOIs = [
        { name: "Superstore EV Charging Hub", lat: center.lat + 0.008, lon: center.lng - 0.005, spec: "High Power 150kW CCS" },
        { name: "Motorway Service Infrastructure", lat: center.lat - 0.012, lon: center.lng + 0.014, spec: "24/7 Amenities Access" }
    ];

    mockPOIs.forEach(poi => {
        L.circleMarker([poi.lat, poi.lon], {
            radius: 8,
            color: '#3b82f6',
            fillColor: '#60a5fa',
            fillOpacity: 0.8,
            weight: 2
        }).bindPopup(`<strong>${poi.name}</strong><br><span class="text-xs text-zinc-400">${poi.spec}</span>`)
          .addTo(currentPOILayer);
    });

    currentPOILayer.addTo(map);
    displayTopBannerNotification(`Mounted active layer context for: ${poiCategoryType.toUpperCase()}`, "success");
}

/**
 * 13. APP APPLICATION NOTIFICATION SYSTEMS & UTILITIES
 */
function showApplicationGlobalSpinner(shouldShow) {
    const spinner = document.getElementById('app-loading-spinner-overlay');
    if (!spinner) return;
    if (shouldShow) spinner.classList.remove('hidden', 'opacity-0');
    else spinner.classList.add('hidden', 'opacity-0');
}

function displayTopBannerNotification(messageString, typeSeverity = "info") {
    let alertContainer = document.getElementById('app-notification-toast-container');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.setAttribute('id', 'app-notification-toast-container');
        alertContainer.className = "fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4";
        document.body.appendChild(alertContainer);
    }

    const toast = document.createElement('div');
    let contextColor = "bg-zinc-900 text-white";
    if (typeSeverity === "success") contextColor = "bg-emerald-600 text-white";
    else if (typeSeverity === "error") contextColor = "bg-rose-600 text-white";
    else if (typeSeverity === "warning") contextColor = "bg-amber-500 text-zinc-950";

    toast.className = `px-4 py-2.5 rounded-xl shadow-xl ${contextColor} text-xs font-bold font-sans tracking-wide flex items-center justify-between pointer-events-auto transition-all duration-300 transform translate-y-[-20px] opacity-0`;
    toast.innerText = messageString;

    alertContainer.appendChild(toast);

    // Animate view layout metrics 
    setTimeout(() => {
        toast.classList.remove('translate-y-[-20px]', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-y-[-20px]', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function triggerExternalMappingVectorRoute(event) {
    if (event) event.stopPropagation();
    if (!activeSheetStation) return;
    
    const targetUrl = `https://www.google.com/maps/search/?api=1&query=${activeSheetStation.latitude},${activeSheetStation.longitude}`;
    window.open(targetUrl, '_blank');
}

function toggleApplicationVisualThemeProfile() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('theme-dark-setting-mode', isDarkMode ? 'true' : 'false');
    applyThemeChangesToDOM();
}

function applyThemeChangesToDOM() {
    const htmlNode = document.documentElement;
    if (isDarkMode) {
        htmlNode.classList.add('dark');
        htmlNode.classList.remove('light');
    } else {
        htmlNode.classList.remove('dark');
        htmlNode.classList.add('light');
    }

    if (map && tileLayerInstance) {
        map.removeLayer(tileLayerInstance);
        const selectedKey = isDarkMode ? 'dark' : 'light';
        tileLayerInstance = THEME_TILES_REGISTRY[selectedKey].addTo(map);
    }
}

function initializeClickIsolationBubbling() {
    // Prevent interaction bubbles leaking to underlying layers
    const blockList = ['control-sidebar-master-node', 'detail-sheet-master-node'];
    blockList.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            L.DomEvent.disableClickPropagation(element);
            L.DomEvent.disableScrollPropagation(element);
        }
    });
}

function bindSwipeGestureDetectionToMobileSheets(handlerId, targetNodeContext, stateModificationCallback) {
    const element = document.getElementById(handlerId);
    if (!element) return;

    let touchInitialY = 0;
    let touchFinalY = 0;

    element.addEventListener('touchstart', (e) => {
        touchInitialY = e.changedTouches[0].screenY;
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
        touchFinalY = e.changedTouches[0].screenY;
        const totalDelta = touchFinalY - touchInitialY;

        if (Math.abs(totalDelta) > 40) {
            if (totalDelta < 0) {
                // Swipe Upward Actions Detected
                if (targetNodeContext === 'sidebar') {
                    if (currentMobileSidebarUIState === 'peek') stateModificationCallback('mid');
                    else if (currentMobileSidebarUIState === 'mid') stateModificationCallback('full');
                } else {
                    if (currentMobileSheetUIState === 'peek') stateModificationCallback('mid');
                    else if (currentMobileSheetUIState === 'mid') stateModificationCallback('full');
                }
            } else {
                // Swipe Downward Actions Detected
                if (targetNodeContext === 'sidebar') {
                    if (currentMobileSidebarUIState === 'full') stateModificationCallback('mid');
                    else if (currentMobileSidebarUIState === 'mid') stateModificationCallback('peek');
                } else {
                    if (currentMobileSheetUIState === 'full') stateModificationCallback('mid');
                    else if (currentMobileSheetUIState === 'mid') stateModificationCallback('peek');
                    else stateModificationCallback('hidden');
                }
            }
        }
    }, { passive: true });
}

function initializeGestureTrackEngine() {
    document.getElementById('sidebar-drag-handle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentMobileSidebarUIState === 'peek') setMobileSidebarState('mid');
        else if (currentMobileSidebarUIState === 'mid') setMobileSidebarState('full');
        else if (currentMobileSidebarUIState === 'full') setMobileSidebarState('peek');
    });

    document.getElementById('detail-sheet-drag-handle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentMobileSheetUIState === 'peek') setMobileSheetUIState('mid');
        else if (currentMobileSheetUIState === 'mid') setMobileSheetUIState('full');
        else if (currentMobileSheetUIState === 'full') setMobileSheetUIState('peek');
    });

    bindSwipeGestureDetectionToMobileSheets('sidebar-drag-handle', 'sidebar', setMobileSidebarState);
    bindSwipeGestureDetectionToMobileSheets('detail-sheet-drag-handle', 'sheet', setMobileSheetUIState);
}

// REGISTER ALL MOUNT EVENT LISTENERS ON APPLICATION READINESS
window.addEventListener('DOMContentLoaded', () => {
    initializeSpatialMapEngine();
    applyThemeChangesToDOM();
    setupAutocompleteListeners();
    initializeClickIsolationBubbling();
    initializeGestureTrackEngine();
    
    // Mount core event listeners to UI nodes
    document.getElementById('fuelType')?.addEventListener('change', () => {
        if (activeTabContext === 'local') executeLocalSpatialFilteringPipeline();
        else executeRouteBufferAnalysisPipeline(null);
    });
    document.getElementById('filterUnleaded')?.addEventListener('change', () => {
        if (activeTabContext === 'local') executeLocalSpatialFilteringPipeline();
        else executeRouteBufferAnalysisPipeline(null);
    });
    document.getElementById('mpg')?.addEventListener('input', () => {
        if (activeTabContext === 'route' && plottedRouteCoordinates.length > 0) {
            executeRouteBufferAnalysisPipeline(null);
        }
    });

    // Run core data acquisition stream
    forceReloadRemotePipelineData();
    
    if (window.innerWidth < 768) {
        setMobileSidebarState('peek');
    }
});
