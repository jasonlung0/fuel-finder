// --- GLOBAL CONFIGURATION CREDENTIALS ---
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6';

// Tailwind Design Tokens & Safelist Configuration Layer
// THIS FIXES THE MARKER COLORS BEING PURGED
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                colors: {
                    zinc: {
                        950: '#040405',
                        1000: '#000000'
                    },
                    fuel: {
                        green: '#10b981', // Emerald 500 equivalent
                        blue: '#3b82f6',  // Blue 500 equivalent
                        red: '#ef4444'    // Red 500 equivalent
                    }
                }
            }
        },
        safelist: [
            'bg-fuel-green',
            'bg-fuel-blue',
            'bg-fuel-red'
        ]
    };
}

let map = null;
let tileLayerInstance = null;
let markerClusterGroupInstance = null;
let routePolylineLayer = null;

let rawGlobalStationsPool = [];
let currentlyVisibleStations = [];
let starredStations = [];
let savedRoutes = [];

try {
    const loadedStarred = localStorage.getItem('uk_fuel_starred_v2_stations');
    const loadedRoutes = localStorage.getItem('uk_fuel_saved_v2_routes');
    if (loadedStarred) starredStations = JSON.parse(loadedStarred);
    if (loadedRoutes) savedRoutes = JSON.parse(loadedRoutes);
} catch (e) {
    console.error("Failed to parse local storage:", e);
    starredStations = [];
    savedRoutes = [];
}

let activeTabContext = 'local'; 
let activeDirectoryTab = 'stations'; 
let activeSheetStation = null;
let mapSearchAnchorCoordinates = [51.5074, -0.1278]; 

let plottedRouteCoordinates = [];
let autocompleteDebounceTimer = null;
let globalActiveRoute = null;
let globalRouteDistanceMiles = 0;

let currentMobileSidebarUIState = 'peek';
let currentMobileSheetUIState = 'hidden';
let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';

let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
let dynamicWaypointIncrementalIndex = 0;

let originalMapCenter = null;
let scanAreaTimeout = null;

// --- GLOBAL TOAST NOTIFICATION ENGINE ---
const Toast = {
    container: null,
    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },
    show(message, type = 'info') {
        this.init();
        
        // High quality SVG icons based on status type
        const icons = {
            success: `<svg fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`,
            error: `<svg fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
            warning: `<svg fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3Z" /></svg>`,
            info: `<svg fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>`
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        toast.innerHTML = `
            <div class="relative z-10 flex items-center justify-center">${icons[type]}</div>
            <p class="relative z-10 m-0 leading-tight tracking-tight">${message}</p>
        `;

        this.container.appendChild(toast);

        // Animate the toast in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        // Automatically remove the toast after 3.5 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

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
    }
    
    if (typeof executeStationDataFilteringPipeline === 'function') {
        executeStationDataFilteringPipeline();
    }
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
    
    initializeClusterLayerPipeline();
    map.on('click', () => { closeForecourtDetailSheet(); });
    
    const scanContainer = document.getElementById('scan-area-container');
    if (scanContainer) {
        scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
        scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
    }

    originalMapCenter = map.getCenter();

    map.on('moveend', () => {
        if (!originalMapCenter) return;
        const currentCenter = map.getCenter();
        const distanceMoved = currentCenter.distanceTo(originalMapCenter); 

        if (!scanContainer) return;

        if (activeTabContext === 'route') {
            scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
            scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
            return;
        }

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
                
                originalMapCenter = L.latLng(userLat, userLng); 
                map.setView(mapSearchAnchorCoordinates, 12);
                
                L.circle(mapSearchAnchorCoordinates, {
                    radius: 200, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.4
                }).addTo(map);
                
                executeStationDataFilteringPipeline();
            },
            (error) => {
                console.warn("Device location rejected. Defaulting coordinates.");
                executeStationDataFilteringPipeline();
            },
            { enableHighAccuracy: true, timeout: 6000 }
        );
    } else {
        executeStationDataFilteringPipeline();
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
        executeStationDataFilteringPipeline();
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
                    html: `<div class="fuel-cluster-capsule tabular-nums"><span>Cluster</span></div>`,
                    className: 'leaflet-div-icon-reset', iconSize: [95, 32]
                });
            }

            const min = Math.min(...pricesExtracted);
            const max = Math.max(...pricesExtracted);
            const labelString = (min === max) ? `${min.toFixed(1)}p` : `${min.toFixed(1)}p - ${max.toFixed(1)}p`;

            return L.divIcon({
                html: `<div class="fuel-cluster-capsule tabular-nums"><span>${labelString}</span></div>`,
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
        btnLocal.className = "py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-600";
        btnRoute.className = "py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600";
        panelLocal.classList.remove('hidden');
        panelRoute.classList.add('hidden');
        weatherModule.classList.add('hidden');
        clearCalculatedRouteLayers();
    } else {
        btnRoute.className = "py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-600";
        btnLocal.className = "py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600";
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
    executeStationDataFilteringPipeline();
}

function switchDirectoryTabContext(dirType) {
    activeDirectoryTab = dirType;
    const tabStations = document.getElementById('dir-tab-stations');
    const tabRoutes = document.getElementById('dir-tab-routes');
    
    if (dirType === 'stations') {
        tabStations.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-600";
        tabRoutes.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600";
    } else {
        tabRoutes.className = "py-1 rounded text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs focus:outline-none focus:ring-2 focus:ring-emerald-600";
        tabStations.className = "py-1 rounded text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600";
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
            <input id="route-via-${currentUid}" type="text" value="${initialValue}" placeholder="Midway stop point..." class="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-2.5 pr-14 py-2 text-xs text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent waypoint-dynamic-input-field shadow-sm" />
            <button onclick="clearSingleWaypointRowInputValue(${currentUid}, event)" class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-rose-500 rounded text-[9px] font-bold tracking-tight transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-600">Clear</button>
        </div>
        <button onclick="removeWaypointFieldInputRow(${currentUid}, event)" class="p-2 bg-zinc-100 dark:bg-zinc-900 hover:bg-rose-500/10 text-zinc-400 hover:text-rose-500 border border-zinc-200 dark:border-zinc-800 rounded-lg transition cursor-pointer flex items-center justify-center h-8 w-8 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-rose-500" title="Delete stop">✕</button>
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
                    row.onclick = (event) => {
                        event.stopPropagation();
                        inputField.value = item.display_name;
                        matchingBox.classList.add('hidden');
                    };
                    matchingBox.appendChild(row);
                });
                matchingBox.classList.remove('hidden');
            } catch (e) { console.error(e); }
        }, 300);
    });
}

function setupAutocompleteListeners() {
    bindAutocompleteToSpecificInput('location-input', 'location-suggestions');
    bindAutocompleteToSpecificInput('route-start', 'start-suggestions');
    bindAutocompleteToSpecificInput('route-end', 'end-suggestions');
    addWaypointFieldInputRow();
}

