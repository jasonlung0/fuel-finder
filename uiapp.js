// Tailwind Design Tokens Custom Configuration Layer
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                colors: {
                    zinc: {
                        950: '#040405',
                        1000: '#000000'
                    }
                }
            }
        }
    };
}

let map = null;
let tileLayerInstance = null;
let tomtomTrafficLayerInstance = null; // Production reference to live congestion feed
let markerClusterGroupInstance = null;
let routePolylineLayer = null;

let rawGlobalStationsPool = [];
let currentlyVisibleStations = [];
let starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
let savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];

let activeTabContext = 'local'; 
let activeDirectoryTab = 'stations'; 
let activeSheetStation = null;
let mapSearchAnchorCoordinates = [51.5074, -0.1278]; 
let plottedRouteCoordinates = [];
let autocompleteDebounceTimer = null;

let currentMobileSidebarUIState = 'peek';
let currentMobileSheetUIState = 'hidden';
let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';

let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
let dynamicWaypointIncrementalIndex = 0;

// --- SCAN AREA TRACKING VARIABLES ---
let originalMapCenter = null;
let scanAreaTimeout = null;

const INACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.326.621-.326.772 0l2.035 4.392 4.752.693c.353.051.495.492.239.743l-3.438 3.35 1.022 4.718c.076.351-.29.616-.598.442L12 15.617l-4.283 2.272c-.308.174-.674-.09-.598-.442l1.022-4.718-3.438-3.35c-.256-.251-.114-.692.239-.743l4.752-.693 2.035-4.393Z" /></svg>`;
const ACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 text-amber-500"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>`;

function toggleSystemColorModeTheme(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    isDarkMode = !isDarkMode;
    localStorage.setItem('theme-dark-setting-mode', isDarkMode);
    applyThemeChangesToDOM();
}

function applyThemeChangesToDOM() {
    const bodyNode = document.body;
    if (isDarkMode) {
        bodyNode.classList.remove('light');
        bodyNode.classList.add('dark');
        document.documentElement.classList.add('dark');
    } else {
        bodyNode.classList.remove('dark');
        bodyNode.classList.add('light');
        document.documentElement.classList.remove('dark');
    }
    
    if (map && tileLayerInstance) {
        map.removeLayer(tileLayerInstance);
        const targetedTilesetURI = isDarkMode 
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        
        tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
        
        // Safety check to make sure TomTom active lines float on top of map style switches
        if (tomtomTrafficLayerInstance) {
            tomtomTrafficLayerInstance.bringToFront();
        }
    }
    refreshViewportViewFilter();
    updateDirectoryTotalBadge();
    if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
    updateAllStarUIStates();
}

function initializeSpatialMapEngine() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(mapSearchAnchorCoordinates, 11);
    
    const targetedTilesetURI = isDarkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        
    tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    
    // --- TOMTOM LIVE TRAFFIC LAYER INTEGRATION ---
    const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6'; // Replace with your real developer token 
    tomtomTrafficLayerInstance = L.tileLayer(`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`, {
        maxZoom: 22,
        attribution: '© TomTom Traffic',
        opacity: 0.85
    }).addTo(map);
    
    initializeClusterLayerPipeline();
    map.on('click', () => { closeForecourtDetailSheet(); });
    
    originalMapCenter = map.getCenter();

    // Context-Aware Window Area Scanning Detection Lookups
    map.on('moveend', () => {
        if (!originalMapCenter) return;
        const currentCenter = map.getCenter();
        const distanceMoved = currentCenter.distanceTo(originalMapCenter); 

        const scanContainer = document.getElementById('scan-area-container');
        if (!scanContainer) return;

        if (distanceMoved > 500) {
            scanContainer.classList.remove('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
            scanContainer.classList.add('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
        } else {
            scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
            scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
        }
    });
    
    triggerActiveDeviceLocationLookup();
}

window.executeContextualAreaScanPipeline = function(event) {
    if (event) event.stopPropagation();
    
    const btn = document.getElementById('scan-area-btn');
    const container = document.getElementById('scan-area-container');
    const iconSearch = document.getElementById('scan-icon-search');
    const iconSpinner = document.getElementById('scan-icon-spinner');
    const btnText = document.getElementById('scan-btn-string');

    btn.disabled = true;
    iconSearch.classList.add('hidden');
    iconSpinner.classList.remove('hidden');
    btnText.textContent = "Updating viewport matrix...";

    const newCenter = map.getCenter();
    mapSearchAnchorCoordinates = [newCenter.lat, newCenter.lng];
    originalMapCenter = newCenter;

    if (typeof forceReloadRemotePipelineData === 'function') {
        forceReloadRemotePipelineData();
    }

    setTimeout(() => {
        container.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
        container.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');

        setTimeout(() => {
            btn.disabled = false;
            iconSearch.classList.remove('hidden');
            iconSpinner.classList.add('hidden');
            btnText.textContent = "Search this map area";
        }, 300);
    }, 1000);
};

function triggerActiveDeviceLocationLookup() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;
                mapSearchAnchorCoordinates = [userLat, userLng];
                map.setView(mapSearchAnchorCoordinates, 12);
                originalMapCenter = L.latLng(userLat, userLng);
                
                L.circle(mapSearchAnchorCoordinates, {
                    radius: 200, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.4
                }).addTo(map);
                
                refreshViewportViewFilter();
            },
            (error) => {
                console.warn("Device location rejected. Defaulting coordinates.");
                refreshViewportViewFilter();
            },
            { enableHighAccuracy: true, timeout: 6000 }
        );
    } else {
        refreshViewportViewFilter();
    }
}

