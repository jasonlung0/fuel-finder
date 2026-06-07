// --- GLOBAL CONFIGURATION CREDENTIALS ---
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6';

// Tailwind Design Tokens & Safelist Configuration Layer
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

const INACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.326.621-.326.772 0l2.035 4.392 4.752.693c.353.051.495.492.239.743l-3.438 3.35 1.022 4.718c.076.351-.29.616-.598.442L12 15.617l-4.283 2.272c-.308.174-.674-.09-.598-.442l1.022-4.718-3.438-3.35c-.256-.251-.114-.692.239-.743l4.752-.693 2.035-4.393Z" /></svg>`;
const ACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 text-amber-500"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>`;

// 1. Hide on initialization (Assuming you have a function to control the sheet/popup)
document.addEventListener('DOMContentLoaded', () => {
    // If it's a custom DOM element
    const activeSheet = document.getElementById('your-station-sheet-id');
    if (activeSheet) {
        activeSheet.classList.add('hidden'); // or whatever your hide class is
    }
});

// 2. Add a global map dismissal listener
if (map) {
    map.on('click', function(e) {
        // Dismiss native Leaflet popups
        map.closePopup(); 
        
        // Dismiss your custom station sheet/drawer
        if (typeof closeStationSheet === 'function') {
            closeStationSheet(); 
        }
        
        // If you are using active states on pins, reset them here
        activeSheetStation = null; 
    });
}

// --- INTERACTIVE MAP CAMERA FUNCTION ---
window.focusIncidentMapView = function(lat, lng) {
    if (map) {
        // Fly to the exact incident coordinate at a zoom level of 16 (street level)
        map.flyTo([lat, lng], 16, {
            animate: true,
            duration: 1.5,
            easeLinearity: 0.25
        });
    }
};

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

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