async function executeAddressGeocodeLookup() {
    const searchString = document.getElementById('location-input').value.trim();
    if (!searchString) return;
    try {
        const endpoint = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchString)}&countrycodes=gb&limit=1`;
        const res = await fetch(endpoint, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
        const matchingNodes = await res.json();

        if (matchingNodes?.length > 0) {
            mapSearchAnchorCoordinates = [parseFloat(matchingNodes[0].lat), parseFloat(matchingNodes[0].lon)];
            originalMapCenter = L.latLng(parseFloat(matchingNodes[0].lat), parseFloat(matchingNodes[0].lon)); 
            map.setView(mapSearchAnchorCoordinates, 12);
            
            executeStationDataFilteringPipeline();
            
            if (window.innerWidth < 768) setMobileSidebarState('peek');
        }
    } catch (err) { console.error(err); }
}

// -------------------------------------------------------------
// Live Traffic Incident Polling & Stacking Pipeline
// -------------------------------------------------------------
async function streamLiveTrafficIncidents(bbox) {
    try {
        let minLon, minLat, maxLon, maxLat;

        // 1. Extract coordinates based on incoming types
        if (bbox && typeof bbox.getWest === 'function') {
            minLon = bbox.getWest();
            minLat = bbox.getSouth();
            maxLon = bbox.getEast();
            maxLat = bbox.getNorth();
        } else if (Array.isArray(bbox) && bbox.length === 4) {
            minLon = bbox[0];
            minLat = bbox[1];
            maxLon = bbox[2];
            maxLat = bbox[3];
        } else if (typeof map !== 'undefined' && map) {
            const currentBounds = map.getBounds();
            minLon = currentBounds.getWest();
            minLat = currentBounds.getSouth();
            maxLon = currentBounds.getEast();
            maxLat = currentBounds.getNorth();
        } else {
            return [];
        }

        // 2. Geofence Check (Pre-calculated area verification)
        const R = 6371; 
        const dLat = (maxLat - minLat) * (Math.PI / 180);
        const dLon = (maxLon - minLon) * (Math.PI / 180);
        const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
        const width = R * Math.abs(dLon) * Math.cos(meanLat);
        const height = R * Math.abs(dLat);
        const area = width * height;

        if (area > 9500) {
            console.warn(`🚦 Traffic skipped: Route area (${Math.round(area)} km²) exceeds TomTom limit.`);
            return []; 
        }

        // 3. Cleanly format and truncate coordinates to exactly 6 decimal places 
        const formattedMinLon = Number(minLon).toFixed(6);
        const formattedMinLat = Number(minLat).toFixed(6);
        const formattedMaxLon = Number(maxLon).toFixed(6);
        const formattedMaxLat = Number(maxLat).toFixed(6);

        const bboxString = `${formattedMinLon},${formattedMinLat},${formattedMaxLon},${formattedMaxLat}`;
        
        // 4. FIX: Correct the schema fields to match TomTom V5 exact parameter requirements
        const fieldsTemplate = encodeURIComponent("{incidents{properties{id,iconCategory,magnitudeOfDelay,delay,events{description}}}}");
        
        // 5. FIX: Added t=-1 to explicitly request the latest real-time traffic model 
        const targetApiEndpoint = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bboxString}&fields=${fieldsTemplate}&language=en-GB&t=-1`;

        console.log("Streaming real-time incident data from endpoint:", targetApiEndpoint);

        const networkResponse = await fetch(targetApiEndpoint);
        
        if (!networkResponse.ok) {
            throw new Error(`Traffic API unreachable with status code: ${networkResponse.status}`);
        }

        const payload = await networkResponse.json();
        
        if (payload && payload.incidents) {
            return payload.incidents;
        }

        return [];
    } catch (apiError) {
        console.error("Traffic incident streaming failed:", apiError);
        return []; 
    }
}