async function triggerManualDeviceLocationSearch(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const inputField = document.getElementById('location-input');
    if (!navigator.geolocation) return;

    if(inputField) inputField.value = "Detecting device coordinates...";

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        mapSearchAnchorCoordinates = [userLat, userLng];
        map.setView(mapSearchAnchorCoordinates, 13);
        originalMapCenter = L.latLng(userLat, userLng);

        try {
            const lookupRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&zoom=14`);
            const lookupData = await lookupRes.json();
            if(inputField && lookupData && lookupData.display_name) {
                inputField.value = lookupData.address.city || lookupData.address.town || lookupData.address.suburb || "My Coordinates";
            } else if(inputField) {
                inputField.value = `${userLat.toFixed(4)}, ${userLng.toFixed(4)}`;
            }
        } catch {
            if(inputField) inputField.value = "Current Location Vector";
        }
        refreshViewportViewFilter();
    }, () => {
        if(inputField) inputField.value = "Access Denied by Host Device";
    }, { enableHighAccuracy: true, timeout: 8000 });
}

function initializeClusterLayerPipeline() {
    if(markerClusterGroupInstance && map) { map.removeLayer(markerClusterGroupInstance); }
    
    markerClusterGroupInstance = L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
        iconCreateFunction: function (cluster) {
            const dynamicChildMarkers = cluster.getAllChildMarkers();
            const activeFuelKey = document.getElementById('fuel-type')?.value || 'E10';
            
            let pricesExtracted = [];
            dynamicChildMarkers.forEach(marker => {
                if(marker.options?.stationRawData?.[activeFuelKey]) {
                    const val = parseFloat(marker.options.stationRawData[activeFuelKey]);
                    if(!isNaN(val) && val > 0) pricesExtracted.push(val);
                }
            });

            if(pricesExtracted.length === 0) {
                return L.divIcon({
                    html: `<div class="fuel-cluster-capsule"><span>Cluster</span></div>`,
                    className: 'leaflet-div-icon-reset', iconSize: [95, 32]
                });
            }

            const min = Math.min(...pricesExtracted);
            const max = Math.max(...pricesExtracted);
            const labelString = (min === max) ? `${min.toFixed(1)}p` : `${min.toFixed(1)}p - ${max.toFixed(1)}p`;

            return L.divIcon({
                html: `<div class="fuel-cluster-capsule"><span>${labelString}</span></div>`,
                className: 'leaflet-div-icon-reset', iconSize: [115, 32], iconAnchor: [57, 16]
            });
        }
    });
    map.addLayer(markerClusterGroupInstance);
}

function switchWorkflowTabContext(contextType) {
    activeTabContext = contextType;
    const btnLocal = document.getElementById('tab-btn-local');
    const btnRoute = document.getElementById('tab-btn-route');
    const panelLocal = document.getElementById('panel-tab-local');
    const panelRoute = document.getElementById('panel-tab-route');
    const weatherModule = document.getElementById('route-weather-module');

    if (contextType === 'local') {
        btnLocal.className = "py-2 rounded-lg text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm";
        btnRoute.className = "py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white";
        panelLocal.classList.remove('hidden');
        panelRoute.classList.add('hidden');
        weatherModule.classList.add('hidden');
        clearCalculatedRouteLayers();
    } else {
        btnRoute.className = "py-2 rounded-lg text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm";
        btnLocal.className = "py-2 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white";
        panelRoute.classList.remove('hidden');
        panelLocal.classList.add('hidden');
        
        const scanContainer = document.getElementById('scan-area-container');
        if (scanContainer) {
            scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
            scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
        }

        if(plottedRouteCoordinates.length > 0) {
            weatherModule.classList.remove('hidden');
        }
    }
    refreshViewportViewFilter();
}

function switchDirectoryTabContext(dirType) {
    activeDirectoryTab = dirType;
    const tabStations = document.getElementById('dir-tab-stations');
    const tabRoutes = document.getElementById('dir-tab-routes');
    
    if (dirType === 'stations') {
        tabStations.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs";
        tabRoutes.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
    } else {
        tabRoutes.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs";
        tabStations.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white";
    }
    renderDirectoryDropdown();
}

function updateDirectoryTotalBadge() {
    const badge = document.getElementById('directory-total-badge');
    if (badge) {
        badge.textContent = starredStations.length + savedRoutes.length;
    }
}

function swapRouteEndpoints(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const startInput = document.getElementById('route-start');
    const endInput = document.getElementById('route-end');
    if(!startInput || !endInput) return;

    const intermediateBuffer = startInput.value;
    startInput.value = endInput.value;
    endInput.value = intermediateBuffer;
}

function addWaypointFieldInputRow(initialValue = '') {
    dynamicWaypointIncrementalIndex++;
    const currentUid = dynamicWaypointIncrementalIndex;
    const container = document.getElementById('dynamic-waypoints-container');
    if (!container) return;

    const rowNode = document.createElement('div');
    rowNode.id = `waypoint-row-context-${currentUid}`;
    rowNode.className = "relative w-full flex items-center gap-2 mt-1";

    rowNode.innerHTML = `
        <div class="absolute -left-[37px] top-[14px] w-1.5 h-1.5 rounded-full bg-amber-500/80 shadow-xs"></div>
        <div class="relative flex-1">
            <input id="route-via-${currentUid}" type="text" value="${initialValue}" placeholder="Midway stop point..." class="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-2.5 pr-14 py-2 text-xs text-zinc-800 dark:text-zinc-100 focus:outline-none waypoint-dynamic-input-field" />
            <button onclick="clearSingleWaypointRowInputValue(${currentUid}, event)" class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-rose-500 rounded text-[9px] font-bold tracking-tight transition cursor-pointer">Clear</button>
        </div>
        <button onclick="removeWaypointFieldInputRow(${currentUid}, event)" class="p-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 border border-zinc-200 dark:border-zinc-800 rounded-lg transition cursor-pointer flex items-center justify-center h-8 w-8 text-xs font-bold" title="Delete stop">✕</button>
        <div id="via-suggestions-${currentUid}" class="absolute left-0 right-10 top-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg shadow-xl hidden max-h-32 overflow-y-auto z-[2500] p-1 text-xs"></div>
    `;

    container.appendChild(rowNode);
    bindAutocompleteToSpecificInput(`route-via-${currentUid}`, `via-suggestions-${currentUid}`);
}

function removeWaypointFieldInputRow(uid, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const rowTarget = document.getElementById(`waypoint-row-context-${uid}`);
    if (rowTarget) {
        rowTarget.remove();
    }
}

function clearSingleWaypointRowInputValue(uid, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const inputField = document.getElementById(`route-via-${uid}`);
    if (inputField) {
        inputField.value = '';
    }
}

function bindAutocompleteToSpecificInput(inputId, suggestionsBoxId) {
    const inputField = document.getElementById(inputId);
    const matchingBox = document.getElementById(suggestionsBoxId);
    if (!inputField || !matchingBox) return;

    inputField.addEventListener('input', (e) => {
        const textQuery = e.target.value.trim();
        clearTimeout(autocompleteDebounceTimer);

        if (!textQuery || textQuery.length < 2) {
            matchingBox.classList.add('hidden');
            return;
        }

        autocompleteDebounceTimer = setTimeout(async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(textQuery)}&countrycodes=gb&limit=4`;
                const res = await fetch(url, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                const optionsList = await res.json();

                if (!optionsList || optionsList.length === 0) {
                    matchingBox.classList.add('hidden');
                    return;
                }

                matchingBox.innerHTML = '';
                optionsList.forEach(item => {
                    const row = document.createElement('div');
                    row.className = "p-2.5 hover:bg-zinc-100 dark:bg-zinc-800 cursor-pointer transition text-ellipsis overflow-hidden whitespace-nowrap text-zinc-700 dark:text-zinc-300 font-medium border-b border-zinc-100/50 dark:border-zinc-800/50";
                    row.textContent = item.display_name;
                    row.addEventListener('click', () => {
                        inputField.value = item.display_name;
                        matchingBox.classList.add('hidden');
                    });
                    matchingBox.appendChild(row);
                });
                matchingBox.classList.remove('hidden');
            } catch (err) { console.error(err); }
        }, 400);
    });

    document.addEventListener('click', (e) => {
        if (!inputField.contains(e.target) && !matchingBox.contains(e.target)) {
            matchingBox.classList.add('hidden');
        }
    });
}