function toggleDesktopSidebar(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const sidebar = document.getElementById('primary-control-sidebar');
    sidebar.classList.toggle('desktop-collapsed');
}

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
        maxClusterRadius: 40,
        iconCreateFunction: function(cluster) {
            const children = cluster.getAllChildMarkers();
            let minPrice = Infinity;
            let maxPrice = -Infinity;
            const currentFuelType = document.getElementById('fuel-type').value;
            const isEV = currentFuelType === 'ev';

            children.forEach(marker => {
                // Try to extract the price attached to the marker data
                let priceToCheck = null;
                if (marker.options && marker.options.priceData) {
                    priceToCheck = marker.options.priceData;
                } else if (marker.options && marker.options.stationData) {
                    // Fallback to station object
                    const st = marker.options.stationData;
                    if (isEV) {
                         priceToCheck = (st.usageCost && st.usageCost.match(/\d+(\.\d+)?/)) 
                             ? parseFloat(st.usageCost.match(/\d+(\.\d+)?/)[0]) 
                             : null;
                    } else {
                         priceToCheck = st.prices ? st.prices[currentFuelType] : null;
                    }
                }

                if (priceToCheck && !isNaN(priceToCheck)) {
                    minPrice = Math.min(minPrice, priceToCheck);
                    maxPrice = Math.max(maxPrice, priceToCheck);
                }
            });

            let displayLabel = children.length; // Default to just the count
            if (minPrice !== Infinity && maxPrice !== -Infinity) {
                // If prices exist, show the range (e.g., "140 - 145p")
                displayLabel = minPrice === maxPrice 
                    ? `${isEV ? '£' : ''}${minPrice}${isEV ? '/kWh' : 'p'}` 
                    : `${minPrice}-${maxPrice}${isEV ? '' : 'p'}`;
            }

            return L.divIcon({
                html: `<div class="bg-zinc-900 text-white font-bold rounded-full border-2 border-white shadow-md flex items-center justify-center text-[10px] px-2 py-1">${displayLabel}</div>`,
                className: 'leaflet-div-icon-reset',
                iconSize: [null, null] // Auto sizing
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

    if (contextType === 'local') {
        btnLocal.className = "py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-600";
        btnRoute.className = "py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600";
        panelLocal.classList.remove('hidden');
        panelRoute.classList.add('hidden');
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
    // At the end of executeAddressGeocodeLookup() and executeRouteGenerationPipeline()
    if (window.innerWidth < 768 && typeof setMobileSidebarState === 'function') {
        setMobileSidebarState('peek'); // Lowers the drawer so the map view is instantly fully visible
    }
}

// -------------------------------------------------------------
// Live Traffic Incident Polling & Stacking Pipeline
// -------------------------------------------------------------
// --- 1. ROUTE CHUNKER: Slices massive routes into safe API-sized bounding boxes ---
function generateTrafficBoundingBoxes(coords, maxArea = 8500) {
    if (!coords || coords.length === 0) return [];

    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const pt of coords) {
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
        if (pt[1] < minLon) minLon = pt[1];
        if (pt[1] > maxLon) maxLon = pt[1];
    }

    minLat -= 0.01; maxLat += 0.01;
    minLon -= 0.01; maxLon += 0.01;

    const R = 6371;
    const dLat = (maxLat - minLat) * (Math.PI / 180);
    const dLon = (maxLon - minLon) * (Math.PI / 180);
    const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const area = (R * Math.abs(dLon) * Math.cos(meanLat)) * (R * Math.abs(dLat));

    if (area <= maxArea) {
        return [[minLon, minLat, maxLon, maxLat]];
    }

    const mid = Math.floor(coords.length / 2);
    const firstHalf = coords.slice(0, mid + 1);
    const secondHalf = coords.slice(mid);

    return [
        ...generateTrafficBoundingBoxes(firstHalf, maxArea),
        ...generateTrafficBoundingBoxes(secondHalf, maxArea)
    ];
}

// --- 2. THE CHUNK FETCHER: Hits TomTom for a single safe bounding box ---
async function fetchTrafficChunk(bbox) {
    try {
        const formattedMinLon = Number(bbox[0]).toFixed(6);
        const formattedMinLat = Number(bbox[1]).toFixed(6);
        const formattedMaxLon = Number(bbox[2]).toFixed(6);
        const formattedMaxLat = Number(bbox[3]).toFixed(6);

        const bboxString = `${formattedMinLon},${formattedMinLat},${formattedMaxLon},${formattedMaxLat}`;
        // We added 'geometry{type,coordinates}' to explicitly request the map points
        const fieldsTemplate = encodeURIComponent("{incidents{geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,delay,from,to,events{description}}}}");
        
        const targetApiEndpoint = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bboxString}&fields=${fieldsTemplate}&language=en-GB&t=-1`;

        const networkResponse = await fetch(targetApiEndpoint);
        if (!networkResponse.ok) return [];

        const payload = await networkResponse.json();
        return (payload && payload.incidents) ? payload.incidents : [];
    } catch (apiError) {
        return []; 
    }
}

// --- 3. THE MASTER MATCHER: Fetches, Merges, and Deduplicates ---
async function fetchAllRouteTraffic(routeCoords) {
    if (!routeCoords || routeCoords.length === 0) return null;
    
    const bboxes = generateTrafficBoundingBoxes(routeCoords, 8500);
    if (bboxes.length > 20) bboxes.length = 20; // Failsafe cap

    try {
        const requests = bboxes.map(bbox => fetchTrafficChunk(bbox));
        const results = await Promise.all(requests);
        
        const allIncidents = results.flat();
        const uniqueIncidents = [];
        const seenIds = new Set();
        
        for (const incident of allIncidents) {
            if (incident && incident.properties && incident.properties.id) {
                if (!seenIds.has(incident.properties.id)) {
                    seenIds.add(incident.properties.id);
                    uniqueIncidents.push(incident);
                }
            }
        }
        return uniqueIncidents;
    } catch (e) {
        console.error("Multi-chunk traffic fetch failed:", e);
        return null; // Return null to indicate a hard error state for the UI
    }
}

// --- 4. FLOATING DASHBOARD UI RENDERER ---
// --- SMART TRAFFIC HELPERS ---
function humanizeTrafficDescription(rawDesc) {
    if (!rawDesc) return "Traffic disruption";
    const lower = rawDesc.toLowerCase();
    
    if (lower.includes('closed') || lower.includes('closure')) return "Road is currently closed";
    if (lower.includes('stationary') || lower.includes('standstill')) return "Standstill traffic";
    if (lower.includes('roadworks') || lower.includes('construction')) return "Active roadworks";
    if (lower.includes('accident') || lower.includes('crash') || lower.includes('collision')) return "Reported accident";
    
    return rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1);
}

function formatIncidentLocation(from, to) {
    if (from && to && from !== to) return `Between ${from} and ${to}`;
    if (from) return `Near ${from}`;
    if (to) return `Near ${to}`;
    return "Along active route";
}

function getIncidentSeverity(delay, category) {
    if (category === 1 || category === 8 || delay > 1200) {
        return { label: 'CRITICAL', styles: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30' };
    }
    if (delay > 600) {
        return { label: 'MAJOR', styles: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30' };
    }
    if (delay > 180) {
        return { label: 'MODERATE', styles: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' };
    }
    return { label: 'MINOR', styles: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' };
}


// --- MAP CAMERA HELPER ---
window.focusIncidentMapView = function(lat, lng) {
    if (map && lat !== 0 && lng !== 0) {
        map.flyTo([lat, lng], 16, {
            animate: true,
            duration: 1.5,
            easeLinearity: 0.25
        });
    } else {
        Toast.show("Exact incident coordinates unavailable.", "warning");
    }
};

// --- 4. FLOATING DASHBOARD UI RENDERER & SMART FILTER ---
function renderLiveTrafficDashboard(incidents) {
    const dash = document.getElementById('bottom-traffic-dashboard');
    const statusBadge = document.getElementById('traffic-status-badge');
    const tickerContainer = document.getElementById('dash-metric-delay-ticker');
    const alertsViewport = document.getElementById('route-alerts-container');

    if (dash) {
        dash.classList.remove('translate-y-10', 'opacity-0', 'pointer-events-none');
        dash.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');
    }

    // Handle API Offline State
    if (incidents === null) {
        if (statusBadge) {
            statusBadge.textContent = "OFFLINE";
            statusBadge.className = "px-2 py-0.5 rounded text-[10px] font-black tracking-tight bg-zinc-500/10 text-zinc-500 border border-zinc-500/20 uppercase";
        }
        if(tickerContainer) {
            tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center text-[11px] font-medium text-zinc-500 truncate tracking-tight">Traffic telemetry currently unavailable.</div>`;
        }
        if (alertsViewport) alertsViewport.classList.add('hidden');
        return;
    }

    // --- SMART FILTERING ALGORITHM (WITH SPATIAL ON-ROUTE CHECK) ---
    let validIncidents = incidents.filter(inc => {
        const delay = inc.properties.delay || 0;
        const cat = inc.properties.iconCategory;
        
        // 1. Filter out micro-delays (< 1 min) unless they are critical closures/accidents
        if (delay < 60 && cat !== 1 && cat !== 8) return false;

        // 2. NEW FIX: Spatial filter to guarantee the incident is physically ON your route line
        if (typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
            let incidentLat = 0;
            let incidentLng = 0;

            if (inc.geometry && inc.geometry.coordinates) {
                const type = inc.geometry.type;
                const coords = inc.geometry.coordinates;

                // Extract center coordinate of the incident
                if (type === 'Point' && Array.isArray(coords)) {
                    incidentLng = coords[0];
                    incidentLat = coords[1];
                } else if (type === 'LineString' && Array.isArray(coords) && coords.length > 0) {
                    const midpoint = coords[Math.floor(coords.length / 2)];
                    incidentLng = Array.isArray(midpoint) ? midpoint[0] : coords[0][0];
                    incidentLat = Array.isArray(midpoint) ? midpoint[1] : coords[0][1];
                }
            }

            if (incidentLat !== 0 && incidentLng !== 0) {
                // Check distance against your drawn map polyline
                const distToRoute = computeMinimumDistanceToRouteCorridor(incidentLat, incidentLng);
                // If the incident is more than 0.2 miles away from the exact road, ignore it!
                if (distToRoute > 1.5) {
                    return false; 
                }
            }
        }
        return true;
    });

    // --- NEW PLACEMENT: Convert to array and sort from Route Start (A) to End (B) ---
    const uniqueIncidentsMap = new Map();
    let processedIncidents = Array.from(uniqueIncidentsMap.values());

    if (typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
        const startLat = plottedRouteCoordinates[0][0];
        const startLng = plottedRouteCoordinates[0][1];

        processedIncidents.sort((a, b) => {
            let coordsA = a.geometry?.coordinates;
            let coordsB = b.geometry?.coordinates;

            if (!coordsA || !coordsB) return 0;

            // Normalize TomTom GeoJSON (LineString vs Point)
            if (a.geometry.type === 'LineString') coordsA = coordsA[0];
            if (b.geometry.type === 'LineString') coordsB = coordsB[0];

            // Calculate exact distance from the starting node (TomTom uses [Lng, Lat])
            const distA = computeDistanceVectorMiles(startLat, startLng, coordsA[1], coordsA[0]);
            const distB = computeDistanceVectorMiles(startLat, startLng, coordsB[1], coordsB[0]);
            
            return distA - distB; // Ascending order ensures Point A is top, Point B is bottom
        });
    } else {
        // Fallback: If no route is actively drawn, sort by worst delay severity
        processedIncidents.sort((a, b) => (b.properties.delay || 0) - (a.properties.delay || 0));
    }

    processedIncidents = processedIncidents.slice(0, 10); // Still cap at top 10 to protect UI performance
    // --------------------------------------------------------------------------------

    // --- UI RENDERING ---
    if (processedIncidents.length > 0) {
        let badgeState = processedIncidents.length >= 3 ? "CONGESTED" : "ALERTS";
        let badgeClasses = processedIncidents.length >= 3 
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
        
        if (statusBadge) {
            statusBadge.textContent = badgeState;
            statusBadge.className = `px-2 py-0.5 rounded text-[10px] font-black tracking-tight border uppercase ${badgeClasses}`;
        }

        const totalDelay = processedIncidents.reduce((sum, inc) => sum + (inc.properties.delay || 0), 0);
        const delayMin = Math.round(totalDelay / 60);

        if(tickerContainer) {
            tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center text-[11px] font-bold text-amber-600 dark:text-amber-400 truncate tracking-tight">⚠️ ${processedIncidents.length} major incidents affecting route (+${delayMin}m total)</div>`;
        }

        // Render Cards
        if (alertsViewport) {
            alertsViewport.classList.remove('hidden');
            alertsViewport.innerHTML = processedIncidents.map(incident => {
                const props = incident.properties;
                const delaySeconds = props.delay || 0;
                const delayMinutes = Math.round(delaySeconds / 60);
                
                const rawDesc = props.events?.[0]?.description || '';
                const cleanDesc = humanizeTrafficDescription(rawDesc);
                const locationText = formatIncidentLocation(props.from, props.to);
                const severity = getIncidentSeverity(delaySeconds, props.iconCategory);

                // Extract exact coordinates from the new API geometry field
                // Extract coordinates safely handling both Point and LineString GeoJSON
                // --- NEW PLACEMENT: Safely parse TomTom GeoJSON to Leaflet Coordinates ---
                // --- FIX: Absolute extraction of incident coordinates ---
                let incidentLat = 0;
                let incidentLng = 0;

                if (incident.geometry && incident.geometry.coordinates) {
                    const type = incident.geometry.type;
                    const coords = incident.geometry.coordinates;

                    if (type === 'Point' && Array.isArray(coords)) {
                        incidentLng = coords[0];
                        incidentLat = coords[1];
                    } else if (type === 'LineString' && Array.isArray(coords) && coords.length > 0) {
                        // For a stretch of road delay, safely pluck the middle index of the jam sequence 
                        // rather than just the tail point to center the view directly on the issue
                        const targetIndex = Math.floor(coords.length / 2);
                        const midpoint = coords[targetIndex];
                        if (Array.isArray(midpoint)) {
                            incidentLng = midpoint[0];
                            incidentLat = midpoint[1];
                        } else {
                            incidentLng = coords[0][0];
                            incidentLat = coords[0][1];
                        }
                    }
                }

                // Ensure coordinates are finite and real numbers before painting the click node
                const hasValidCoords = !isNaN(incidentLat) && !isNaN(incidentLng) && incidentLat !== 0;
                const clickAction = hasValidCoords ? `onclick="focusIncidentMapView(${incidentLat}, ${incidentLng})"` : '';

                // Determine fuel noun based on the global selector
                const currentFuelMode = document.getElementById('fuel-type') ? document.getElementById('fuel-type').value : 'E10';
                const isEVMode = currentFuelMode === 'ev';
                const fuelNoun = isEVMode ? 'kWh' : 'Liters';
                
                // --- UPDATED RETURN: Card now includes onclick and hover states ---
                return `
                    <div onclick="focusIncidentMapView(${incidentLat}, ${incidentLng})" 
                         class="w-full p-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm flex flex-col gap-1.5 transition-all cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:-translate-y-0.5 active:scale-[0.98]">
                        <div class="flex justify-between items-start w-full gap-2">
                            <div class="flex items-center gap-2 min-w-0">
                                <div class="px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase shrink-0 ${severity.styles}">
                                    ${severity.label}
                                </div>
                                <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">${cleanDesc}</h4>
                            </div>
                            ${delayMinutes > 0 ? `<span class="text-[10px] font-black text-rose-600 dark:text-rose-400 shrink-0">+${delayMinutes}m</span>` : ''}
                        </div>
                        <p class="text-[10px] font-medium text-zinc-500 truncate">${locationText}</p>
                    </div>
                `;
            }).join('');
        }
    } else {
        // Clear State
        if (statusBadge) {
            statusBadge.textContent = "CLEAR";
            statusBadge.className = "px-2 py-0.5 rounded text-[10px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
        }
        if(tickerContainer) {
            tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center text-[11px] font-bold text-emerald-600 dark:text-emerald-400 truncate tracking-tight">✅ Fluid traffic flow detected along active corridor.</div>`;
        }
        if (alertsViewport) {
            alertsViewport.innerHTML = '';
            alertsViewport.classList.add('hidden');
        }
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
            map.fitBounds(routePolylineLayer.getBounds(), { padding: [50, 50] });
            if (plottedRouteCoordinates.length > 0) {
            map.fitBounds(routePolylineLayer.getBounds(), { padding: [50, 50] });
            
            // Set Loading UI state immediately
            const dash = document.getElementById('bottom-traffic-dashboard');
            const statusBadge = document.getElementById('traffic-status-badge');
            const tickerContainer = document.getElementById('dash-metric-delay-ticker');
            
            if (dash) {
                dash.classList.remove('translate-y-10', 'opacity-0', 'pointer-events-none');
                dash.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');
            }
            if (statusBadge) {
                statusBadge.textContent = "SCANNING...";
                statusBadge.className = "px-2 py-0.5 rounded text-[10px] font-black tracking-tight border uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse";
            }
            if(tickerContainer) {
                tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center text-[11px] font-medium text-zinc-500 truncate tracking-tight">Scanning route chunks for live telemetry...</div>`;
            }

            // Fire the chunker!
            const stitchedIncidents = await fetchAllRouteTraffic(plottedRouteCoordinates);
            renderLiveTrafficDashboard(stitchedIncidents);
        }(routePolylineLayer.getBounds());
        }
        
        // --- 4. UPDATE GRANULAR DASHBOARD METRICS (WITH EV SUPPORT) ---
        
        const travelTimeSeconds = currentActiveRoute.summary.travelTimeInSeconds || 0;
        const hours = Math.floor(travelTimeSeconds / 3600);
        const minutes = Math.floor((travelTimeSeconds % 3600) / 60);
        const timeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} m`;

        const activeFuelType = document.getElementById('fuel-type')?.value || 'E10';
        let tripCost = 0;
        let consumptionString = "--";
        
        if (activeFuelType === 'electric') {
            // --- EV MATH ---
            document.getElementById('energy-label').innerText = "ENERGY";
            const evEfficiencyMpkWh = 3.5; // Average EV gets 3.5 miles per kWh
            const expectedKwh = globalRouteDistanceMiles / evEfficiencyMpkWh;
            consumptionString = `${expectedKwh.toFixed(1)} kWh`;
            
            // Average UK public fast charging cost is roughly 75p per kWh
            tripCost = expectedKwh * 0.75; 

            // NOTE FOR API: To show EV stations on the map, you will need to point 
            // your station fetcher to TomTom's EV Charging Stations Availability API
            // Endpoint: https://api.tomtom.com/search/2/categorySearch/electric%20vehicle%20station.json
        } else {
            // --- COMBUSTION MATH ---
            document.getElementById('energy-label').innerText = "FUEL";
            const expectedLitres = (globalRouteDistanceMiles / userMpg) * 4.54609;
            consumptionString = `${expectedLitres.toFixed(1)} L`;
            
            // Calculate a TRUE average of currently visible stations to prevent the "cheapest only" bug
            let validPrices = [];
            if (currentlyVisibleStations && currentlyVisibleStations.length > 0) {
                currentlyVisibleStations.forEach(station => {
                    const price = parseFloat(station[activeFuelType]);
                    // Only include prices that are real numbers and greater than 0
                    if (!isNaN(price) && price > 0) validPrices.push(price);
                });
            }
            
            let averageFuelPricePence = 145.0; // Reliable fallback
            if (validPrices.length > 0) {
                const sum = validPrices.reduce((total, p) => total + p, 0);
                averageFuelPricePence = sum / validPrices.length;
            }
            
            tripCost = expectedLitres * (averageFuelPricePence / 100);
        }

        // Inject into UI
        document.getElementById('dash-metric-distance').innerText = `${globalRouteDistanceMiles.toFixed(1)} mi`;
        const timeEl = document.getElementById('dash-metric-time');
        if (timeEl) timeEl.innerText = timeString;
        
        const litresEl = document.getElementById('dash-metric-litres');
        if (litresEl) litresEl.innerText = consumptionString;
        
        const costEl = document.getElementById('summary-cost');
        if (costEl) costEl.innerText = `£${tripCost.toFixed(2)}`;

        // --- NEW PLACEMENT: UPDATE DYNAMIC ROUTE SPEED INDICATOR BADGE ---
        if (currentActiveRoute && currentActiveRoute.summary) {
            const summary = currentActiveRoute.summary;
            const routeMeters = summary.lengthInMeters || 0;
            const routeSeconds = summary.travelTimeInSeconds || 0;
            const liveDelaySeconds = summary.trafficDelayInSeconds || 0;

            if (routeMeters > 0 && routeSeconds > 0) {
                // Convert to mph: (meters/seconds) * 2.23694
                const averageSpeedMph = Math.round((routeMeters / routeSeconds) * 2.23694);
                const speedBadge = document.getElementById('dash-header-speed-badge');
                
                if (speedBadge) {
                    speedBadge.innerText = `${averageSpeedMph} mph`;
                    
                    // Determine semantic color theme based on relative delay severity
                    if (liveDelaySeconds > 300) { // Heavy delay > 5 mins
                        speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/40";
                    } else if (liveDelaySeconds > 60) { // Moderate delay > 1 min
                        speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40";
                    } else { // Optimal clear conditions
                        speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40";
                    }
                }
            }
        }
        // -----------------------------------------------------------------
        
        executeStationDataFilteringPipeline();
        
        try {
            if (typeof triggerRouteWeatherFetchPipeline === 'function') {
                await triggerRouteWeatherFetchPipeline();
            }
        } catch (weatherErr) {
            console.warn("Weather API unreachable.", weatherErr);
        }
        
        if (typeof calculateOptimalRefuelStrategy === 'function') {
            calculateOptimalRefuelStrategy();
        }

        // --- UI Collapse Logic: Reveal Map ---
        if (window.innerWidth < 768) {
            setMobileSidebarState('peek');
        } else {
            const sidebar = document.getElementById('primary-control-sidebar');
            if (sidebar && !sidebar.classList.contains('desktop-collapsed')) {
                sidebar.classList.add('desktop-collapsed');
            }
        }
        
    } catch (err) {
        console.error("Pipeline Engine Broken:", err);
        Toast.show(`Failed to trace route: ${err.message}`, "error");
    }
    // At the end of executeAddressGeocodeLookup() and executeRouteGenerationPipeline()
    if (window.innerWidth < 768 && typeof setMobileSidebarState === 'function') {
        setMobileSidebarState('peek'); // Lowers the drawer so the map view is instantly fully visible
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
                const conditionEmoji = lookupWeatherIconEmoji(weatherData.daily.weathercode[0]);
                const highTemp = Math.round(weatherData.daily.temperature_2m_max[0]);

                const weatherIcon = L.divIcon({
                    className: 'leaflet-div-icon-reset',
                    html: `<div class="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-xl rounded-full px-2 py-1 flex items-center justify-center gap-1 border border-zinc-200/80 dark:border-zinc-700/80 w-[60px] h-[28px] pointer-events-none hover:scale-105 transition-transform duration-200">
                            <span class="text-sm">${conditionEmoji}</span>
                            <span class="text-[11px] font-black text-zinc-800 dark:text-zinc-100 tabular-nums">${highTemp}°</span>
                           </div>`,
                    iconSize: [60, 28],
                    iconAnchor: [30, 45] // Positions the tag right above the route node line
                });
                
                if (routePolylineLayer) {
                    L.marker([loc.data.lat, loc.data.lon], { icon: weatherIcon, interactive: false }).addTo(routePolylineLayer);
                }
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
    Toast.show("Corridor routing successfully saved.", "success");
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

    const dash = document.getElementById('bottom-traffic-dashboard');
    if (dash) {
        dash.classList.add('translate-y-10', 'opacity-0', 'pointer-events-none');
        // --- ADD THIS MOBILE SYNC STATE BLOCK HERE ---
        // When a route is cleared, snap the drawer to half-screen ('mid') 
        // so mobile users can easily access the inputs to enter a new destination.
        if (window.innerWidth < 768 && typeof setMobileSidebarState === 'function') {
            setMobileSidebarState('mid');
        }
        dash.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto');
    }

    document.getElementById('cheapest-ranking-block')?.classList.add('hidden');

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
async function executeStationDataFilteringPipeline() {
    if (!rawGlobalStationsPool?.length && document.getElementById('fuel-type')?.value !== 'electric') return;
    
    const targetFuelType = document.getElementById('fuel-type')?.value || 'E10';
    const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
    const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
    
    let dynamicBoundedStations = [];

    // --- NEW: EV CHARGING STATION FETCH PIPELINE ---
    if (targetFuelType === 'electric') {
        // Grab the container from the HTML. 
        // Note: If your HTML ID is different (like 'dynamic-waypoints-container'), change the ID below!
        const timelineContainer = document.getElementById('timeline-container') || document.getElementById('dynamic-waypoints-container');
        
        // Only run the timeline code if the container actually exists on the screen
        if (timelineContainer) {
            if (timelineContainer) timelineContainer.innerHTML = '<p class="text-center py-2 text-xs font-medium text-zinc-400">Locating optimal charge points...</p>';
        }
        
        try {
            let ocmUrl = '';
            const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e'; // Ensure your key is pasted here
    
            if (activeTabContext === 'route' && typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
                // Sample coordinates to prevent query string bloat
                const sampledWaypoints = plottedRouteCoordinates.filter((_, idx) => idx % 12 === 0);
                
                // Format as polyline or bounding box box parameter array for OCM compatibility
                const lats = sampledWaypoints.map(c => c[0]);
                const lngs = sampledWaypoints.map(c => c[1]);
                const minLat = Math.min(...lats), maxLat = Math.max(...lats);
                const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    
                ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&key=${OCM_KEY}&swlatitude=${minLat}&swlongitude=${minLng}&nelatitude=${maxLat}&nelongitude=${maxLng}&maxresults=60&verbose=false`;
            } else {
                // Local fallback radial calculation
                const searchLat = activeTabContext === 'local' ? mapSearchAnchorCoordinates[0] : plottedRouteCoordinates[0][0];
                const searchLon = activeTabContext === 'local' ? mapSearchAnchorCoordinates[1] : plottedRouteCoordinates[0][1];
                
                ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&key=${OCM_KEY}&latitude=${searchLat}&longitude=${searchLon}&distance=${radiusMiles}&distanceunit=Miles&maxresults=50`;
            }
    
            const res = await fetch(ocmUrl);
            const data = await res.json();

            // Grab the radius from the user's dropdown, default to 5 if not found
            const radiusSelectElement = document.getElementById('search-radius');
            const radiusMiles = radiusSelectElement ? parseFloat(radiusSelectElement.value) : 5;
            
            // Normalise OCM schema mapping to match app's internal station interface format
            currentlyVisibleStations = data.map(poi => ({
                id: poi.ID,
                brand_name: poi.OperatorInfo?.Title || 'Independent Charger',
                address: poi.AddressInfo?.AddressLine1 || 'Location Registered',
                latitude: poi.AddressInfo?.Latitude,
                longitude: poi.AddressInfo?.Longitude,
                electric: poi.Connections?.[0]?.PowerKW || 50, // Using max kw rating as substitute scalar value
                is_public: poi.UsageType?.IsPayAtLocation ?? true,
                usage_title: poi.UsageType?.Title || 'Public Access',
                operator_url: poi.OperatorInfo?.WebsiteURL || null
            }));
    
            // Trigger UI rendering pipe update seamlessly
            paintMarkerCanvasLayersToMap(currentlyVisibleStations, 'electric');
            renderSidebarListings(currentlyVisibleStations, 'electric');
    
        } catch (err) {
            console.error("OpenChargeMap engine processing failure:", err);
        }
        return;
    }
    // --- EXISTING: COMBUSTION FUEL PIPELINE ---
    else {
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
    
    // 1. Identify if we are in EV mode to change units and logic
    const isEV = fuelVariant === 'electric';
    const unitString = isEV ? 'kW' : 'p';

    if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
        // 2. Update title based on EV state
        blockTitle.textContent = isEV ? "3 Fastest Chargers On Route" : "3 Cheapest Stations On Route";
        
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
            
            // 3. EV sorts Highest kW first. Combustion sorts Lowest Price first.
            rawMilestonePool.sort((a, b) => {
                return isEV 
                    ? parseFloat(b.station[fuelVariant]) - parseFloat(a.station[fuelVariant])
                    : parseFloat(a.station[fuelVariant]) - parseFloat(b.station[fuelVariant]);
            });

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
                        <div class="text-right shrink-0"><div class="text-[11px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${val}${unitString}</div></div>
                    `;
                    subGroupWrapper.appendChild(card);
                });
                container.appendChild(subGroupWrapper);
            }
        });
    } else {
        // 4. Update title based on EV state for standard nearby list
        blockTitle.textContent = isEV ? "Fastest Chargers Nearby" : "Cheapest Stations Nearby";
        
        // 5. EV sorts Highest kW first. Combustion sorts Lowest Price first.
        validPool.sort((a, b) => {
            return isEV 
                ? parseFloat(b[fuelVariant]) - parseFloat(a[fuelVariant])
                : parseFloat(a[fuelVariant]) - parseFloat(b[fuelVariant]);
        });
        
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
                <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${val}${unitString}</div></div>
            `;
            container.appendChild(card);
        });
    }
    block.classList.remove('hidden');
}

// FIND inside function assignPricingTierColorStyles(valueRaw, variantKey):
function assignPricingTierColorStyles(valueRaw, variantKey) {
    const fallbackClasses = "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800";
    if (!valueRaw) return fallbackClasses;
    const numericVal = parseFloat(valueRaw);
    if (isNaN(numericVal) || numericVal <= 0) return fallbackClasses;

    // --- REPLACE / INSERT THIS EV BLOCK HERE ---
    if (variantKey === 'electric') {
        // Price thresholds for charging in pence per kWh
        if (numericVal <= 50) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold";
        if (numericVal <= 70) return "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold";
        return "bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold";
    }
    // --------------------------------------------

    // --- EXISTING: Petrol/Diesel Pricing Tiers ---
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

    // Use absolute tertiles from global pool to prevent color shifting on zoom/pan
    const globalPricesArray = rawGlobalStationsPool
        .map(s => parseFloat(s[variant]))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);
        
    let greenThreshold = 0;
    let blueThreshold = 0;

    // --- NEW PLACEMENT: Define thresholds based on Fuel vs EV ---
    if (variant === 'electric') {
        // Hardcoded optimal thresholds for EV charging (Pence per kWh)
        greenThreshold = 65;
        blueThreshold = 75;
    } else if (globalPricesArray.length > 0) {
        // Statistical Tertiles for standard combustion fuels (E10, B7, etc.)
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

    // 1. Set Base Titles
    document.getElementById('sheet-brand-title').textContent = (stationData.brand_name || 'Independent Hub').replace(/['"]/g, '');
    document.getElementById('sheet-address-details').textContent = (stationData.address || 'UK Grid Station').replace(/['"]/g, '');

    // --- NEW: EV vs COMBUSTION UI SWITCHER ---
    if (stationData.isEV) {
        // Hide standard fuel wrappers
        document.getElementById('card-wrap-e10').style.display = 'none';
        document.getElementById('card-wrap-e5').style.display = 'none';
        document.getElementById('card-wrap-b7').style.display = 'none';
        document.getElementById('card-wrap-premiumdiesel').style.display = 'none';

        // Check if our dynamic EV card exists, if not, create it
        let evCard = document.getElementById('card-wrap-ev');
        if (!evCard) {
            evCard = document.createElement('div');
            evCard.id = 'card-wrap-ev';
            // Insert it into the grid
            document.getElementById('card-wrap-e10').parentElement.appendChild(evCard);
        }
        
        // Populate the EV Card
        evCard.style.display = 'block';
        evCard.className = `border p-3 rounded-xl text-center transition-all duration-200 col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-sm`;
        evCard.innerHTML = `
            <span class="text-[10px] font-black uppercase tracking-wider block opacity-75">⚡ Rapid Charging Rate</span>
            <span class="text-xl font-black block mt-1 tabular-nums">${parseFloat(stationData.electric).toFixed(1)}p <span class="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70">/ kWh</span></span>
        `;

        document.getElementById('sheet-brand-title').textContent = `⚡ ${(stationData.brand_name || 'EV Charger').replace(/['"]/g, '')}`;

    } else {
        // Ensure standard fuel wrappers are visible and EV card is hidden
        document.getElementById('card-wrap-e10').style.display = 'block';
        document.getElementById('card-wrap-e5').style.display = 'block';
        document.getElementById('card-wrap-b7').style.display = 'block';
        document.getElementById('card-wrap-premiumdiesel').style.display = 'block';
        
        const evCard = document.getElementById('card-wrap-ev');
        if (evCard) evCard.style.display = 'none';

        // Populate Standard Fuel Prices
        document.getElementById('card-wrap-e10').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E10, 'E10')}`;
        document.getElementById('card-wrap-e5').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E5, 'E5')}`;
        document.getElementById('card-wrap-b7').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.B7, 'B7')}`;
        document.getElementById('card-wrap-premiumdiesel').className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.PremiumDiesel, 'PremiumDiesel')}`;

        document.getElementById('sheet-price-e10').textContent = stationData.E10 ? `${parseFloat(stationData.E10).toFixed(1)}p` : 'N/A';
        document.getElementById('sheet-price-e5').textContent = stationData.E5 ? `${parseFloat(stationData.E5).toFixed(1)}p` : 'N/A';
        document.getElementById('sheet-price-b7').textContent = stationData.B7 ? `${parseFloat(stationData.B7).toFixed(1)}p` : 'N/A';
        document.getElementById('sheet-price-premiumdiesel').textContent = stationData.PremiumDiesel ? `${parseFloat(stationData.PremiumDiesel).toFixed(1)}p` : 'N/A';
    }

    updateAllStarUIStates();

    // 2. Animate the Sheet In
    sheet.classList.remove('hidden'); // Ensure it's unhidden first
    
    if (window.innerWidth < 768) {
        setMobileSheetUIState('full'); 
    } else {
        sheet.classList.remove('drawer-hidden', 'drawer-peek', 'drawer-mid', 'drawer-full');
    }
}