// -------------------------------------------------------------
// CORE ROUTING ENGINE & TomTom Fuel Consumption Integration
// -------------------------------------------------------------
async function executeRouteGenerationPipeline(forcedStart, forcedEnd) {
    if (!map) {
        console.warn("Spatial Map Engine is not initialized yet.");
        return;
    }

    try {
        const startElement = document.getElementById('route-start-point') || 
                             document.getElementById('start-point') || 
                             document.getElementById('route-start');
        
        const endElement = document.getElementById('route-end-point') || 
                           document.getElementById('end-point') || 
                           document.getElementById('route-end');
        
        const startInput = forcedStart || startElement?.value || "";
        const endInput = forcedEnd || endElement?.value || "";
        
        if (!startInput || !endInput) {
            Toast.show("Please enter both a start point and an end point.", "warning");
            return;
        }
        
        const startRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startInput)}&countrycodes=gb&limit=1`);
        const startNodes = await startRes.json();
        if (!startNodes.length) {
            Toast.show("Could not find coordinates for the start point.", "error");
            return;
        }
        
        const endRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endInput)}&countrycodes=gb&limit=1`);
        const endNodes = await endRes.json();
        if (!endNodes.length) {
            Toast.show("Could not find coordinates for the end point.", "error");
            return;
        }
        
        let waypointInputs = document.querySelectorAll('.waypoint-dynamic-input-field');
        let waypointStrings = [];
        if (waypointInputs) {
            waypointInputs.forEach(input => {
                if (input?.value && input.value.trim() !== "") {
                    waypointStrings.push(input.value.trim());
                }
            });
        }
        
        if (typeof cachedGeocodedWaypoints === 'undefined') {
            window.cachedGeocodedWaypoints = { start: {}, end: {}, vids: {} };
        }
        cachedGeocodedWaypoints.start = { name: startInput, lat: parseFloat(startNodes[0].lat), lon: parseFloat(startNodes[0].lon) };
        cachedGeocodedWaypoints.end = { name: endInput, lat: parseFloat(endNodes[0].lat), lon: parseFloat(endNodes[0].lon) };
        
        let coordinatesPayloadString = `${startNodes[0].lat},${startNodes[0].lon}`;
        
        if (waypointStrings.length > 0) {
            const waypointPromises = waypointStrings.map(async (wpStr, wIndex) => {
                try {
                    const viaRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(wpStr)}&countrycodes=gb&limit=1`);
                    const viaNodes = await viaRes.json();
                    if (viaNodes.length) {
                        return { wIndex, name: wpStr, lat: viaNodes[0].lat, lon: viaNodes[0].lon };
                    }
                } catch (e) {
                    console.error(`Failed to resolve midpoint sequence: ${wpStr}`, e);
                }
                return null;
            });

            const resolvedWaypoints = await Promise.all(waypointPromises);
            resolvedWaypoints.forEach(wp => {
                if (wp) {
                    coordinatesPayloadString += `:${wp.lat},${wp.lon}`;
                    cachedGeocodedWaypoints.vids[`wp_${wp.wIndex}`] = { 
                        name: wp.name, lat: parseFloat(wp.lat), lon: parseFloat(wp.lon) 
                    };
                }
            });
        }
        coordinatesPayloadString += `:${endNodes[0].lat},${endNodes[0].lon}`;
        
        // Convert MPG to Liters/100km for exact TomTom engine consumption
        const userMpg = parseFloat(document.getElementById('vehicle-mpg')?.value) || 45;
        const litersPer100km = (282.48 / userMpg).toFixed(2);
        const consumptionCurve = `50,${litersPer100km}:120,${litersPer100km}`;
        
        const tomtomUrl = `https://api.tomtom.com/routing/1/calculateRoute/${coordinatesPayloadString}/json?key=${TOMTOM_API_KEY}&traffic=true&routeType=fastest&sectionType=traffic&vehicleEngineType=combustion&constantSpeedConsumptionInLitersPerHundredkm=${consumptionCurve}`;
        
        const routeRes = await fetch(tomtomUrl);
        if (!routeRes.ok) throw new Error(`TomTom API routing failure: Status ${routeRes.status}`);
        
        const routeData = await routeRes.json();
        if (!routeData.routes || !routeData.routes.length) throw new Error("No routes found.");
        
        const currentActiveRoute = routeData.routes[0];

        globalActiveRoute = currentActiveRoute;
        globalRouteDistanceMiles = (currentActiveRoute.summary.lengthInMeters / 1609.34);
        window.globalCalculatedFuelLiters = currentActiveRoute.summary.fuelConsumptionInLiters;
        
        plottedRouteCoordinates = [];
        currentActiveRoute.legs.forEach(leg => {
            leg.points.forEach(pt => {
                plottedRouteCoordinates.push([pt.latitude, pt.longitude]);
            });
        });
        
        if (typeof routePolylineLayer !== 'undefined' && routePolylineLayer) {
            map.removeLayer(routePolylineLayer);
        }
        routePolylineLayer = L.featureGroup().addTo(map);
        
        L.polyline(plottedRouteCoordinates, {
            color: '#10b981', weight: 4.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round'
        }).addTo(routePolylineLayer);
        
        if (currentActiveRoute.sections && currentActiveRoute.sections.length > 0) {
            currentActiveRoute.sections.forEach(section => {
                if (section.sectionType === 'TRAFFIC' || section.simpleCategory === 'JAM' || section.simpleCategory === 'SLOWDOWN') {
                    const sliceCoords = plottedRouteCoordinates.slice(section.startPointIndex, section.endPointIndex + 1);
                    if (sliceCoords.length < 2) return;
                    
                    const isJam = section.simpleCategory === 'JAM' || (section.magnitudeOfDelay && section.magnitudeOfDelay >= 3);
                    L.polyline(sliceCoords, {
                        color: isJam ? '#ef4444' : '#f59e0b', 
                        weight: isJam ? 6.5 : 5.0, 
                        opacity: 1.0, lineCap: 'round', lineJoin: 'round'
                    }).addTo(routePolylineLayer);
                }
            });
        }
        
        if (plottedRouteCoordinates.length > 0) {
            const routeBounds = routePolylineLayer.getBounds();
            map.fitBounds(routeBounds);
            
            // 1. Explicitly target BOTH containers
            const statusContainer = document.getElementById('traffic-status-container');
            const alertsViewport = document.getElementById('traffic-alerts-viewport');
            
            // 2. Mount the loading state to the status container and clear the old list
            if (statusContainer) {
                statusContainer.style.display = 'block';
                statusContainer.innerHTML = `
                    <div class="flex items-center gap-2 px-3 py-1.5 mb-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-full text-amber-800 dark:text-amber-400 text-[10px] font-bold tracking-wide uppercase animate-pulse">
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        Analyzing Telemetry Bounding Box...
                    </div>
                `;
            }
            if (alertsViewport) alertsViewport.innerHTML = ''; // Clear previous results while loading

            // 3. Fetch the real-time incidents
            const liveIncidents = await streamLiveTrafficIncidents(routeBounds);

            // 4. DESTROY the loading state so it cannot stack
            if (statusContainer) {
                statusContainer.innerHTML = ''; 
                statusContainer.style.display = 'none'; // Completely collapse the element
            }

            // --- THE TRANSLATOR: Converts TomTom machine-speak to human English ---
            const humanizeTrafficDescription = (rawDesc) => {
                if (!rawDesc) return 'Traffic incident reported';
                const lowerDesc = rawDesc.toLowerCase();
                
                // Prioritize the most critical information first
                if (lowerDesc.includes('closed')) return 'Road is currently closed';
                if (lowerDesc.includes('stationary')) return 'Traffic is at a complete standstill';
                if (lowerDesc.includes('queueing') || lowerDesc.includes('queuing')) return 'Heavy queuing traffic';
                if (lowerDesc.includes('accident') || lowerDesc.includes('crash')) return 'Accident reported ahead';
                if (lowerDesc.includes('roadworks') || lowerDesc.includes('construction')) return 'Active roadworks causing delays';
                if (lowerDesc.includes('slow')) return 'Traffic is moving slowly';
                
                // Fallback: capitalize the first letter of whatever TomTom sent
                return rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1);
            };

            // 5. Render results into the viewport
            if (alertsViewport) {
                const R = 6371; 
                const dLat = (routeBounds.getNorth() - routeBounds.getSouth()) * (Math.PI / 180);
                const dLon = (routeBounds.getEast() - routeBounds.getWest()) * (Math.PI / 180);
                const meanLat = ((routeBounds.getSouth() + routeBounds.getNorth()) / 2) * (Math.PI / 180);
                const area = (R * Math.abs(dLon) * Math.cos(meanLat)) * (R * Math.abs(dLat));

                if (area > 9500) {
                    alertsViewport.innerHTML = `
                        <div class="w-full p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-start gap-2.5">
                            <span class="text-xs">🗺️</span>
                            <div class="flex flex-col">
                                <span class="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Zoom in for live traffic</span>
                                <span class="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">This area is too wide to scan all at once. Zoom in on a specific section of your route to load real-time local delays.</span>
                            </div>
                        </div>
                    `;
                }
                else if (!liveIncidents || liveIncidents.length === 0) {
                    alertsViewport.innerHTML = `
                        <div class="w-full p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl flex items-center gap-2">
                            <span class="text-xs text-emerald-600">✅</span>
                            <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Clear roads ahead! No delays reported on this corridor.</span>
                        </div>
                    `;
                } 
                else {
                    // Filter and sort the top impacts
                    let significantIncidents = liveIncidents.filter(inc => (inc.properties.delay || 0) >= 60 || (inc.properties.magnitudeOfDelay || 0) >= 2);
                    significantIncidents.sort((a, b) => (b.properties.delay || 0) - (a.properties.delay || 0));

                    let uniqueIncidents = [];
                    let seenDescriptions = new Set();
                    
                    for (let inc of significantIncidents) {
                        const rawDesc = (inc.properties.events && inc.properties.events.length > 0 && inc.properties.events[0].description) 
                            ? inc.properties.events[0].description 
                            : 'Traffic';
                            
                        if (!seenDescriptions.has(rawDesc)) {
                            uniqueIncidents.push(inc);
                            seenDescriptions.add(rawDesc);
                        }
                    }

                    const topIncidents = uniqueIncidents.slice(0, 4);

                    if (topIncidents.length === 0) {
                        alertsViewport.innerHTML = `
                            <div class="w-full p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl flex items-center gap-2">
                                <span class="text-xs text-emerald-600">✅</span>
                                <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Minor delays only. Corridor is mostly clear!</span>
                            </div>
                        `;
                        return;
                    }

                    // Build the cards using the new Human Translator
                    const incidentsHTML = topIncidents.map(incident => {
                        const props = incident.properties;
                        
                        const magnitudeMap = { 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Critical' };
                        const magnitudeText = magnitudeMap[props.magnitudeOfDelay] || 'Traffic';

                        const delayInSeconds = props.delay || 0;
                        const delayMinutes = Math.round(delayInSeconds / 60);
                        const delayString = delayMinutes > 0 ? `${delayMinutes} min delay` : 'Delay expected';
                        
                        // Extract raw description and pass it through our translator
                        const rawDesc = (props.events && props.events.length > 0 && props.events[0].description) 
                            ? props.events[0].description 
                            : '';
                        const humanDescription = humanizeTrafficDescription(rawDesc);

                        return `
                            <div class="p-3 bg-red-50/60 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-xl flex items-start gap-3 shadow-sm transition-all duration-200">
                                <div class="px-2 py-0.5 bg-red-500 text-white font-black text-[9px] rounded uppercase mt-0.5 tracking-wide">
                                    ${magnitudeText}
                                </div>
                                <div class="flex flex-col flex-1">
                                    <span class="text-[11px] font-bold text-red-700 dark:text-red-400 tracking-wide">${delayString}</span>
                                    <span class="text-xs font-medium text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">${humanDescription}</span>
                                </div>
                            </div>
                        `;
                    }).join('');

                    alertsViewport.innerHTML = `
                        <div class="flex flex-col gap-2 w-full">
                            <div class="flex items-center justify-between px-1 mb-1">
                                <div class="text-[10px] font-black uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                    Top Critical Impacts (${topIncidents.length})
                                </div>
                            </div>
                            ${incidentsHTML}
                        </div>
                    `;
                }
            }
        }
        
        const distanceStringFormatted = globalRouteDistanceMiles.toFixed(1);
        const distanceMetric = document.getElementById('dash-metric-distance');
        if (distanceMetric) distanceMetric.innerText = `${distanceStringFormatted} mi`;
        
        const unifiedInsightsCard = document.getElementById('route-insights-card');
        if (unifiedInsightsCard) {
            unifiedInsightsCard.classList.remove('hidden');
        }
        
        executeStationDataFilteringPipeline();
        
        try {
            if (typeof triggerRouteWeatherFetchPipeline === 'function') {
                await triggerRouteWeatherFetchPipeline();
            }
        } catch (weatherErr) {
            console.warn("Weather API unreachable.", weatherErr);
            document.getElementById('route-weather-module')?.classList.add('hidden');
        }
        
        if (typeof calculateOptimalRefuelStrategy === 'function') {
            calculateOptimalRefuelStrategy();
        }
        
    } catch (err) {
        console.error("Pipeline Engine Broken:", err);
        Toast.show(`Failed to trace route: ${err.message}`, "error");
    }
}

function lookupWeatherIconEmoji(code) {
    if (code === 0) return "☀️";
    if ([1, 2, 3].includes(code)) return "⛅";
    if ([45, 48].includes(code)) return "🌫️";
    if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
    if ([61, 63, 65, 66, 67].includes(code)) return "🌧️";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
    if ([80, 81, 82].includes(code)) return "🌧️";
    if ([95, 96, 99].includes(code)) return "⛈️";
    return "☁️";
}

async function triggerRouteWeatherFetchPipeline() {
    const container = document.getElementById('weather-nodes-stack');
    const targetModule = document.getElementById('route-weather-module');
    if (!container || !targetModule) return;

    container.innerHTML = '';
    if (activeTabContext === 'route') {
        targetModule.classList.remove('hidden');
    }

    const locationsToFetch = [];
    if (cachedGeocodedWaypoints.start) locationsToFetch.push({ label: "Start", data: cachedGeocodedWaypoints.start });
    
    Object.keys(cachedGeocodedWaypoints.vids).forEach(key => {
        locationsToFetch.push({ label: "Stopover", data: cachedGeocodedWaypoints.vids[key] });
    });

    if (cachedGeocodedWaypoints.end) locationsToFetch.push({ label: "Destination", data: cachedGeocodedWaypoints.end });

    for (const loc of locationsToFetch) {
        try {
            const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.data.lat}&longitude=${loc.data.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe%2FLondon`);
            const weatherData = await weatherRes.json();

            if (weatherData && weatherData.daily) {
                const cardElement = document.createElement('div');
                cardElement.className = "p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl shadow-xs";
                
                let headerTitleClean = loc.data.name.split(',')[0];
                let horizontalForecastHTML = '';
                
                for (let d = 0; d < 5; d++) {
                    const rawDate = new Date(weatherData.daily.time[d]);
                    const weekdayLabel = rawDate.toLocaleDateString('en-GB', { weekday: 'short' });
                    const conditionEmoji = lookupWeatherIconEmoji(weatherData.daily.weathercode[d]);
                    const highTemp = Math.round(weatherData.daily.temperature_2m_max[d]);
                    const lowTemp = Math.round(weatherData.daily.temperature_2m_min[d]);

                    horizontalForecastHTML += `
                        <div class="flex flex-col items-center justify-center p-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-850 rounded-lg text-center min-w-[50px] tabular-nums">
                            <span class="text-[8px] font-black uppercase text-zinc-400 tracking-wider">${weekdayLabel}</span>
                            <span class="text-sm my-0.5">${conditionEmoji}</span>
                            <span class="text-[9px] font-black text-zinc-800 dark:text-zinc-200">${highTemp}° / <span class="text-zinc-400">${lowTemp}°</span></span>
                        </div>
                    `;
                }

                cardElement.innerHTML = `
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">${loc.label}</span>
                        <span class="text-[10px] font-bold text-zinc-700 dark:text-zinc-300 truncate max-w-[200px] text-right">${headerTitleClean}</span>
                    </div>
                    <div class="grid grid-cols-5 gap-1.5 overflow-x-auto no-scrollbar">
                        ${horizontalForecastHTML}
                    </div>
                `;
                container.appendChild(cardElement);
            }
        } catch (weatherErr) { console.error(weatherErr); }
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
    Toast.show("Your route is successfully saved.", "success");
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
    document.getElementById('vehicle-mpg').value = matchedRoute.mpg;
    document.getElementById('route-radius-slider').value = matchedRoute.radius;
    document.getElementById('route-radius-val').textContent = `${matchedRoute.radius} Mi`;

    const container = document.getElementById('dynamic-waypoints-container');
    if (container) {
        container.innerHTML = '';
        if(matchedRoute.waypoints && matchedRoute.waypoints.length > 0) {
            matchedRoute.waypoints.forEach(wpStr => {
                addWaypointFieldInputRow(wpStr);
            });
        } else {
            addWaypointFieldInputRow();
        }
    }

    executeRouteGenerationPipeline();
    document.getElementById('starred-dropdown-panel').classList.add('hidden');
}

function clearCalculatedRouteLayers() {
    if (routePolylineLayer) { map.removeLayer(routePolylineLayer); routePolylineLayer = null; }
    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) { refuelMarkersGroup?.clearLayers(); }

    if (typeof map !== 'undefined' && map) {
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                const popup = layer.getPopup();
                const popupContent = popup ? popup.getContent() : '';
                if (
                    layer.options.title === 'Start' || layer.options.title === 'End' ||
                    layer.options.icon?.options?.className === 'custom-refuel-marker-node' || 
                    layer.options.icon?.options?.className === 'custom-fuel-icon' ||
                    (typeof popupContent === 'string' && (popupContent.includes('Optimal') || popupContent.includes('Refuel')))
                ) {
                    map.removeLayer(layer);
                }
            }
        });
    }

    plottedRouteCoordinates = [];
    cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
    window.globalCalculatedFuelLiters = null;
    
    document.getElementById('route-start').value = '';
    document.getElementById('route-end').value = '';
    document.getElementById('location-input').value = '';

    const container = document.getElementById('dynamic-waypoints-container');
    if (container) {
        container.innerHTML = '';
        addWaypointFieldInputRow();
    }

    document.getElementById('route-insights-card')?.classList.add('hidden');
    document.getElementById('cheapest-ranking-block')?.classList.add('hidden');
    document.getElementById('route-weather-module')?.classList.add('hidden');

    clearFuelOptimizationState();
    executeStationDataFilteringPipeline();
}

function computeDistanceVectorMiles(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * 69.1;
    const dLon = (lon2 - lon1) * 41.0; 
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

function computeMinimumDistanceToRouteCorridor(pointLat, pointLon) {
    let minimumTrackSeparationMiles = Infinity;
    for (let i = 0; i < plottedRouteCoordinates.length; i++) {
        const node = plottedRouteCoordinates[i];
        const distanceEstimate = computeDistanceVectorMiles(node[0], node[1], pointLat, pointLon);
        if (distanceEstimate < minimumTrackSeparationMiles) minimumTrackSeparationMiles = distanceEstimate;
    }
    return minimumTrackSeparationMiles;
}

document.getElementById('radius-slider')?.addEventListener('input', (e) => {
    document.getElementById('radius-val').textContent = `${e.target.value} Miles`; 
    executeStationDataFilteringPipeline();
});
document.getElementById('route-radius-slider')?.addEventListener('input', (e) => {
    document.getElementById('route-radius-val').textContent = `${e.target.value} Miles`;
});

document.addEventListener('click', (e) => {
    const suggestionBoxes = document.querySelectorAll('[id$="-suggestions"], [id^="via-suggestions-"]');
    suggestionBoxes.forEach(box => {
        if (!box.contains(e.target)) box.classList.add('hidden');
    });
});

async function forceReloadRemotePipelineData() {
    try {
        const response = await fetch('https://fuel-cron-scraper.jasonlung0.workers.dev/');
        const data = await response.json();
        
        rawGlobalStationsPool = data.map(s => {
            const baseDiesel = parseFloat(s.B7);
            return {
                ...s,
                PremiumDiesel: (baseDiesel && !isNaN(baseDiesel)) ? (baseDiesel + 14.2).toFixed(1) : null
            };
        });
        
        const liveClock = new Date();
        document.getElementById('live-timestamp-label').innerHTML = `Prices Updated At ${liveClock.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        
        executeStationDataFilteringPipeline();
    } catch (error) {
        console.error(error);
        document.getElementById('live-timestamp-label').textContent = "Offline Data Buffer Frame";
    }
}

function focusAndHighlightMapMarker(lat, lon) {
    if (isNaN(lat) || isNaN(lon)) return;
    map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
    
    const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) ||
                           rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
    
    if (selectedStation) {
        setTimeout(() => { openForecourtDetailSheet(selectedStation); }, 300);
    }
}

// -------------------------------------------------------------
// MAIN PIPELINE: Filter Stations & Draw Map (Fixes Ref Error)
// -------------------------------------------------------------
function executeStationDataFilteringPipeline() {
    if (!rawGlobalStationsPool?.length) return;
    
    const targetFuelType = document.getElementById('fuel-type')?.value || 'E10';
    const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
    const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
    
    let dynamicBoundedStations = [];

    if (activeTabContext === 'local' || !plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
        dynamicBoundedStations = rawGlobalStationsPool.filter(s => {
            if (!s[targetFuelType] || isNaN(parseFloat(s[targetFuelType]))) return false;
            const dist = computeDistanceVectorMiles(mapSearchAnchorCoordinates[0], mapSearchAnchorCoordinates[1], parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng));
            return dist <= targetLocalRadiusThreshold;
        });
    } else {
        dynamicBoundedStations = rawGlobalStationsPool.filter(s => {
            if (!s[targetFuelType] || isNaN(parseFloat(s[targetFuelType]))) return false;
            const dist = computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng));
            return dist <= targetCorridorRadiusThreshold;
        });
    }

    currentlyVisibleStations = dynamicBoundedStations;
    
    let distanceContext = null;
    if (activeTabContext === 'route' && typeof globalRouteDistanceMiles !== 'undefined') {
        distanceContext = globalRouteDistanceMiles;
    }
    
    paintMarkerCanvasLayersToMap(currentlyVisibleStations.slice(0, 250), targetFuelType, currentlyVisibleStations.length, distanceContext);
    generateCheapestRankingListDeck(currentlyVisibleStations, targetFuelType);
}