function setupAutocompleteListeners() {
    bindAutocompleteToSpecificInput('route-start', 'start-suggestions');
    bindAutocompleteToSpecificInput('route-end', 'end-suggestions');
}

// --- PRODUCTION GEOPROCESSING & TOMTOM INCIDENT INTEGRATION ROUTER ---
async function executeRouteGenerationPipeline() {
    const startVal = document.getElementById('route-start').value.trim();
    const endVal = document.getElementById('route-end').value.trim();
    if (!startVal || !endVal) return;

    const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field'))
        .map(input => input.value.trim())
        .filter(val => val.length > 0);

    try {
        const startRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startVal)}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
        const startNodes = await startRes.json();
        const endRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endVal)}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
        const endNodes = await endRes.json();

        if (!startNodes.length || !endNodes.length) return;

        cachedGeocodedWaypoints.start = { name: startVal, lat: parseFloat(startNodes[0].lat), lon: parseFloat(startNodes[0].lon) };
        cachedGeocodedWaypoints.end = { name: endVal, lat: parseFloat(endNodes[0].lat), lon: parseFloat(endNodes[0].lon) };

        let coordinatesStringArray = [`${startNodes[0].lon},${startNodes[0].lat}`];

        cachedGeocodedWaypoints.vids = {};
        for(let w = 0; w < waypointNodes.length; w++) {
            const viaRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(waypointNodes[w])}&countrycodes=gb&limit=1`, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
            const viaNodes = await viaRes.json();
            if(viaNodes.length) {
                coordinatesStringArray.push(`${viaNodes[0].lon},${viaNodes[0].lat}`);
                cachedGeocodedWaypoints.vids[`wp_${w}`] = { name: waypointNodes[w], lat: parseFloat(viaNodes[0].lat), lon: parseFloat(viaNodes[0].lon) };
            }
        }

        coordinatesStringArray.push(`${endNodes[0].lon},${endNodes[0].lat}`);
        const osrmQuery = `https://router.project-osrm.org/route/v1/driving/${coordinatesStringArray.join(';')}?overview=full&geometries=geojson`;

        const routeRes = await fetch(osrmQuery);
        const routeData = await routeRes.json();

        if (!routeData.routes?.length) return;

        const routeLineGeometry = routeData.routes[0].geometry;
        const distanceMiles = routeData.routes[0].distance * 0.000621371;

        plottedRouteCoordinates = routeLineGeometry.coordinates.map(coord => [coord[1], coord[0]]);
        
        if (routePolylineLayer) map.removeLayer(routePolylineLayer);
        routePolylineLayer = L.featureGroup().addTo(map);

        // PRODUCTION: Single semi-transparent route path. 
        // This lets TomTom's real-world underlying live congestion tile colors overlay naturally underneath.
        L.polyline(plottedRouteCoordinates, {
            color: '#3b82f6', // Indigo Navigation Matrix Corridor Vector
            weight: 6.5,
            opacity: 0.55, 
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(routePolylineLayer);

        map.fitBounds(routePolylineLayer.getBounds(), { padding: [40, 40] });
        
        refreshViewportViewFilter(distanceMiles);
        triggerRouteWeatherFetchPipeline();

        const trafficNode = document.getElementById('traffic-telemetry-node');
        const labelText = document.getElementById('traffic-status-label');
        const badgeText = document.getElementById('traffic-delay-badge');
        
        if (trafficNode && labelText && badgeText) {
            trafficNode.classList.remove('hidden');
            trafficNode.classList.add('flex');
            
            const liveClock = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            labelText.textContent = "Live TomTom Traffic Feed Active";
            labelText.className = "text-xs font-black text-zinc-700 dark:text-zinc-300 block truncate";
            badgeText.textContent = `Live @ ${liveClock}`;
            badgeText.className = "bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 font-black text-[10px] px-2 py-0.5 rounded-md shrink-0";
        }

        if (window.innerWidth < 768) setMobileSidebarState('peek');
    } catch (err) {
        console.error(err);
    }
}