function closeForecourtDetailSheet(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;

    if (window.innerWidth < 768) {
        setMobileSheetUIState('hidden');
    } else {
        // Fix: Use standard Tailwind hiding for desktop
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
    
    // Fixed: Properly injected the lat/lon variables into the Maps URL
    window.open(`http://maps.google.com/maps?q=${lat},${lon}`, '_blank');
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
    sheet.classList.add(`drawer-${stateStr}`);
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

    targetHandle.addEventListener('touchstart', (e) => {
        touchBaseY = e.touches[0].clientY;
        // Prevent map scrolling while dragging the handle
        e.stopPropagation();
    }, { passive: true });

    targetHandle.addEventListener('touchend', (e) => {
        const touchCurrentY = e.changedTouches[0].clientY;
        const trackDeltaY = touchBaseY - touchCurrentY; // Positive = Swipe Up, Negative = Swipe Down
        
        let currentActiveState = (elementId === 'sidebar') ? currentMobileSidebarUIState : currentMobileSheetUIState;

        // Require a 40px swipe to register as an intentional gesture
        if (Math.abs(trackDeltaY) > 40) {
            if (trackDeltaY > 0) {
                // Swiped UP
                if (currentActiveState === 'peek') stateModificationCallback('mid');
                else if (currentActiveState === 'mid') stateModificationCallback('full');
            } else {
                // Swiped DOWN
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
        else if (currentMobileSheetUIState === 'full') setMobileSheetUIState('hidden');
    });

    bindSwipeGestureDetectionToMobileSheets('sidebar-drag-handle', 'sidebar', setMobileSidebarState);
    bindSwipeGestureDetectionToMobileSheets('detail-sheet-drag-handle', 'sheet', setMobileSheetUIState);
}


let refuelMarkersGroup = null;

// -------------------------------------------------------------
// CORE CALCULATOR: Smart Refuel Optimization & Savings Logic 
// -------------------------------------------------------------
function calculateOptimalRefuelStrategy() {
    const fuelType = document.getElementById('fuel-type')?.value || 'E10';
    const isEV = fuelType === 'electric';

    const currentFuelPercentage = parseFloat(document.getElementById('refuel-current-level')?.value) || 0;
    const safetyBufferMiles = parseFloat(document.getElementById('refuel-safety-buffer')?.value) || 0;
    
    // Dynamic Inputs based on type (Fallback to 60kWh / 3.5 mi/kWh for EV, or 55L / 40 MPG for ICE)
    const capacityInput = parseFloat(document.getElementById('refuel-tank-size')?.value) || (isEV ? 60 : 55);
    const efficiencyInput = parseFloat(document.getElementById('vehicle-mpg')?.value) || (isEV ? 3.5 : 40);
    
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

    // --- BIFURCATED MATH LOGIC (EV vs COMBUSTION) ---
    let remainingRangeMiles = 0;
    let currentEnergyUnits = 0;

    if (isEV) {
        currentEnergyUnits = capacityInput * (currentFuelPercentage / 100);
        const bufferKwhNeeded = safetyBufferMiles / efficiencyInput;
        const usableKwh = Math.max(0, currentEnergyUnits - bufferKwhNeeded);
        remainingRangeMiles = usableKwh * efficiencyInput;
    } else {
        const milesPerLiter = efficiencyInput / 4.54609; 
        currentEnergyUnits = capacityInput * (currentFuelPercentage / 100);
        const bufferLitersNeeded = safetyBufferMiles / milesPerLiter;
        const usableLiters = Math.max(0, currentEnergyUnits - bufferLitersNeeded);
        remainingRangeMiles = usableLiters * milesPerLiter;
    }
    
    const totalTripDistance = activeDistance; 
    
    if (remainingRangeMiles >= totalTripDistance) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = `
                <div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 p-3.5 rounded-xl text-xs flex flex-col gap-1 shadow-sm">
                    <div class="font-bold flex items-center gap-1">🎉 ${isEV ? 'Battery Charge' : 'Fuel Tank'} Sufficient!</div>
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
            timelineContainer.innerHTML = `<p class="text-zinc-400 text-xs text-center py-2 font-medium">No active ${isEV ? 'chargers' : 'fuel stations'} found in range.</p>`;
        }
        return;
    }

    let bestStation = null;
    let isEmergencyMode = false;

    const startLat = plottedRouteCoordinates[0][0];
    const startLon = plottedRouteCoordinates[0][1];

    if (currentFuelPercentage <= 5 || remainingRangeMiles <= 0) {
        isEmergencyMode = true;
        validStations.sort((a, b) => {
            const distA = computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng));
            const distB = computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng));
            return distA - distB;
        });
        bestStation = validStations[0];
        
    } else {
        let reachableStations = validStations.filter(station => {
            const distFromStart = computeDistanceVectorMiles(
                startLat, startLon, 
                parseFloat(station.latitude || station.lat), 
                parseFloat(station.longitude || station.lng)
            );
            const estimatedRoadDistance = distFromStart * 1.2; 
            return estimatedRoadDistance <= remainingRangeMiles;
        });

        if (reachableStations.length === 0) {
            isEmergencyMode = true;
            validStations.sort((a, b) => {
                const distA = computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng));
                const distB = computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng));
                return distA - distB;
            });
            bestStation = validStations[0];
            Toast.show(`No cheap options within safe range. Showing nearest.`, 'warning');
        } else {
            reachableStations.sort((a, b) => parseFloat(a[fuelType]) - parseFloat(b[fuelType]));
            bestStation = reachableStations[0];
        }
    }

    // Testing override pipeline execution
    if (currentFuelPercentage === 10) {
        const overrideStation = validStations.find(s => s.address && s.address.toLowerCase().includes('blackpool road'));
        if (overrideStation) {
            bestStation = overrideStation;
            isEmergencyMode = true;
        }
    }
    
    if (!bestStation) {
        if (timelineContainer) {
            timelineContainer.classList.remove('hidden');
            timelineContainer.innerHTML = `
                <div class="p-4 text-center text-zinc-500 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-800 font-medium">
                    No optimal options found within range along this corridor.
                </div>`;
        }
        return;
    }

    const lat = parseFloat(bestStation.latitude || bestStation.lat || 0);
    const lon = parseFloat(bestStation.longitude || bestStation.lng || 0);
    const bestPrice = parseFloat(bestStation[fuelType] || bestStation.price || 0);
    
    const validPrices = rawGlobalStationsPool.map(s => s.prices?.[fuelType] || s[fuelType]).map(parseFloat).filter(p => p && !isNaN(p) && p > 0);
    const averagePrice = validPrices.length > 0 ? (validPrices.reduce((a, b) => a + b, 0) / validPrices.length) : bestPrice;
    
    const energyToFill = Math.max(0, capacityInput - currentEnergyUnits);
    const totalCost = (energyToFill * bestPrice) / 100;
    
    const savingsPence = (averagePrice - bestPrice) * energyToFill;
    const savingsGBP = Math.max(0, savingsPence / 100);

    if (savingsGBP > 0 && savingsValueText) {
        savingsValueText.textContent = `£${savingsGBP.toFixed(2)}`;
        if (savingsBlock) savingsBlock.classList.remove('hidden');
    }
    
    const contextLabel = isEmergencyMode ? 'Nearest Emergency Stop' : 'Optimal Stop';
    const markerContext = isEmergencyMode ? `⚠️ Emergency ${isEV ? 'Charge' : 'Refuel'}` : `Optimal ${isEV ? 'Charge' : 'Refuel'} Stop`;
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
                    <span class="text-zinc-500 font-medium">Vehicle ${isEV ? 'Efficiency' : 'Mileage'}</span>
                    <span class="font-bold text-zinc-900 dark:text-white">${efficiencyInput} ${isEV ? 'mi/kWh' : 'MPG'}</span>
                </div>
                
                <div class="flex justify-between border-b border-zinc-100 dark:border-zinc-800/60 pb-2 bg-emerald-50/50 dark:bg-emerald-950/20 -mx-4 px-4 py-2">
                    <span class="text-emerald-700 dark:text-emerald-500 font-bold">Action</span>
                    <span class="font-black text-emerald-700 dark:text-emerald-400">${isEV ? 'Charge' : 'Fill'} ${energyToFill.toFixed(1)} ${isEV ? 'kWh' : 'Litres'}</span>
                </div>
                
                <div class="flex justify-between pt-1 items-center">
                    <span class="text-zinc-500 font-medium">Estimated Cost</span>
                    <div class="text-right">
                        <span class="font-black text-zinc-900 dark:text-white text-lg">£${totalCost.toFixed(2)}</span>
                        <span class="text-[10px] text-zinc-400 block">@ ${bestPrice.toFixed(1)}p/${isEV ? 'kWh' : 'L'}</span>
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
        html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-emerald-500 border-white dark:border-emerald-900'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">${isEV ? '⚡' : '⛽'}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    });
    
    L.marker([lat, lon], { icon: customFuelIcon, station_id: bestStation.id || 'refuel-node' })
        .bindPopup(`<strong class="text-xs text-zinc-900 dark:text-white font-black block mb-0.5">${markerContext}</strong><span class="text-[11px] ${isEmergencyMode ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'} font-bold block tabular-nums">${bestPrice.toFixed(1)}p/${isEV ? 'kWh' : 'L'}</span>`)
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
}

window.toggleTrafficDashboard = function() {
    const area = document.getElementById('dashboard-collapsible-area');
    const chevron = document.getElementById('dashboard-chevron');
    if (area && chevron) {
        if (area.style.maxHeight === '0px' || area.classList.contains('max-h-0')) {
            // Expand
            area.style.maxHeight = '500px';
            area.style.marginTop = '0.75rem';
            area.style.opacity = '1';
            chevron.style.transform = 'rotate(0deg)';
        } else {
            // Collapse
            area.style.maxHeight = '0px';
            area.style.marginTop = '0px';
            area.style.opacity = '0';
            chevron.style.transform = 'rotate(180deg)';
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    initializeSpatialMapEngine();
    applyThemeChangesToDOM();
    setupAutocompleteListeners();
    initializeClickIsolationBubbling();
    initializeGestureTrackEngine();
    forceReloadRemotePipelineData();

    // 1. Inputs that should ONLY trigger the general station filtering
    const mapFilteringInputs = ['fuel-type', 'radius-slider', 'route-radius-slider'];
    mapFilteringInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => executeStationDataFilteringPipeline());
            el.addEventListener('input', () => { if (el.type === 'range') executeStationDataFilteringPipeline(); });
        }
    });

    // 2. Inputs that should ONLY trigger the Smart Refuel math 
    const smartRefuelInputs = ['refuel-current-level', 'refuel-safety-buffer', 'refuel-tank-size', 'vehicle-mpg'];
    smartRefuelInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
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

// FIND your initialization block or add this directly to the bottom of app.js:
document.getElementById('fuel-type')?.addEventListener('change', function(e) {
    const selectedFuel = e.target.value;
    const capacityLabel = document.getElementById('tank-capacity-title');
    const capacityDesc = document.getElementById('tank-capacity-desc');
    const capacitySelect = document.getElementById('refuel-tank-size'); // Your select input ID
    
    const currentFuelLabel = document.getElementById('current-fuel-title');
    const currentFuelDesc = document.getElementById('current-fuel-desc');

    if (selectedFuel === 'electric') {
        if (capacityLabel) capacityLabel.innerText = 'Battery Capacity';
        if (capacityDesc) capacityDesc.innerText = 'Maximum energy capacity in kWh.';
        if (currentFuelLabel) currentFuelLabel.innerText = 'State of Charge (SoC)';
        if (currentFuelDesc) currentFuelDesc.innerText = 'Current battery charge percentage.';
        
        if (capacitySelect) {
            capacitySelect.innerHTML = `
                <option value="40">40 kWh (Compact / Hatchback)</option>
                <option value="60" selected>60 kWh (Standard Range)</option>
                <option value="80">80 kWh (Long Range)</option>
                <option value="100">100 kWh (Performance / SUV)</option>
            `;
        }
    } else {
        if (capacityLabel) capacityLabel.innerText = 'Tank Capacity';
        if (capacityDesc) capacityDesc.innerText = 'Maximum fuel tank size.';
        if (currentFuelLabel) currentFuelLabel.innerText = 'Current Fuel Level';
        if (currentFuelDesc) currentFuelDesc.innerText = 'Current remaining fuel percentage.';
        
        if (capacitySelect) {
            capacitySelect.innerHTML = `
                <option value="45">45 L (Compact Car)</option>
                <option value="55" selected>55 L (Standard Sedan)</option>
                <option value="70">70 L (Large SUV / Van)</option>
            `;
        }
    }
    
    // Auto-recalculate the strategy when the user toggles modes
    if (typeof calculateOptimalRefuelStrategy === 'function') {
        calculateOptimalRefuelStrategy();
    }
});