function generateCheapestRankingListDeck(pool, fuelVariant) {
    const block = document.getElementById('cheapest-ranking-block');
    const container = document.getElementById('cheapest-cards-stack');
    const blockTitle = document.getElementById('ranking-block-title');
    if (!block || !container) return;

    const validPool = pool.filter(s => s[fuelVariant] && !isNaN(parseFloat(s[fuelVariant])) && parseFloat(s[fuelVariant]) > 0);
    if (validPool.length === 0) { block.classList.add('hidden'); return; }

    container.innerHTML = '';

    if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
        blockTitle.textContent = "3 Cheapest Stations On Your Route";
        
        const milestoneLocationsList = [];
        milestoneLocationsList.push({ label: "Start", node: cachedGeocodedWaypoints.start });
        
        Object.keys(cachedGeocodedWaypoints.vids).forEach(key => {
            milestoneLocationsList.push({ label: `Stopover`, node: cachedGeocodedWaypoints.vids[key] });
        });
        
        milestoneLocationsList.push({ label: "Destination", node: cachedGeocodedWaypoints.end });

        milestoneLocationsList.forEach(milestone => {
            let rawMilestonePool = validPool.map(station => {
                let distanceToNode = computeDistanceVectorMiles(milestone.node.lat, milestone.node.lon, parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng));
                return { station, distanceToNode };
            });

            rawMilestonePool = rawMilestonePool.filter(item => item.distanceToNode <= 12);
            rawMilestonePool.sort((a, b) => parseFloat(a.station[fuelVariant]) - parseFloat(b.station[fuelVariant]));

            let slicedTopThree = rawMilestonePool.slice(0, 3);
            if (slicedTopThree.length > 0) {
                const subGroupWrapper = document.createElement('div');
                subGroupWrapper.className = "space-y-1.5 p-2 bg-zinc-50/70 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-800/60";
                
                const subGroupHeader = document.createElement('div');
                subGroupHeader.className = "flex justify-between items-center px-1 text-[9px] font-black tracking-tight text-zinc-400 dark:text-zinc-500 uppercase";
                subGroupHeader.innerHTML = `<span>📍 ${milestone.label}: <span class="text-zinc-700 dark:text-zinc-300 font-black">${milestone.node.name.split(',')[0]}</span></span>`;
                subGroupWrapper.appendChild(subGroupHeader);

                slicedTopThree.forEach((item, idx) => {
                    const station = item.station;
                    const lat = parseFloat(station.latitude || station.lat);
                    const lon = parseFloat(station.longitude || station.lng);
                    const val = parseFloat(station[fuelVariant]).toFixed(1);

                    const card = document.createElement('div');
                    card.className = "flex items-center justify-between p-2.5 bg-white dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800 rounded-lg hover:border-emerald-500 transition shadow-xs cursor-pointer";
                    card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
                    card.innerHTML = `
                        <div class="flex items-center gap-2 min-w-0">
                            <div class="w-4 h-4 rounded bg-emerald-500/10 text-[8px] flex items-center justify-center shrink-0 font-black text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 tabular-nums">#${idx + 1}</div>
                            <div class="min-w-0">
                                <div class="text-xs font-bold text-zinc-900 dark:text-white truncate">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                                <div class="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 truncate block">${station.address || ''} • <span class="font-bold text-emerald-700 dark:text-emerald-500">${item.distanceToNode.toFixed(1)} mi away</span></div>
                            </div>
                        </div>
                        <div class="text-right shrink-0"><div class="text-[11px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${val}p</div></div>
                    `;
                    subGroupWrapper.appendChild(card);
                });
                container.appendChild(subGroupWrapper);
            }
        });
    } else {
        blockTitle.textContent = "Cheapest Stations Nearby";
        validPool.sort((a, b) => parseFloat(a[fuelVariant]) - parseFloat(b[fuelVariant]));
        
        validPool.slice(0, 3).forEach((station, idx) => {
            const lat = parseFloat(station.latitude || station.lat);
            const lon = parseFloat(station.longitude || station.lng);
            const val = parseFloat(station[fuelVariant]).toFixed(1);
            
            const card = document.createElement('div');
            card.className = "flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-emerald-500 transition shadow-sm cursor-pointer";
            card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
            card.innerHTML = `
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-5 h-5 rounded-md bg-emerald-500/10 text-[9px] flex items-center justify-center shrink-0 font-black text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 tabular-nums">#${idx + 1}</div>
                    <div class="min-w-0">
                        <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                        <div class="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${station.address || ''}</div>
                    </div>
                </div>
                <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${val}p</div></div>
            `;
            container.appendChild(card);
        });
    }
    block.classList.remove('hidden');
}