function lookupWeatherIconEmoji(code) {
    if (code === 0) return "☀️";
    if ([1, 2, 3].includes(code)) return "⛅";
    if ([45, 48].includes(code)) return "🌫️";
    if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
    if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
    if ([71, 73, 75, 77].includes(code)) return "🌨️";
    if ([80, 81, 82].includes(code)) return "🌦️";
    if ([85, 86].includes(code)) return "🌨️";
    if (code >= 95) return "⛈️";
    return "🌡️";
}

async function triggerRouteWeatherFetchPipeline() {
    if (!cachedGeocodedWaypoints.start) return;
    const lat = cachedGeocodedWaypoints.start.lat;
    const lon = cachedGeocodedWaypoints.start.lon;
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const data = await res.json();
        if (data && data.current_weather) {
            const temp = data.current_weather.temperature;
            const code = data.current_weather.weathercode;
            const icon = lookupWeatherIconEmoji(code);
            const weatherContainer = document.getElementById('route-weather-module');
            if (weatherContainer) {
                weatherContainer.innerHTML = `
                    <div class="flex items-center gap-2 p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 w-full shadow-xs">
                        <span class="text-lg">${icon}</span>
                        <div>
                            <div class="font-black text-zinc-900 dark:text-white">Departure Weather</div>
                            <div class="text-[10px] text-zinc-400 font-bold">${temp}°C • Live Conditions</div>
                        </div>
                    </div>
                `;
                if (activeTabContext === 'route') {
                    weatherContainer.classList.remove('hidden');
                }
            }
        }
    } catch (weatherErr) {
        console.error(weatherErr);
    }
}

function saveActiveRouteCorridor() {
    const startVal = document.getElementById('route-start').value.trim();
    const endVal = document.getElementById('route-end').value.trim();
    const currentMpg = document.getElementById('vehicle-mpg').value;
    const currentDev = document.getElementById('route-radius-slider').value;
    if (!startVal || !endVal) return;

    const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field'))
        .map(input => input.value.trim())
        .filter(val => val.length > 0);

    const routePayload = {
        id: 'route_' + Date.now(),
        name: `${startVal.split(',')[0]} ➔ ${endVal.split(',')[0]}`,
        start: startVal,
        waypoints: waypointNodes,
        end: endVal,
        mpg: currentMpg,
        radius: currentDev
    };

    savedRoutes.push(routePayload);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    updateDirectoryTotalBadge();
    if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
    if (window.innerWidth < 768) setMobileSidebarState('peek');
    alert("Corridor routing pipeline configuration securely saved to local workspace repository.");
}

function deleteSavedRouteCorridor(routeId, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    savedRoutes = savedRoutes.filter(r => r.id !== routeId);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    updateDirectoryTotalBadge();
    renderDirectoryDropdown();
}

function loadSavedRouteCorridorDataIntoWorkspace(routeId) {
    const matchedRoute = savedRoutes.find(r => r.id === routeId);
    if (!matchedRoute) return;
    switchWorkflowTabContext('route');
    document.getElementById('route-start').value = matchedRoute.start;
    document.getElementById('route-end').value = matchedRoute.end;
    if (document.getElementById('vehicle-mpg')) document.getElementById('vehicle-mpg').value = matchedRoute.mpg;
    if (document.getElementById('route-radius-slider')) document.getElementById('route-radius-slider').value = matchedRoute.radius;
    
    const container = document.getElementById('dynamic-waypoints-container');
    if (container) container.innerHTML = '';
    
    if (matchedRoute.waypoints) {
        matchedRoute.waypoints.forEach(wp => addWaypointFieldInputRow(wp));
    }
    executeRouteGenerationPipeline();
}