function assignPricingTierColorStyles(valueRaw, variantKey) {
    const fallbackClasses = "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800";
    if (!valueRaw) return fallbackClasses;
    const numericVal = parseFloat(valueRaw);
    if (isNaN(numericVal) || numericVal <= 0) return fallbackClasses;

    const referencePool = currentlyVisibleStations.map(item => parseFloat(item[variantKey])).filter(p => !isNaN(p) && p > 0);
    if (referencePool.length === 0) return "bg-blue-50 border-blue-200 text-blue-900 dark:bg-zinc-900 dark:border-zinc-800 dark:text-blue-400";

    const min = Math.min(...referencePool);
    const delta = Math.max(...referencePool) - min;
    if (delta <= 0) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/30 text-emerald-600";

    const step = delta / 3;
    if (numericVal <= min + step) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold";
    if (numericVal <= min + (step * 2)) return "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold";
    return "bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold";
}

function paintMarkerCanvasLayersToMap(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
    if(!markerClusterGroupInstance) return;
    markerClusterGroupInstance.clearLayers();
    
    const pricesArray = stationsList.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0);
    const minPrice = Math.min(...pricesArray) || 0;

    if (activeTabContext === 'route' && routeDistanceContext && pricesArray.length > 0) {
        document.getElementById('summary-cost').textContent = `${minPrice.toFixed(1)}p`;
    }

    // --- FIX: Statistical Tertiles to ignore extreme Motorway Outliers ---
    const globalPricesArray = rawGlobalStationsPool
        .map(s => parseFloat(s[variant]))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);
        
    let greenThreshold = 0;
    let blueThreshold = 0;

    if (globalPricesArray.length > 0) {
        // Split the UK distribution into three equal buckets
        const oneThirdIndex = Math.floor(globalPricesArray.length * 0.333);
        const twoThirdsIndex = Math.floor(globalPricesArray.length * 0.666);
        
        greenThreshold = globalPricesArray[oneThirdIndex];
        blueThreshold = globalPricesArray[twoThirdsIndex];
    }

    stationsList.forEach((station) => {
        const numericPrice = parseFloat(station[variant]);
        if (!numericPrice) return;
        
        let tierBgClassColor = 'bg-fuel-blue';

        if (globalPricesArray.length > 0) {
            // Apply the tertile thresholds
            if (numericPrice <= greenThreshold) tierBgClassColor = 'bg-fuel-green';
            else if (numericPrice <= blueThreshold) tierBgClassColor = 'bg-fuel-blue';
            else tierBgClassColor = 'bg-fuel-red';
        }

        const markerInstance = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
            stationRawData: station,
            icon: L.divIcon({
                html: `<div class="fuel-marker-bubble tabular-nums ${tierBgClassColor}"><span>${numericPrice.toFixed(1)}p</span></div>`,
                className: 'leaflet-div-icon-reset', iconSize: [75, 28], iconAnchor: [37, 14]
            })
        });
        
        markerInstance.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openForecourtDetailSheet(station);
        });
        markerClusterGroupInstance.addLayer(markerInstance);
    });

    if (document.getElementById('station-counter')) document.getElementById('station-counter').textContent = `Stations: ${fallbackTotalCount}`;
}

function toggleCurrentStationStar(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;
    const stationKey = getStationUniqueSignature(activeSheetStation);
    const matchingIndex = starredStations.findIndex(s => getStationUniqueSignature(s) === stationKey);

    if (matchingIndex > -1) starredStations.splice(matchingIndex, 1);
    else starredStations.push(activeSheetStation);

    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    updateDirectoryTotalBadge();
    updateAllStarUIStates();
}

function updateAllStarUIStates() {
    if (!activeSheetStation) return;
    const isStarred = starredStations.some(s => getStationUniqueSignature(s) === getStationUniqueSignature(activeSheetStation));
    
    const sheetBtn = document.getElementById('sheet-star-btn');
    if (sheetBtn) {
        sheetBtn.innerHTML = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;
        sheetBtn.className = isStarred 
            ? "p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8"
            : "p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-400 hover:text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8";
    }

    if (!document.getElementById('starred-dropdown-panel').classList.contains('hidden')) renderDirectoryDropdown();
}

function toggleStarredDropdownDashboardPanel(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const panel = document.getElementById('starred-dropdown-panel');
    if (!panel) return;
    
    if (panel.classList.contains('hidden')) { 
        closeForecourtDetailSheet();
        panel.classList.remove('hidden'); 
        renderDirectoryDropdown(); 
    } else { 
        panel.classList.add('hidden'); 
    }
}