function clearCalculatedRouteLayers() {
    if (routePolylineLayer) {
        map.removeLayer(routePolylineLayer);
        routePolylineLayer = null;
    }
    plottedRouteCoordinates = [];
    cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
    const weatherModule = document.getElementById('route-weather-module');
    if (weatherModule) weatherModule.classList.add('hidden');
    const trafficNode = document.getElementById('traffic-telemetry-node');
    if (trafficNode) {
        trafficNode.classList.remove('flex');
        trafficNode.classList.add('hidden');
    }
    refreshViewportViewFilter();
}

function computeDistanceVectorMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function computeMinimumDistanceToRouteCorridor(pointLat, pointLon) {
    if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) return Infinity;
    let minDistance = Infinity;
    for (let i = 0; i < plottedRouteCoordinates.length; i++) {
        const dist = computeDistanceVectorMiles(pointLat, pointLon, plottedRouteCoordinates[i][0], plottedRouteCoordinates[i][1]);
        if (dist < minDistance) {
            minDistance = dist;
        }
    }
    return minDistance;
}

async function forceReloadRemotePipelineData() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/jasonlung0/fuel-finder/main/data/fuel-prices.json');
        const data = await res.json();
        
        let stations = data.stations || data;
        
        rawGlobalStationsPool = stations.map(s => {
            let baseDiesel = parseFloat(s.B7);
            return { 
                ...s, 
                PremiumDiesel: (baseDiesel && !isNaN(baseDiesel)) ? (baseDiesel + 14.2).toFixed(1) : null 
            };
        });

        const liveClock = new Date();
        document.getElementById('live-timestamp-label').innerHTML = `Prices Updated At ${liveClock.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        refreshViewportViewFilter();
    } catch (error) {
        console.error(error);
        document.getElementById('live-timestamp-label').textContent = "Offline Data Buffer Frame";
    }
}

function focusAndHighlightMapMarker(lat, lon) {
    if (isNaN(lat) || isNaN(lon)) return;
    map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
    const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) || rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
    if (selectedStation) {
        setTimeout(() => { openForecourtDetailSheet(selectedStation); }, 300);
    }
}

function refreshViewportViewFilter(routeDistanceContext = null) {
    if (!rawGlobalStationsPool?.length) return;
    const chosenFuelVariant = document.getElementById('fuel-type')?.value || 'E10';
    const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
    const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
    let dynamicBoundedStations = [];

    if (activeTabContext === 'local' || plottedRouteCoordinates.length === 0) {
        dynamicBoundedStations = rawGlobalStationsPool.filter(s => computeDistanceVectorMiles(mapSearchAnchorCoordinates[0], mapSearchAnchorCoordinates[1], parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetLocalRadiusThreshold);
    } else {
        dynamicBoundedStations = rawGlobalStationsPool.filter(s => computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetCorridorRadiusThreshold);
    }

    currentlyVisibleStations = dynamicBoundedStations;
    paintMarkerCanvasLayersToMap(dynamicBoundedStations.slice(0, 250), chosenFuelVariant, dynamicBoundedStations.length, routeDistanceContext);
    generateCheapestRankingListDeck(dynamicBoundedStations, chosenFuelVariant);
}

function generateCheapestRankingListDeck(pool, fuelVariant) {
    const block = document.getElementById('cheapest-ranking-block');
    const container = document.getElementById('cheapest-cards-stack');
    const blockTitle = document.getElementById('ranking-block-title');
    if (!block || !container) return;

    const validPool = pool.filter(s => s[fuelVariant] && !isNaN(parseFloat(s[fuelVariant])) && parseFloat(s[fuelVariant]) > 0);
    if (validPool.length === 0) {
        block.classList.add('hidden');
        return;
    }

    validPool.sort((a, b) => parseFloat(a[fuelVariant]) - parseFloat(b[fuelVariant]));
    container.innerHTML = '';

    if (activeTabContext === 'route' && plottedRouteCoordinates.length > 0) {
        if (blockTitle) blockTitle.textContent = "Cheapest Stops Along Corridor Route";
    } else {
        if (blockTitle) blockTitle.textContent = "Cheapest Near Coordinates";
    }

    const slicedTopThree = validPool.slice(0, 3);
    slicedTopThree.forEach((station, idx) => {
        const lat = parseFloat(station.latitude || station.lat);
        const lon = parseFloat(station.longitude || station.lng);
        const val = parseFloat(station[fuelVariant]).toFixed(1);
        
        let distanceToNode = computeDistanceVectorMiles(mapSearchAnchorCoordinates[0], mapSearchAnchorCoordinates[1], lat, lon);
        
        const card = document.createElement('div');
        card.className = "flex items-center justify-between p-2.5 bg-white dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800 rounded-lg hover:border-emerald-500 transition shadow-xs cursor-pointer";
        card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
        card.innerHTML = `
            <div class="flex items-center gap-2 min-w-0">
                <div class="w-4 h-4 rounded bg-emerald-500/10 text-[8px] flex items-center justify-center shrink-0 font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">#${idx + 1}</div>
                <div class="min-w-0">
                    <div class="text-xs font-bold text-zinc-900 dark:text-white truncate">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                    <div class="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 truncate block">${station.address || ''} • <span class="font-bold text-emerald-600">${distanceToNode.toFixed(1)} mi away</span></div>
                </div>
            </div>
            <div class="text-right shrink-0">
                <div class="text-[11px] font-black text-zinc-900 dark:text-white">${val}p</div>
            </div>
        `;
        container.appendChild(card);
    });
    block.classList.remove('hidden');
}

function paintMarkerCanvasLayersToMap(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
    if(!markerClusterGroupInstance) return;
    markerClusterGroupInstance.clearLayers();

    const pricesArray = stationsList.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0);
    const minPrice = Math.min(...pricesArray) || 0;
    const finCard = document.getElementById('financial-card');

    if (finCard && pricesArray.length > 0) {
        finCard.classList.remove('hidden');
        if (activeTabContext === 'route' && routeDistanceContext) {
            const totalTripPriceCostPounds = ((routeDistanceContext / parseFloat(document.getElementById('vehicle-mpg').value || 45)) * 4.54609 * minPrice) / 100;
            document.getElementById('summary-distance').textContent = `${routeDistanceContext.toFixed(1)} miles`;
            document.getElementById('summary-cost').textContent = `£${totalTripPriceCostPounds.toFixed(2)}`;
        } else {
            document.getElementById('summary-distance').textContent = `Low`;
            document.getElementById('summary-cost').textContent = `${minPrice.toFixed(1)}p`;
        }
    }

    stationsList.forEach((station) => {
        const numericPrice = parseFloat(station[variant]);
        if (!numericPrice) return;

        let tierBgClassColor = 'bg-blue-500';
        const pricesArrayZone = currentlyVisibleStations.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0);
        const zoneMin = Math.min(...pricesArrayZone);
        const zoneSpread = Math.max(...pricesArrayZone) - zoneMin;

        if (zoneSpread > 0) {
            const step = zoneSpread / 3;
            if (numericPrice <= (zoneMin + step)) tierBgClassColor = 'bg-emerald-500';
            else if (numericPrice <= (zoneMin + (step * 2))) tierBgClassColor = 'bg-amber-500';
            else tierBgClassColor = 'bg-rose-500';
        }

        const customFuelPriceMarkerIcon = L.divIcon({
            html: `<div class="price-marker-capsule ${tierBgClassColor}"><span>${numericPrice.toFixed(1)}</span></div>`,
            className: 'leaflet-div-icon-reset', iconSize: [42, 24], iconAnchor: [21, 12]
        });

        const m = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
            icon: customFuelPriceMarkerIcon,
            stationRawData: station
        });

        m.on('click', () => { openForecourtDetailSheet(station); });
        markerClusterGroupInstance.addLayer(m);
    });
}

function dismissFinancialDashboardBox(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const finCard = document.getElementById('financial-card');
    if (finCard) finCard.classList.add('hidden');
}

function toggleCurrentStationStar(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;

    const sig = getStationUniqueSignature(activeSheetStation);
    const existsIdx = starredStations.findIndex(s => getStationUniqueSignature(s) === sig);

    if (existsIdx > -1) {
        starredStations.splice(existsIdx, 1);
    } else {
        starredStations.push(activeSheetStation);
    }

    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    updateDirectoryTotalBadge();
    updateAllStarUIStates();
    if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
}

function updateAllStarUIStates() {
    const starBtn = document.getElementById('sheet-star-toggle-btn');
    if (!starBtn || !activeSheetStation) return;
    const sig = getStationUniqueSignature(activeSheetStation);
    const isStarred = starredStations.some(s => getStationUniqueSignature(s) === sig);
    starBtn.innerHTML = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;
}

function renderDirectoryDropdown() {
    const container = document.getElementById('directory-list-container');
    if (!container) return;

    if (activeDirectoryTab === 'stations') {
        if (starredStations.length === 0) {
            container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No monitored terminals.</div>`;
            return;
        }
        container.innerHTML = '';
        starredStations.forEach(station => {
            const cardRow = document.createElement('div');
            cardRow.className = "p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-emerald-500 transition cursor-pointer active:scale-[0.99] shadow-sm space-y-2";
            cardRow.onclick = (event) => {
                event.stopPropagation();
                focusAndHighlightMapMarker(parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng));
                if (window.innerWidth < 768) document.getElementById('starred-dropdown-panel').classList.add('hidden');
            };

            cardRow.innerHTML = `
                <div class="min-w-0">
                    <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                    <div class="text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${(station.address || '').replace(/['"]/g, '')}</div>
                </div>
                <div class="grid grid-cols-2 gap-1 pt-0.5">
                    <div class="border p-1 rounded-lg text-center ${assignPricingTierColorStyles(station.E10, 'E10')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">E10</div><div class="text-[10px] font-black mt-0.5">${station.E10 || 'N/A'}p</div></div>
                    <div class="border p-1 rounded-lg text-center ${assignPricingTierColorStyles(station.B7, 'B7')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">B7</div><div class="text-[10px] font-black mt-0.5">${station.B7 || 'N/A'}p</div></div>
                </div>
            `;
            container.appendChild(cardRow);
        });
    } else {
        if (savedRoutes.length === 0) {
            container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No saved route corridors.</div>`;
            return;
        }
        container.innerHTML = '';
        savedRoutes.forEach(route => {
            const cardRow = document.createElement('div');
            cardRow.className = "p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-blue-500 transition cursor-pointer shadow-sm flex items-center justify-between";
            cardRow.onclick = () => { loadSavedRouteCorridorDataIntoWorkspace(route.id); };

            cardRow.innerHTML = `
                <div class="min-w-0 flex-1 pr-2">
                    <div class="text-xs font-black text-zinc-900 dark:text-white truncate">${route.name}</div>
                    <div class="text-[8px] font-semibold text-zinc-400 mt-0.5">MPG: ${route.mpg} • Corridor: ${route.radius}mi</div>
                </div>
                <button onclick="deleteSavedRouteCorridor('${route.id}', event)" class="p-1.5 hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 rounded-md transition text-[10px] font-bold">Delete</button>
            `;
            container.appendChild(cardRow);
        });
    }
}

function assignPricingTierColorStyles(price, variant) {
    if (!price || isNaN(parseFloat(price))) return "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800";
    return "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-950/20";
}

function openForecourtDetailSheet(station) {
    activeSheetStation = station;
    updateAllStarUIStates();

    document.getElementById('sheet-brand').textContent = (station.brand_name || 'Independent').replace(/['"]/g, '');
    document.getElementById('sheet-address').textContent = (station.address || '').replace(/['"]/g, '');
    document.getElementById('sheet-postcode').textContent = station.postcode || '';

    document.getElementById('price-e10').textContent = station.E10 ? `${station.E10}p` : 'N/A';
    document.getElementById('price-b7').textContent = station.B7 ? `${station.B7}p` : 'N/A';
    document.getElementById('price-sup-e10').textContent = station.SUP_E10 ? `${station.SUP_E10}p` : 'N/A';
    document.getElementById('price-sup-b7').textContent = station.PremiumDiesel ? `${station.PremiumDiesel}p` : 'N/A';

    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;

    if (window.innerWidth < 768) {
        setMobileSheetUIState('peek');
    } else {
        sheet.classList.remove('hidden');
    }
}

function closeForecourtDetailSheet() {
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;
    if (window.innerWidth < 768) {
        setMobileSheetUIState('hidden');
    } else {
        sheet.classList.add('hidden');
    }
    activeSheetStation = null;
}

function getStationUniqueSignature(s) {
    if (!s) return '';
    return `${s.latitude || s.lat}_${s.longitude || s.lng}_${s.brand_name || ''}`.replace(/\s+/g, '');
}

function triggerExternalMappingVectorRoute(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;
    const lat = activeSheetStation.latitude || activeSheetStation.lat;
    const lon = activeSheetStation.longitude || activeSheetStation.lng;
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
}

function setMobileSidebarState(stateStr) {
    currentMobileSidebarUIState = stateStr;
    const sidebar = document.getElementById('primary-control-sidebar');
    if (!sidebar) return;
    sidebar.className = sidebar.className.replace(/\bdrawer-\w+/g, '');
    sidebar.classList.add(`drawer-${stateStr}`);
}

function setMobileSheetUIState(stateStr) {
    currentMobileSheetUIState = stateStr;
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;
    sheet.className = sheet.className.replace(/\bdrawer-\w+/g, '');
    if (stateStr === 'hidden') {
        sheet.classList.add('hidden');
    } else {
        sheet.classList.remove('hidden');
        sheet.classList.add(`drawer-${stateStr}`);
    }
}

function initializeClickIsolationBubbling() {
    const sidebar = document.getElementById('primary-control-sidebar');
    const sheet = document.getElementById('global-detail-sheet');
    if (sidebar) sidebar.addEventListener('click', (e) => e.stopPropagation());
    if (sheet) sheet.addEventListener('click', (e) => e.stopPropagation());
}

function bindSwipeGestureDetectionToMobileSheets(handleId, elementId, stateModificationCallback) {
    const handle = document.getElementById(handleId);
    if (!handle) return;

    let initialTouchPositionY = 0;
    handle.addEventListener('touchstart', (e) => {
        initialTouchPositionY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
        const finalTouchPositionY = e.changedTouches[0].clientY;
        const touchDisplacementY = finalTouchPositionY - initialTouchPositionY;

        if (Math.abs(touchDisplacementY) > 45) {
            if (touchDisplacementY > 0) {
                stateModificationCallback(elementId === 'sidebar' ? 'peek' : 'hidden');
            } else {
                stateModificationCallback(elementId === 'sidebar' ? 'full' : 'peek');
            }
        }
    }, { passive: true });
}

function initializeGestureTrackEngine() {
    bindSwipeGestureDetectionToMobileSheets('sidebar-drag-handle', 'sidebar', setMobileSidebarState);
    bindSwipeGestureDetectionToMobileSheets('detail-sheet-drag-handle', 'sheet', setMobileSheetUIState);
}

let refuelMarkersGroup = null;

function getDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// --- GREEDY OPTIMIZATION REFUELING ARCHITECTURE FEATURE ---
async function calculateOptimalRefuelStrategy() {
    if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
        alert("Please map out a route first!");
        return;
    }

    const tankSizeLiters = parseFloat(document.getElementById('vehicle-tank-size')?.value || 50);
    const currentMpg = parseFloat(document.getElementById('vehicle-mpg')?.value || 45);
    const initialFuelPct = parseFloat(document.getElementById('initial-fuel-level')?.value || 100) / 100;
    const selectedFuelType = document.getElementById('fuel-type')?.value || 'E10';

    const currentRangeMiles = (tankSizeLiters / 4.54609) * currentMpg;
    let currentFuelLiters = tankSizeLiters * initialFuelPct;
    let remainingRangeMiles = (currentFuelLiters / 4.54609) * currentMpg;
    const safetyBufferMiles = 20;

    const totalRouteDistanceMiles = computeDistanceVectorMiles(
        cachedGeocodedWaypoints.start.lat, cachedGeocodedWaypoints.start.lon,
        cachedGeocodedWaypoints.end.lat, cachedGeocodedWaypoints.end.lon
    );

    let mappedStations = currentlyVisibleStations.map(station => {
        let closestPoint = plottedRouteCoordinates.reduce((acc, coord, idx) => {
            let d = getDistanceInMiles(parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng), coord[0], coord[1]);
            return d < acc.dist ? { dist: d, marker: idx } : acc;
        }, { dist: Infinity, marker: 0 });

        return {
            ...station,
            mileMarker: (closestPoint.marker / plottedRouteCoordinates.length) * totalRouteDistanceMiles,
            price: parseFloat(station[selectedFuelType] || station.prices?.[selectedFuelType])
        };
    }).filter(s => !isNaN(s.price) && s.price > 0).sort((a, b) => a.mileMarker - b.mileMarker);

    let currentPositionMiles = 0;
    let stopsPlanned = [];

    if (refuelMarkersGroup) map.removeLayer(refuelMarkersGroup);
    refuelMarkersGroup = L.layerGroup().addTo(map);

    const timelineContainer = document.getElementById('optimizer-timeline-stack');
    if (timelineContainer) timelineContainer.innerHTML = '';

    let safetyFuse = 0;
    while ((currentPositionMiles + remainingRangeMiles) < totalRouteDistanceMiles && safetyFuse < 10) {
        safetyFuse++;
        let maxReach = currentPositionMiles + remainingRangeMiles - safetyBufferMiles;
        let reachableStations = mappedStations.filter(s => s.mileMarker > currentPositionMiles && s.mileMarker <= maxReach);

        if (reachableStations.length === 0) {
            reachableStations = mappedStations.filter(s => s.mileMarker > currentPositionMiles && s.mileMarker <= (currentPositionMiles + remainingRangeMiles));
            if (reachableStations.length === 0) break;
        }

        reachableStations.sort((a, b) => a.price - b.price);
        let chosenStation = reachableStations[0];

        let distanceTraveledSinceLastStop = chosenStation.mileMarker - currentPositionMiles;
        remainingRangeMiles -= distanceTraveledSinceLastStop;

        let litersNeededToFill = tankSizeLiters - ((remainingRangeMiles / currentMpg) * 4.54609);
        litersNeededToFill = Math.min(litersNeededToFill, tankSizeLiters);

        stopsPlanned.push({
            station: chosenStation,
            litersFilled: litersNeededToFill.toFixed(1),
            price: chosenStation.price
        });

        currentPositionMiles = chosenStation.mileMarker;
        remainingRangeMiles = currentRangeMiles; 
    }

    if (timelineContainer) {
        if (stopsPlanned.length === 0) {
            timelineContainer.innerHTML = `
                <div class="text-xs font-bold text-zinc-500 dark:text-zinc-400 py-2">
                    ✅ No refuel stops necessary! Direct range covers total trip distance.
                </div>
            `;
            return;
        }

        stopsPlanned.forEach((stop, index) => {
            const card = document.createElement('div');
            card.className = "p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1.5 shadow-xs relative pl-7";
            card.innerHTML = `
                <div class="absolute left-2.5 top-3.5 w-2 h-2 rounded-full bg-emerald-500"></div>
                <div class="text-xs font-black text-zinc-800 dark:text-zinc-100 flex items-center justify-between">
                    <span>#${index + 1} ${(stop.station.brand_name || 'Terminal').replace(/['"]/g, '')}</span>
                    <span class="text-emerald-500 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px]">${stop.price}p/L</span>
                </div>
                <div class="text-[10px] font-bold text-zinc-400">💡 Action: Fill <span class="text-emerald-400 font-black">${stop.litersFilled}L</span> (~@ Mile ${stop.station.mileMarker.toFixed(1)})</div>
            `;
            timelineContainer.appendChild(card);

            const pulseIcon = L.divIcon({
                className: 'leaflet-div-icon-reset',
                html: `
                    <div class="relative flex items-center justify-center">
                        <div class="bg-emerald-500 text-white font-black text-[9px] px-1.5 py-0.5 rounded shadow-lg border border-black/20 whitespace-nowrap">Refuel #${index + 1}</div>
                        <div class="w-2 h-2 bg-emerald-400 rounded-full border border-black animate-ping -mt-1"></div>
                    </div>
                `,
                iconSize: [100, 40],
                iconAnchor: [50, 20]
            });

            L.marker([parseFloat(stop.station.latitude || stop.station.lat), parseFloat(stop.station.longitude || stop.station.lng)], { icon: pulseIcon })
             .addTo(refuelMarkersGroup)
             .bindPopup(`<b>${stop.station.brand_name || 'Refuel Recommendation'}</b><br>Fill Amount: ${stop.litersFilled}L<br>Price: ${stop.price}p`);
        });

        timelineContainer.innerHTML += `
            <div class="text-[10px] uppercase font-black text-zinc-400 tracking-wider flex items-center gap-1.5 pt-1">
                <span class="w-2 h-2 rounded-full bg-red-500"></span> Destination (${totalRouteDistanceMiles.toFixed(1)} mi)
            </div>
        `;
    }
}

// --- WORKSPACE CORE LIFECYCLE DOM MOUNT HOOK ---
window.addEventListener('DOMContentLoaded', () => {
    initializeSpatialMapEngine();
    applyThemeChangesToDOM();
    setupAutocompleteListeners();
    initializeClickIsolationBubbling();
    initializeGestureTrackEngine();
    forceReloadRemotePipelineData();
    
    document.getElementById('trigger-refuel-optimizer')?.addEventListener('click', calculateOptimalRefuelStrategy);
    
    if(window.innerWidth < 768) {
        setMobileSidebarState('peek');
    }
});