function renderDirectoryDropdown() {
    const container = document.getElementById('starred-list-container');
    if (!container) return;

    starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
    savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];

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
                    <div class="border p-1 rounded-lg text-center tabular-nums ${assignPricingTierColorStyles(station.E10, 'E10')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">E10</div><div class="text-[10px] font-black mt-0.5">${station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A'}</div></div>
                    <div class="border p-1 rounded-lg text-center tabular-nums ${assignPricingTierColorStyles(station.B7, 'B7')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">Diesel</div><div class="text-[10px] font-black mt-0.5">${station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A'}</div></div>
                </div>`;
            container.appendChild(cardRow);
        });
    } else {
        if (savedRoutes.length === 0) {
            container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No custom routes found.</div>`;
            return;
        }
        container.innerHTML = '';
        savedRoutes.forEach(route => {
            const cardRow = document.createElement('div');
            cardRow.className = "p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-blue-500 transition cursor-pointer active:scale-[0.99] shadow-sm flex items-center justify-between gap-2";
            cardRow.onclick = (event) => {
                event.stopPropagation();
                loadSavedRouteCorridorDataIntoWorkspace(route.id);
                if (window.innerWidth < 768) document.getElementById('starred-dropdown-panel').classList.add('hidden');
            };

            cardRow.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">🛣️ ${route.name}</div>
                    <div class="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wide uppercase mt-1 tabular-nums">MPG: ${route.mpg} • Stops: ${route.waypoints ? route.waypoints.length : 0}</div>
                </div>
                <button onclick="deleteSavedRouteCorridor('${route.id}', event)" class="p-1.5 text-zinc-400 hover:text-rose-500 cursor-pointer rounded-lg hover:bg-rose-500/10 transition focus:outline-none focus:ring-1 focus:ring-rose-500" title="Delete Saved Corridor">
                    ✕
                </button>
            `;
            container.appendChild(cardRow);
        });
    }
}

function openForecourtDetailSheet(stationData) {
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;

    document.getElementById('starred-dropdown-panel').classList.add('hidden');
    activeSheetStation = stationData;

    document.getElementById('sheet-brand-title').textContent = (stationData.brand_name || 'Independent Hub').replace(/['"]/g, '');
    document.getElementById('sheet-address-details').textContent = (stationData.address || 'UK Grid Station').replace(/['"]/g, '');

    document.getElementById('card-wrap-e10').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E10, 'E10')}`;
    document.getElementById('card-wrap-e5').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E5, 'E5')}`;
    document.getElementById('card-wrap-b7').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.B7, 'B7')}`;
    document.getElementById('card-wrap-premiumdiesel').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.PremiumDiesel, 'PremiumDiesel')}`;

    document.getElementById('sheet-price-e10').textContent = stationData.E10 ? `${parseFloat(stationData.E10).toFixed(1)}p` : 'N/A';
    document.getElementById('sheet-price-e5').textContent = stationData.E5 ? `${parseFloat(stationData.E5).toFixed(1)}p` : 'N/A';
    document.getElementById('sheet-price-b7').textContent = stationData.B7 ? `${parseFloat(stationData.B7).toFixed(1)}p` : 'N/A';
    document.getElementById('sheet-price-premiumdiesel').textContent = stationData.PremiumDiesel ? `${parseFloat(stationData.PremiumDiesel).toFixed(1)}p` : 'N/A';

    updateAllStarUIStates();
    sheet.classList.remove('hidden');

    if (window.innerWidth < 768) {
        setMobileSheetUIState('full'); 
    } else {
        sheet.className = sheet.className.replace(/\bdrawer-\w+/g, '');
    }
}

function closeForecourtDetailSheet(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
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
    const structuralIDs = ['global-detail-sheet', 'starred-dropdown-panel', 'primary-control-sidebar'];
    structuralIDs.forEach(id => {
        const node = document.getElementById(id);
        if (node) {
            node.addEventListener('click', (e) => { e.stopPropagation(); });
            node.addEventListener('dblclick', (e) => { e.stopPropagation(); });
        }
    });
}

function bindSwipeGestureDetectionToMobileSheets(handleId, elementId, stateModificationCallback) {
    const targetHandle = document.getElementById(handleId);
    if (!targetHandle) return;

    let touchBaseY = 0;
    let touchCurrentY = 0;
    let touchStartTime = 0;

    targetHandle.addEventListener('touchstart', (e) => {
        touchBaseY = e.touches[0].clientY;
        touchStartTime = Date.now();
    }, { passive: true });

    targetHandle.addEventListener('touchmove', (e) => {
        touchCurrentY = e.touches[0].clientY;
    }, { passive: true });

    targetHandle.addEventListener('touchend', () => {
        const trackDeltaY = touchBaseY - touchCurrentY;
        const timeframeDuration = Date.now() - touchStartTime;
        
        if (Math.abs(trackDeltaY) < 35) return; 

        const velocityPixelsPerMs = Math.abs(trackDeltaY) / timeframeDuration;
        let currentActiveState = (elementId === 'sidebar') ? currentMobileSidebarUIState : currentMobileSheetUIState;

        if (trackDeltaY > 35) {
            if (velocityPixelsPerMs > 0.85 || Math.abs(trackDeltaY) > 160) {
                stateModificationCallback('full');
            } else {
                if (currentActiveState === 'peek') stateModificationCallback('mid');
                else if (currentActiveState === 'mid') stateModificationCallback('full');
            }
        } else if (trackDeltaY < -35) {
            if (velocityPixelsPerMs > 0.85 || Math.abs(trackDeltaY) > 160) {
                if (elementId === 'sidebar') stateModificationCallback('peek');
                else stateModificationCallback('hidden');
            } else {
                if (currentActiveState === 'full') stateModificationCallback('mid');
                else if (currentActiveState === 'mid') {
                    if (elementId === 'sidebar') stateModificationCallback('peek');
                    else stateModificationCallback('hidden');
                }
            }
        }
    });
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


let refuelMarkersGroup = null;

function getDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getNumericInputValue(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    if (el.value && el.value.trim() !== "") {
        const val = parseFloat(el.value);
        return isNaN(val) ? fallback : val;
    }
    if (el.placeholder && el.placeholder.trim() !== "") {
        const val = parseFloat(el.placeholder);
        return isNaN(val) ? fallback : val;
    }
    return fallback;
}

// -------------------------------------------------------------
// CORE CALCULATOR: Smart Refuel Optimization & Savings Logic 
// -------------------------------------------------------------
function calculateOptimalRefuelStrategy() {
    const currentFuelPercentage = parseFloat(document.getElementById('refuel-current-level')?.value) || 0;
    const safetyBufferMiles = parseFloat(document.getElementById('refuel-safety-buffer')?.value) || 0;
    const tankSizeLiters = parseFloat(document.getElementById('refuel-tank-size')?.value) || 55;
    const averageMpg = parseFloat(document.getElementById('vehicle-mpg')?.value) || 40;
    const fuelType = document.getElementById('fuel-type')?.value || 'E10';
    
    const timelineContainer = document.getElementById('refuel-timeline-output');
    const savingsBlock = document.getElementById('smart-refuel-savings-block');
    const savingsValueText = document.getElementById('refuel-savings-value');
    
    if (savingsBlock) savingsBlock.classList.add('hidden');

    let activeDistance = typeof globalRouteDistanceMiles !== 'undefined' ? globalRouteDistanceMiles : 0;
    
    if (!activeDistance || activeDistance === 0 || typeof plottedRouteCoordinates === 'undefined' || plottedRouteCoordinates.length === 0) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = '<p class="text-zinc-400 text-xs text-center py-2 font-medium">Please map a route first.</p>';
        }
        return; 
    }

    // --- 1. MATH FIX: Calculate true remaining range based on tank capacity ---
    const milesPerLiter = averageMpg / 4.54609; 
    const currentLitersInTank = tankSizeLiters * (currentFuelPercentage / 100);
    const bufferLitersNeeded = safetyBufferMiles / milesPerLiter;
    const usableLiters = Math.max(0, currentLitersInTank - bufferLitersNeeded);
    
    // True remaining range in miles (Factoring in the safety buffer)
    const remainingRange = usableLiters * milesPerLiter;
    const totalTripDistance = activeDistance; 
    
    if (remainingRange >= totalTripDistance) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = `
                <div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 p-3.5 rounded-xl text-xs flex flex-col gap-1 shadow-sm">
                    <div class="font-bold flex items-center gap-1">🎉 Fuel Tank Sufficient!</div>
                    <p class="text-zinc-600 dark:text-zinc-400 font-medium leading-normal">Your current range is sufficient to cover this ${totalTripDistance.toFixed(1)} mi trip without additional stops.</p>
                </div>
            `;
        }
        if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup !== null) refuelMarkersGroup.clearLayers();
        return;
    }

    let validStations = currentlyVisibleStations.filter(s => s[fuelType] && parseFloat(s[fuelType]) > 0);
    if (validStations.length === 0 && rawGlobalStationsPool) {
        validStations = rawGlobalStationsPool.filter(s => s[fuelType] && parseFloat(s[fuelType]) > 0);
    }

    if (validStations.length === 0) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = '<p class="text-zinc-400 text-xs text-center py-2 font-medium">No active fuel stations found in range.</p>';
        }
        return;
    }

    let bestStation = null;
    let isEmergencyMode = false;

    // We need the start coordinates to calculate distance to stations
    const startLat = plottedRouteCoordinates[0][0];
    const startLon = plottedRouteCoordinates[0][1];

    // --- 2. EMERGENCY MODE & REACHABILITY FIX ---
    if (currentFuelPercentage <= 5 || usableLiters <= 0) {
        isEmergencyMode = true;
        // Find the absolute closest station to the START of the route
        validStations.sort((a, b) => {
            const distA = computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng));
            const distB = computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng));
            return distA - distB;
        });
        bestStation = validStations[0];
        
    } else {
        // NORMAL MODE: Filter by REACHABILITY first, THEN by price
        let reachableStations = validStations.filter(station => {
            const distFromStart = computeDistanceVectorMiles(
                startLat, startLon, 
                parseFloat(station.latitude || station.lat), 
                parseFloat(station.longitude || station.lng)
            );
            
            // Multiply straight-line distance by 1.2 to safely estimate winding road distance
            const estimatedRoadDistance = distFromStart * 1.2; 
            
            // The station MUST be closer than our usable range (which factors in the Safety Buffer)
            return estimatedRoadDistance <= remainingRange;
        });

        if (reachableStations.length === 0) {
            // We have fuel, but NO stations are within our remaining range!
            // Fallback: Force Emergency Mode and just find the absolute closest station.
            isEmergencyMode = true;
            validStations.sort((a, b) => {
                const distA = computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng));
                const distB = computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng));
                return distA - distB;
            });
            bestStation = validStations[0];
            console.warn("No stations within safe range. Defaulting to absolute closest.");
        } else {
            // We have reachable stations! Now pick the absolute cheapest one.
            reachableStations.sort((a, b) => parseFloat(a[fuelType]) - parseFloat(b[fuelType]));
            bestStation = reachableStations[0];
        }
    }
    
    if (!bestStation) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = `
                <div class="p-4 text-center text-zinc-500 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium">
                    No optimal refueling options found within range along this corridor.
                </div>`;
        }
        return;
    }

    const lat = parseFloat(bestStation.latitude || bestStation.lat || 0);
    const lon = parseFloat(bestStation.longitude || bestStation.lng || 0);
    const bestPrice = parseFloat(bestStation[fuelType] || bestStation.price || 0);
    
    // --- 3. CORE SAVINGS LOGIC ENGINE ---
    const validPrices = rawGlobalStationsPool.map(s => s.prices?.[fuelType] || s[fuelType]).map(parseFloat).filter(p => p && !isNaN(p) && p > 0);
    const averagePrice = validPrices.length > 0 ? (validPrices.reduce((a, b) => a + b, 0) / validPrices.length) : bestPrice;
    
    // How much fuel to buy? If we are empty, fill the tank. Otherwise, fill what's missing.
    const litersToFill = Math.max(0, tankSizeLiters - currentLitersInTank);
    const totalCost = (litersToFill * bestPrice) / 100;
    
    const savingsPence = (averagePrice - bestPrice) * litersToFill;
    const savingsGBP = Math.max(0, savingsPence / 100);

    if (savingsGBP > 0 && savingsValueText) {
        savingsValueText.textContent = `£${savingsGBP.toFixed(2)}`;
        if (savingsBlock) savingsBlock.classList.remove('hidden');
    }
    
    const contextLabel = isEmergencyMode ? 'Nearest Emergency Stop' : 'Optimal Stop';
    const markerContext = isEmergencyMode ? '⚠️ Emergency Refuel' : 'Optimal Refuel Stop';

    // --- NEW: Calculate distance to the chosen stop ---
    // We multiply by 1.2 to match the "Estimated Road Distance" logic used in our reachability filter
    const distanceToStop = computeDistanceVectorMiles(startLat, startLon, lat, lon) * 1.2;

    if (timelineContainer) {
        timelineContainer.classList.remove('hidden');
        timelineContainer.innerHTML = `
            <div class="bg-white/80 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 p-4 rounded-xl text-xs space-y-3 shadow-sm tabular-nums">
                
                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2">
                    <span class="text-zinc-500 font-medium">Start to Destination</span>
                    <span class="font-bold text-zinc-900 dark:text-white">${totalTripDistance.toFixed(1)} miles</span>
                </div>
                
                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2">
                    <span class="text-zinc-500 font-medium pt-1">${contextLabel}</span>
                    <div class="text-right">
                        <span class="font-bold text-zinc-900 dark:text-white block">${(bestStation.brand_name || 'Station').replace(/['"]/g, '')}</span>
                        <span class="text-[10px] text-zinc-400 block">${(bestStation.address || '').replace(/['"]/g, '')}</span>
                    </div>
                </div>

                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2">
                    <span class="text-zinc-500 font-medium">Distance to Stop</span>
                    <span class="font-bold text-zinc-900 dark:text-white">~${distanceToStop.toFixed(1)} miles</span>
                </div>
                
                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2">
                    <span class="text-zinc-500 font-medium">Vehicle Mileage</span>
                    <span class="font-bold text-zinc-900 dark:text-white">${averageMpg} MPG</span>
                </div>
                
                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2 bg-emerald-50/50 dark:bg-emerald-950/20 -mx-4 px-4 py-2">
                    <span class="text-emerald-700 dark:text-emerald-500 font-bold">Action</span>
                    <span class="font-black text-emerald-700 dark:text-emerald-400">Fill ${litersToFill.toFixed(1)} Litres</span>
                </div>
                
                <div class="flex justify-between pt-1 items-center">
                    <span class="text-zinc-500 font-medium">Estimated Cost</span>
                    <div class="text-right">
                        <span class="font-black text-zinc-900 dark:text-white text-lg">£${totalCost.toFixed(2)}</span>
                        <span class="text-[10px] text-zinc-400 block">@ ${bestPrice.toFixed(1)}p/L</span>
                    </div>
                </div>

                <button type="button" onclick="focusAndHighlightMapMarker(${lat}, ${lon})" class="w-full mt-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-white text-[11px] font-bold py-3 rounded-lg transition active:scale-[0.98] shadow-sm tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 dark:focus:ring-white">
                    View Station on Map
                </button>
            </div>
        `;
    }

    let activeMarkerGroup = null;
    
    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup !== null) {
        activeMarkerGroup = refuelMarkersGroup;
    } else if (typeof window.refuelMarkersGroup !== 'undefined' && window.refuelMarkersGroup !== null) {
        activeMarkerGroup = window.refuelMarkersGroup;
    } else {
        activeMarkerGroup = L.layerGroup().addTo(map);
        try { refuelMarkersGroup = activeMarkerGroup; } catch(e) {}
        window.refuelMarkersGroup = activeMarkerGroup;
    }

    activeMarkerGroup.clearLayers();

    const customFuelIcon = L.divIcon({
        className: 'custom-fuel-icon',
        html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-amber-500 border-white dark:border-zinc-900'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">⛽</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    });
    
    L.marker([lat, lon], { icon: customFuelIcon, station_id: bestStation.id || 'refuel-node' })
        .bindPopup(`<strong class="text-xs text-zinc-900 dark:text-white font-black block mb-0.5">${markerContext}</strong><span class="text-[11px] ${isEmergencyMode ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'} font-bold block tabular-nums">${bestPrice.toFixed(1)}p/L</span>`)
        .addTo(activeMarkerGroup);
}

function clearFuelOptimizationState() {
    const inputTank = document.getElementById('refuel-tank-size');
    const inputStarting = document.getElementById('refuel-current-level');
    const inputReserve = document.getElementById('refuel-safety-buffer');

    if (inputTank) inputTank.value = "55";
    if (inputStarting) inputStarting.value = "25";
    if (inputReserve) inputReserve.value = "10";

    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) {
        refuelMarkersGroup.clearLayers();
    }

    const timelineContainer = document.getElementById('refuel-timeline-output');
    if (timelineContainer) {
        timelineContainer.innerHTML = '';
        timelineContainer.classList.add('hidden');
    }

    const savingsBlock = document.getElementById('smart-refuel-savings-block');
    if (savingsBlock) {
        savingsBlock.classList.add('hidden');
    }

    console.log("Fuel Optimization interface states successfully defaulted.");
}

// -------------------------------------------------------------
// LAUNCH PROTOCOLS & EVENT BINDINGS
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    initializeSpatialMapEngine();
    applyThemeChangesToDOM();
    setupAutocompleteListeners();
    initializeClickIsolationBubbling();
    initializeGestureTrackEngine();
    forceReloadRemotePipelineData();

    // Hook inputs to dynamic reactive rendering engines
    // 1. Inputs that should ONLY trigger the general station filtering (Radius, Fuel Type)
    const mapFilteringInputs = ['fuel-type', 'radius-slider', 'route-radius-slider'];
    mapFilteringInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => executeStationDataFilteringPipeline());
            el.addEventListener('input', () => { if (el.type === 'range') executeStationDataFilteringPipeline(); });
        }
    });

    // 2. Inputs that should ONLY trigger the Smart Refuel math (Tank Size, Current Fuel, Buffer, MPG)
    const smartRefuelInputs = ['refuel-current-level', 'refuel-safety-buffer', 'refuel-tank-size', 'vehicle-mpg'];
    smartRefuelInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // Only fire the math, don't redraw the whole station map!
            el.addEventListener('change', () => {
                 if (activeTabContext === 'route') {
                     calculateOptimalRefuelStrategy();
                 }
            });
        }
    });
    

    const tabStationsBtn = document.getElementById('dir-tab-stations');
    const tabRoutesBtn = document.getElementById('dir-tab-routes');

    if (tabStationsBtn) {
        tabStationsBtn.addEventListener('click', () => {
            activeDirectoryTab = 'stations';
            renderDirectoryDropdown();
        });
    }
    if (tabRoutesBtn) {
        tabRoutesBtn.addEventListener('click', () => {
            activeDirectoryTab = 'routes';
            renderDirectoryDropdown();
        });
    }
        
    if (window.innerWidth < 768) {
        setMobileSidebarState('peek');
    }
});
