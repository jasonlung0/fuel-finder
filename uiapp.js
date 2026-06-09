// --- GLOBAL CONFIGURATION CREDENTIALS ---
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6';
const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e';

// Tailwind Design Tokens & Safelist Configuration Layer
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class',
        theme: { extend: { colors: { zinc: { 950: '#040405', 1000: '#000000' }, fuel: { green: '#10b981', blue: '#3b82f6', red: '#ef4444' } } } },
        safelist: ['bg-fuel-green', 'bg-fuel-blue', 'bg-fuel-red']
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
}

let activeTabContext = 'local'; 
let activeDirectoryTab = 'stations'; 
let activeSheetStation = null;
let mapSearchAnchorCoordinates = [51.5074, -0.1278]; 

let plottedRouteCoordinates = [];
let autocompleteDebounceTimer = null;
let globalActiveRoute = null;
let globalRouteDistanceMiles = 0;

let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';
let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
let dynamicWaypointIncrementalIndex = 0;
let originalMapCenter = null;

// --- 3-STATE MOBILE SWIPE MECHANICS (Strict 40px Logic) ---
let currentMobileSidebarUIState = 'peek';
let currentMobileSheetUIState = 'hidden';

function bindSwipeGestureDetectionToMobileSheets(handleId, elementId, stateModificationCallback) {
    const targetHandle = document.getElementById(handleId);
    const drawer = document.getElementById(elementId);
    if (!targetHandle || !drawer) return;

    let touchBaseY = 0;

    targetHandle.addEventListener('touchstart', (e) => {
        touchBaseY = e.touches[0].clientY;
        e.stopPropagation();
    }, { passive: true });

    targetHandle.addEventListener('touchend', (e) => {
        const touchCurrentY = e.changedTouches[0].clientY;
        const trackDeltaY = touchBaseY - touchCurrentY; 
        
        let currentActiveState = (elementId === 'desktop-sidebar' || elementId === 'sidebar') ? currentMobileSidebarUIState : currentMobileSheetUIState;

        if (Math.abs(trackDeltaY) > 40) {
            if (trackDeltaY > 0) {
                // Swiped UP
                if (currentActiveState === 'peek' || currentActiveState === 'hidden') stateModificationCallback('mid');
                else if (currentActiveState === 'mid') stateModificationCallback('full');
            } else {
                // Swiped DOWN
                if (currentActiveState === 'full') stateModificationCallback('mid');
                else if (currentActiveState === 'mid') {
                    if (elementId === 'desktop-sidebar' || elementId === 'sidebar') stateModificationCallback('peek');
                    else stateModificationCallback('hidden');
                }
            }
        }
    });
}

function setMobileSidebarState(stateStr) {
    currentMobileSidebarUIState = stateStr;
    const drawer = document.getElementById('desktop-sidebar');
    if (drawer) {
        drawer.className = drawer.className.replace(/\bdrawer-(hidden|peek|mid|full)\b/g, '').trim();
        drawer.classList.add(`drawer-${stateStr}`);
    }
}

function setMobileSheetUIState(stateStr) {
    currentMobileSheetUIState = stateStr;
    const drawer = document.getElementById('global-detail-sheet');
    if (drawer) {
        drawer.className = drawer.className.replace(/\bsheet-(hidden|peek|mid|full)\b/g, '').trim();
        drawer.classList.add(`sheet-${stateStr}`);
    }
}

const INACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c.151-.326.621-.326.772 0l2.035 4.392 4.752.693c.353.051.495.492.239.743l-3.438 3.35 1.022 4.718c.076.351-.29.616-.598.442L12 15.617l-4.283 2.272c-.308.174-.674-.09-.598-.442l1.022-4.718-3.438-3.35c-.256-.251-.114-.692.239-.743l4.752-.693 2.035-4.393Z" /></svg>`;
const ACTIVE_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5 text-amber-500"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>`;

window.updateUIForMode = function(isEV) {
    const capacityLabel = document.getElementById('label-capacity');
    const capacityDesc = document.getElementById('desc-capacity');
    const currentFuelLabel = document.getElementById('label-current-fuel');
    const currentFuelDesc = document.getElementById('desc-current-fuel');
    const capacitySelect = document.getElementById('refuel-tank-size');
    const mpgLabel = document.getElementById('mpg-label');
    const bufferLabel = document.getElementById('label-safety-buffer');
    const bufferDesc = document.getElementById('desc-safety-buffer');
    const bufferUnitLabels = document.querySelectorAll('.buffer-unit-label');

    if (isEV) {
        if (capacityLabel) capacityLabel.innerText = 'Battery Capacity';
        if (capacityDesc) capacityDesc.innerText = 'Max energy capacity in kWh.';
        if (currentFuelLabel) currentFuelLabel.innerText = 'State of Charge (SoC)';
        if (currentFuelDesc) currentFuelDesc.innerText = 'Current battery charge %.';
        if (mpgLabel) mpgLabel.innerText = 'Vehicle Efficiency (mi/kWh)';
        if (bufferLabel) bufferLabel.innerText = 'Safety Buffer Target';
        if (bufferDesc) bufferDesc.innerText = 'Minimum safe threshold margin.';
        bufferUnitLabels.forEach(el => el.innerText = 'miles'); 
        
        if (capacitySelect) {
            capacitySelect.innerHTML = `<option value="40">40 kWh (Compact)</option><option value="60" selected>60 kWh (Standard Range)</option><option value="80">80 kWh (Long Range)</option><option value="100">100+ kWh (Performance)</option>`;
        }
    } else {
        if (capacityLabel) capacityLabel.innerText = 'Tank Capacity';
        if (capacityDesc) capacityDesc.innerText = 'Maximum fuel tank size.';
        if (currentFuelLabel) currentFuelLabel.innerText = 'Current Fuel Level';
        if (currentFuelDesc) currentFuelDesc.innerText = 'Current remaining fuel %.';
        if (mpgLabel) mpgLabel.innerText = 'Vehicle Efficiency (MPG)';
        if (bufferLabel) bufferLabel.innerText = 'Safety Buffer Target';
        if (bufferDesc) bufferDesc.innerText = 'Minimum safe threshold margin.';
        bufferUnitLabels.forEach(el => el.innerText = 'miles'); 
        
        if (capacitySelect) {
            capacitySelect.innerHTML = `<option value="45">45 L (Compact Car)</option><option value="55" selected>55 L (Standard Sedan)</option><option value="70">70 L (Large SUV / Van)</option>`;
        }
    }
    
    if (typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy();
};

window.focusIncidentMapView = function(lat, lng) {
    if (!map) return;
    let targetedLat = parseFloat(lat);
    let targetedLng = parseFloat(lng);
    
    if (Math.abs(targetedLat) < Math.abs(targetedLng) && targetedLng > 49 && targetedLng < 61) {
        const temp = targetedLat; targetedLat = targetedLng; targetedLng = temp;
    }

    if (isNaN(targetedLat) || isNaN(targetedLng)) return;
    map.flyTo([targetedLat, targetedLng], 16, { animate: true, duration: 1.5, easeLinearity: 0.25 });
};

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
        toast.innerHTML = `<div class="relative z-10 flex items-center justify-center">${icons[type]}</div><p class="relative z-10 m-0 leading-tight tracking-tight">${message}</p>`;

        this.container.appendChild(toast);
        requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('show'); }); });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

window.toggleSystemColorModeTheme = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    isDarkMode = !isDarkMode;
    localStorage.setItem('theme-dark-setting-mode', isDarkMode);
    applyThemeChangesToDOM();
};

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
    if (typeof executeStationDataFilteringPipeline === 'function') executeStationDataFilteringPipeline();
    updateDirectoryTotalBadge();
    const dropdownPanel = document.getElementById('starred-dropdown-panel');
    if (dropdownPanel && !dropdownPanel.classList.contains('hidden')) renderDirectoryDropdown();
    updateAllStarUIStates();
}

function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(mapSearchAnchorCoordinates, 11);
    
    const targetedTilesetURI = isDarkMode 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        
    tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    
    initializeClusterLayerPipeline();
    
    map.on('click', function(e) {
        map.closePopup(); 
        if (typeof closeForecourtDetailSheet === 'function') closeForecourtDetailSheet(); 
        activeSheetStation = null; 
    });
    
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
    forceReloadRemotePipelineData();
}

window.executeContextualAreaScanPipeline = function(event) {
    if (event) event.stopPropagation();
    const btn = document.getElementById('scan-area-btn');
    const container = document.getElementById('scan-area-container');
    const iconSearch = document.getElementById('scan-icon-search');
    const iconSpinner = document.getElementById('scan-icon-spinner');
    const btnText = document.getElementById('scan-btn-string');

    if (btn) btn.disabled = true;
    if (iconSearch) iconSearch.classList.add('hidden');
    if (iconSpinner) iconSpinner.classList.remove('hidden');
    if (btnText) btnText.textContent = "Updating viewport matrix...";

    const newCenter = map.getCenter();
    mapSearchAnchorCoordinates = [newCenter.lat, newCenter.lng];
    originalMapCenter = newCenter;

    if (typeof forceReloadRemotePipelineData === 'function') forceReloadRemotePipelineData();

    setTimeout(() => {
        if (container) {
            container.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
            container.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
        }
        setTimeout(() => {
            if (btn) btn.disabled = false;
            if (iconSearch) iconSearch.classList.remove('hidden');
            if (iconSpinner) iconSpinner.classList.add('hidden');
            if (btnText) btnText.textContent = "Search this map area";
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
                executeStationDataFilteringPipeline();
            },
            (error) => { executeStationDataFilteringPipeline(); },
            { enableHighAccuracy: true, timeout: 6000 }
        );
    } else {
        executeStationDataFilteringPipeline();
    }
}

window.triggerManualDeviceLocationSearch = async function(event) {
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
};

function initializeClusterLayerPipeline() {
    if(markerClusterGroupInstance && map) { map.removeLayer(markerClusterGroupInstance); }
    
    markerClusterGroupInstance = L.markerClusterGroup({
        maxClusterRadius: 40,
        iconCreateFunction: function(cluster) {
            const children = cluster.getAllChildMarkers();
            let minPrice = Infinity;
            let maxPrice = -Infinity;
            const currentFuelType = document.getElementById('fuel-type')?.value || 'E10';
            const isEV = currentFuelType === 'electric';

            children.forEach(marker => {
                let priceToCheck = null;
                if (marker.options && marker.options.stationRawData) {
                    const st = marker.options.stationRawData;
                    if (isEV) {
                         priceToCheck = parseFloat(st.electric_price || st.charge_rate || st.electric);
                    } else {
                         priceToCheck = parseFloat(st[currentFuelType]);
                    }
                }

                if (priceToCheck && !isNaN(priceToCheck)) {
                    minPrice = Math.min(minPrice, priceToCheck);
                    maxPrice = Math.max(maxPrice, priceToCheck);
                }
            });

            let displayLabel = children.length; 
            if (minPrice !== Infinity && maxPrice !== -Infinity) {
                displayLabel = minPrice === maxPrice 
                    ? `${isEV ? '⚡' : ''}${minPrice.toFixed(1)}${isEV ? 'p' : 'p'}` 
                    : `${minPrice.toFixed(1)}-${maxPrice.toFixed(1)}p`;
            }

            return L.divIcon({
                html: `<div class="bg-zinc-900 text-white font-bold rounded-full border-2 border-white shadow-md flex items-center justify-center text-[10px] px-2 py-1">${displayLabel}</div>`,
                className: 'leaflet-div-icon-reset',
                iconSize: [null, null]
            });
        }
    });
    map.addLayer(markerClusterGroupInstance);
}

window.switchWorkflowTabContext = function(contextType) {
    activeTabContext = contextType;
    const btnLocal = document.getElementById('tab-btn-nearby');
    const btnRoute = document.getElementById('tab-btn-route');
    const panelLocal = document.getElementById('panel-tab-local');
    const panelRoute = document.getElementById('panel-tab-route');

    if (contextType === 'local') {
        if(btnLocal) btnLocal.className = "flex-1 py-2 rounded-lg text-[11px] font-black bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm transition";
        if(btnRoute) btnRoute.className = "flex-1 py-2 rounded-lg text-[11px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition";
        if(panelLocal) panelLocal.classList.remove('hidden');
        if(panelRoute) panelRoute.classList.add('hidden');
        clearRoute();
    } else {
        if(btnRoute) btnRoute.className = "flex-1 py-2 rounded-lg text-[11px] font-black bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm transition";
        if(btnLocal) btnLocal.className = "flex-1 py-2 rounded-lg text-[11px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition";
        if(panelRoute) panelRoute.classList.remove('hidden');
        if(panelLocal) panelLocal.classList.add('hidden');
        
        const scanContainer = document.getElementById('scan-area-container');
        if (scanContainer) {
            scanContainer.classList.remove('scale-100', 'translate-y-0', 'opacity-100', 'pointer-events-auto');
            scanContainer.classList.add('scale-90', 'translate-y-2', 'opacity-0', 'pointer-events-none');
        }
    }
    executeStationDataFilteringPipeline();
};

window.switchDirectoryTabContext = function(dirType) {
    activeDirectoryTab = dirType;
    const tabStations = document.getElementById('dir-tab-stations');
    const tabRoutes = document.getElementById('dir-tab-routes');
    
    if (dirType === 'stations') {
        if(tabStations) tabStations.className = "flex-1 py-1.5 rounded-lg text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs focus:outline-none";
        if(tabRoutes) tabRoutes.className = "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none";
    } else {
        if(tabRoutes) tabRoutes.className = "flex-1 py-1.5 rounded-lg text-[10px] font-black transition cursor-pointer bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs focus:outline-none";
        if(tabStations) tabStations.className = "flex-1 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none";
    }
    renderDirectoryDropdown();
};

function updateDirectoryTotalBadge() {
    const badge = document.getElementById('directory-total-badge');
    if (badge) {
        badge.textContent = starredStations.length + savedRoutes.length;
    }
}

window.swapRouteEndpoints = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const startInput = document.getElementById('route-start');
    const endInput = document.getElementById('route-end');
    if(!startInput || !endInput) return;

    const intermediateBuffer = startInput.value;
    startInput.value = endInput.value;
    endInput.value = intermediateBuffer;
};

window.addWaypointFieldInputRow = function(initialValue = '') {
    dynamicWaypointIncrementalIndex++;
    const currentUid = dynamicWaypointIncrementalIndex;
    const container = document.getElementById('dynamic-waypoints-container');
    if (!container) return;

    const rowNode = document.createElement('div');
    rowNode.id = `waypoint-row-context-${currentUid}`;
    rowNode.className = "relative w-full flex items-center gap-2 mt-1 animate-fadeIn";

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
};

window.removeWaypointFieldInputRow = function(uid, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const rowTarget = document.getElementById(`waypoint-row-context-${uid}`);
    if (rowTarget) {
        rowTarget.remove();
    }
};

window.clearSingleWaypointRowInputValue = function(uid, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const inputField = document.getElementById(`route-via-${uid}`);
    if (inputField) {
        inputField.value = '';
    }
};

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
}

window.executeAddressGeocodeLookup = async function() {
    const inputEl = document.getElementById('location-input');
    const searchString = inputEl?.value.trim();
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
};

// -------------------------------------------------------------
// Live Traffic Incident Polling & Stacking Pipeline
// -------------------------------------------------------------
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

    if (area <= maxArea) return [[minLon, minLat, maxLon, maxLat]];

    const mid = Math.floor(coords.length / 2);
    const firstHalf = coords.slice(0, mid + 1);
    const secondHalf = coords.slice(mid);
    return [...generateTrafficBoundingBoxes(firstHalf, maxArea), ...generateTrafficBoundingBoxes(secondHalf, maxArea)];
}

async function fetchTrafficChunk(bbox) {
    try {
        const formattedMinLon = Number(bbox[0]).toFixed(6);
        const formattedMinLat = Number(bbox[1]).toFixed(6);
        const formattedMaxLon = Number(bbox[2]).toFixed(6);
        const formattedMaxLat = Number(bbox[3]).toFixed(6);
        const bboxString = `${formattedMinLon},${formattedMinLat},${formattedMaxLon},${formattedMaxLat}`;
        const fieldsTemplate = encodeURIComponent("{incidents{geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,delay,from,to,events{description}}}}");
        const targetApiEndpoint = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}&bbox=${bboxString}&fields=${fieldsTemplate}&language=en-GB&t=-1`;

        const networkResponse = await fetch(targetApiEndpoint);
        if (!networkResponse.ok) return [];
        const payload = await networkResponse.json();
        return (payload && payload.incidents) ? payload.incidents : [];
    } catch (apiError) { return []; }
}

async function fetchAllRouteTraffic(routeCoords) {
    if (!routeCoords || routeCoords.length === 0) return null;
    const bboxes = generateTrafficBoundingBoxes(routeCoords, 8500);
    if (bboxes.length > 20) bboxes.length = 20; 

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
        return null;
    }
}

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
    if (category === 1 || category === 8 || delay > 1200) return { label: 'CRITICAL', styles: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30' };
    if (delay > 600) return { label: 'MAJOR', styles: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30' };
    if (delay > 180) return { label: 'MODERATE', styles: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' };
    return { label: 'MINOR', styles: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' };
}

window.renderLiveTrafficDashboard = function(incidents) {
    const alertsViewport = document.getElementById('traffic-alerts-viewport');
    const loadingPill = document.getElementById('traffic-loading-pill');
    
    if (loadingPill) loadingPill.style.display = 'none';

    const fuelType = document.getElementById('fuel-type')?.value || 'E10';
    const isEV = fuelType === 'electric';
    const fuelNoun = isEV ? 'kWh' : 'Liters';

    if (!incidents || incidents.length === 0) {
        if (alertsViewport) alertsViewport.innerHTML = `<div class="w-full p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl flex items-center gap-2"><span class="text-xs text-emerald-600">✅</span><span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Clear roads ahead! No delays reported.</span></div>`;
        const badge = document.getElementById('traffic-status-badge');
        if (badge) { badge.textContent = "CLEAR"; badge.className = "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 border-emerald-500/20"; }
        return;
    }

    let processed = incidents.filter(i => {
        const magnitude = i.properties?.magnitudeOfDelay || 0;
        const delayInSeconds = i.properties?.delay || 0;
        
        // High priority filter: Only keep Major (3), Overwhelming (4), or delay >= 5 mins (300s)
        if (magnitude < 3 && delayInSeconds < 300) return false;

        if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) return true;
        let coords = i.geometry?.coordinates;
        if (!coords) return false;
        let checkPoint = i.geometry.type === 'Point' ? coords : coords[0];
        return computeMinimumDistanceToRouteCorridor(checkPoint[1], checkPoint[0]) <= 1.5;
    });

    if (processed.length === 0) {
        if (alertsViewport) alertsViewport.innerHTML = `<div class="w-full p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl flex items-center gap-2"><span class="text-xs text-emerald-600">✅</span><span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Route corridor is free-flowing. No major incidents.</span></div>`;
        const badge = document.getElementById('traffic-status-badge');
        if (badge) { badge.textContent = "CLEAR"; badge.className = "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 border-emerald-500/20"; }
        return;
    }

    if (plottedRouteCoordinates && plottedRouteCoordinates.length > 0) {
        const sLat = plottedRouteCoordinates[0][0];
        const sLng = plottedRouteCoordinates[0][1];
        processed.sort((a, b) => {
            let ca = a.geometry.type === 'Point' ? a.geometry.coordinates : a.geometry.coordinates[0];
            let cb = b.geometry.type === 'Point' ? b.geometry.coordinates : b.geometry.coordinates[0];
            return computeDistanceVectorMiles(sLat, sLng, ca[1], ca[0]) - computeDistanceVectorMiles(sLat, sLng, cb[1], cb[0]);
        });
    }

    const tDelay = processed.reduce((s, i) => s + (i.properties.delay || 0), 0);
    const delayMins = Math.round(tDelay/60);
    
    let wasteStr = "";
    if (isEV) {
        const kwhWasted = (tDelay / 3600) * 2.1;
        wasteStr = `${kwhWasted.toFixed(2)} kWh energy wasted`;
    } else {
        const litersWasted = (tDelay / 3600) * 1.4;
        wasteStr = `${litersWasted.toFixed(1)}L fuel burned`;
    }

    const badge = document.getElementById('traffic-status-badge');
    if (badge) {
        badge.textContent = processed.length >= 3 ? "CONGESTED" : "ALERTS";
        badge.className = processed.length >= 3 
            ? "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-rose-500/10 text-rose-600 border-rose-500/20"
            : "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-amber-500/10 text-amber-700 border-amber-500/20";
    }

    const topIncidents = processed.slice(0, 10);

    if (alertsViewport) {
        alertsViewport.innerHTML = `<div class="mb-2 text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center justify-between px-1"><span>⚠️ +${delayMins}m total delay</span><span>${wasteStr}</span></div>` + 
        topIncidents.map(inc => {
            const p = inc.properties;
            const dm = Math.round((p.delay || 0) / 60);
            const sev = getIncidentSeverity(p.delay || 0, p.iconCategory);
            
            let geoCoords = inc.geometry.type === 'Point' ? inc.geometry.coordinates : inc.geometry.coordinates[0];
            let rawLng = geoCoords[0];
            let rawLat = geoCoords[1];

            return `
                <div onclick="focusIncidentMapView(${rawLat}, ${rawLng})" class="w-full p-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col gap-1 transition-all cursor-pointer hover:border-emerald-500 active:scale-[0.98]">
                    <div class="flex justify-between items-start gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <div class="px-1.5 py-0.5 rounded text-[8px] font-black border ${sev.styles}">${sev.label}</div>
                            <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">${humanizeTrafficDescription(p.events?.[0]?.description)}</h4>
                        </div>
                        ${dm > 0 ? `<span class="text-[10px] font-black text-rose-500 shrink-0">+${dm}m</span>` : ''}
                    </div>
                    <div class="flex items-start gap-1 mt-0.5">
                        <span class="text-[10px] mt-[1px]">📍</span>
                        <p class="text-[9px] font-medium text-zinc-500 truncate">${formatIncidentLocation(p.from, p.to)}</p>
                    </div>
                </div>
            `;
        }).join('');
    }
};

// -------------------------------------------------------------
// CORE ROUTING ENGINE & TomTom Fuel Consumption Integration
// -------------------------------------------------------------
window.executeRouteGenerationPipeline = async function(forcedStart, forcedEnd) {
    if (!map) return;
    try {
        const startElement = document.getElementById('route-start');
        const endElement = document.getElementById('route-end');
        const startInput = forcedStart || startElement?.value || "";
        const endInput = forcedEnd || endElement?.value || "";
        
        if (!startInput || !endInput) { Toast.show("Please enter both a start point and an end point.", "warning"); return; }
        
        const startRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startInput)}&countrycodes=gb&limit=1`);
        const startNodes = await startRes.json();
        if (!startNodes.length) { Toast.show("Could not find coordinates for the start point.", "error"); return; }
        
        const endRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endInput)}&countrycodes=gb&limit=1`);
        const endNodes = await endRes.json();
        if (!endNodes.length) { Toast.show("Could not find coordinates for the end point.", "error"); return; }
        
        let waypointInputs = document.querySelectorAll('.waypoint-dynamic-input-field');
        let waypointStrings = [];
        if (waypointInputs) waypointInputs.forEach(input => { if (input?.value && input.value.trim() !== "") waypointStrings.push(input.value.trim()); });
        
        if (typeof cachedGeocodedWaypoints === 'undefined') window.cachedGeocodedWaypoints = { start: {}, end: {}, vids: {} };
        cachedGeocodedWaypoints.start = { name: startInput, lat: parseFloat(startNodes[0].lat), lon: parseFloat(startNodes[0].lon) };
        cachedGeocodedWaypoints.end = { name: endInput, lat: parseFloat(endNodes[0].lat), lon: parseFloat(endNodes[0].lon) };
        
        let coordinatesPayloadString = `${startNodes[0].lat},${startNodes[0].lon}`;
        if (waypointStrings.length > 0) {
            const waypointPromises = waypointStrings.map(async (wpStr, wIndex) => {
                try {
                    const viaRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(wpStr)}&countrycodes=gb&limit=1`);
                    const viaNodes = await viaRes.json();
                    if (viaNodes.length) return { wIndex, name: wpStr, lat: viaNodes[0].lat, lon: viaNodes[0].lon };
                } catch (e) { console.error(`Failed to resolve midpoint sequence: ${wpStr}`, e); }
                return null;
            });
            const resolvedWaypoints = await Promise.all(waypointPromises);
            resolvedWaypoints.forEach(wp => {
                if (wp) {
                    coordinatesPayloadString += `:${wp.lat},${wp.lon}`;
                    cachedGeocodedWaypoints.vids[`wp_${wp.wIndex}`] = { name: wp.name, lat: parseFloat(wp.lat), lon: parseFloat(wp.lon) };
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
        currentActiveRoute.legs.forEach(leg => { leg.points.forEach(pt => { plottedRouteCoordinates.push([pt.latitude, pt.longitude]); }); });
        
        if (typeof routePolylineLayer !== 'undefined' && routePolylineLayer) map.removeLayer(routePolylineLayer);
        routePolylineLayer = L.featureGroup().addTo(map);
        
        L.polyline(plottedRouteCoordinates, { color: '#10b981', weight: 4.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routePolylineLayer);
        
        if (currentActiveRoute.sections && currentActiveRoute.sections.length > 0) {
            currentActiveRoute.sections.forEach(section => {
                if (section.sectionType === 'TRAFFIC' || section.simpleCategory === 'JAM' || section.simpleCategory === 'SLOWDOWN') {
                    const sliceCoords = plottedRouteCoordinates.slice(section.startPointIndex, section.endPointIndex + 1);
                    if (sliceCoords.length < 2) return;
                    const isJam = section.simpleCategory === 'JAM' || (section.magnitudeOfDelay && section.magnitudeOfDelay >= 3);
                    L.polyline(sliceCoords, { color: isJam ? '#ef4444' : '#f59e0b', weight: isJam ? 6.5 : 5.0, opacity: 1.0, lineCap: 'round', lineJoin: 'round' }).addTo(routePolylineLayer);
                }
            });
        }
        
        if (plottedRouteCoordinates.length > 0) {
            map.fitBounds(routePolylineLayer.getBounds(), { padding: [50, 50] });
            
            const loadingPill = document.getElementById('traffic-loading-pill');
            const alertsViewport = document.getElementById('traffic-alerts-viewport');
            if (loadingPill) loadingPill.style.display = 'flex';
            if (alertsViewport) alertsViewport.innerHTML = ''; 

            const stitchedIncidents = await fetchAllRouteTraffic(plottedRouteCoordinates);
            
            // Execute the pipeline to fetch the stations (This grabs OCM for EVs properly!)
            if (typeof executeStationDataFilteringPipeline === 'function') {
                await executeStationDataFilteringPipeline();
            }

            if (typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy();
            if (typeof renderLiveTrafficDashboard === 'function') renderLiveTrafficDashboard(stitchedIncidents);

            if (window.innerWidth >= 1024) toggleRightSidebar(true);
            if (window.innerWidth < 768) setMobileSidebarState('peek');
        }
        
    } catch (err) {
        console.error("Pipeline Engine Broken:", err);
        Toast.show(`Failed to trace route: ${err.message}`, "error");
    }
};

window.saveActiveRouteCorridor = function() {
    const startVal = document.getElementById('route-start')?.value.trim();
    const endVal = document.getElementById('route-end')?.value.trim();
    const currentMpg = document.getElementById('vehicle-mpg')?.value;
    const currentDev = document.getElementById('route-radius-slider')?.value;
    if (!startVal || !endVal) return;

    const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field')).map(input => input.value.trim()).filter(val => val.length > 0);
    const routePayload = { id: 'route_' + Date.now(), name: `${startVal.split(',')[0]} ➔ ${endVal.split(',')[0]}`, start: startVal, waypoints: waypointNodes, end: endVal, mpg: currentMpg, radius: currentDev };
    
    savedRoutes.push(routePayload);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    updateDirectoryTotalBadge();
    
    const dp = document.getElementById('starred-dropdown-panel');
    if (dp && !dp.classList.contains('hidden')) renderDirectoryDropdown();
    if (window.innerWidth < 768) setMobileSidebarState('peek');
    Toast.show("Corridor routing successfully saved.", "success");
};

window.deleteSavedRouteCorridor = function(routeId, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    savedRoutes = savedRoutes.filter(r => r.id !== routeId);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    updateDirectoryTotalBadge();
    renderDirectoryDropdown();
};

window.loadSavedRouteCorridorDataIntoWorkspace = function(routeId) {
    const matchedRoute = savedRoutes.find(r => r.id === routeId);
    if (!matchedRoute) return;
    switchWorkflowTabContext('route');
    
    const sr = document.getElementById('route-start'); if (sr) sr.value = matchedRoute.start;
    const er = document.getElementById('route-end'); if (er) er.value = matchedRoute.end;
    const mr = document.getElementById('vehicle-mpg'); if (mr) mr.value = matchedRoute.mpg;
    const rs = document.getElementById('route-radius-slider'); if (rs) rs.value = matchedRoute.radius;
    const rv = document.getElementById('route-radius-val'); if (rv) rv.textContent = `${matchedRoute.radius} Mi`;

    const container = document.getElementById('dynamic-waypoints-container');
    if (container) {
        container.innerHTML = '';
        if(matchedRoute.waypoints && matchedRoute.waypoints.length > 0) { matchedRoute.waypoints.forEach(wpStr => { addWaypointFieldInputRow(wpStr); }); } 
        else { addWaypointFieldInputRow(); }
    }
    executeRouteGenerationPipeline();
    const dp = document.getElementById('starred-dropdown-panel');
    if (dp) dp.classList.add('hidden');
};

window.clearRoute = function() {
    if (routePolylineLayer) { map.removeLayer(routePolylineLayer); routePolylineLayer = null; }
    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) { refuelMarkersGroup?.clearLayers(); }

    if (typeof map !== 'undefined' && map) {
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker) {
                const popup = layer.getPopup();
                const popupContent = popup ? popup.getContent() : '';
                if (layer.options.title === 'Start' || layer.options.title === 'End' || layer.options.icon?.options?.className === 'custom-refuel-marker-node' || layer.options.icon?.options?.className === 'custom-fuel-icon' || (typeof popupContent === 'string' && (popupContent.includes('Optimal') || popupContent.includes('Refuel')))) {
                    map.removeLayer(layer);
                }
            }
        });
    }

    plottedRouteCoordinates = [];
    cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
    window.globalCalculatedFuelLiters = null;
    
    const sr = document.getElementById('route-start'); if(sr) sr.value = '';
    const er = document.getElementById('route-end'); if(er) er.value = '';
    const li = document.getElementById('location-input'); if(li) li.value = '';

    const container = document.getElementById('dynamic-waypoints-container');
    if (container) { container.innerHTML = ''; addWaypointFieldInputRow(); }

    const dash = document.getElementById('bottom-traffic-dashboard');
    if (dash) dash.classList.add('hidden');

    const crb = document.getElementById('cheapest-ranking-block');
    if (crb) crb.classList.add('hidden');

    clearFuelOptimizationState();
    executeStationDataFilteringPipeline();
    
    if (window.innerWidth < 768 && typeof setMobileSidebarState === 'function') {
        setMobileSidebarState('mid');
    }
};

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
    suggestionBoxes.forEach(box => { if (!box.contains(e.target)) box.classList.add('hidden'); });
});

function initializeClickIsolationBubbling() {
    const structuralIDs = ['global-detail-sheet', 'starred-dropdown-panel', 'desktop-sidebar', 'right-telemetry-sidebar'];
    structuralIDs.forEach(id => {
        const node = document.getElementById(id);
        if (node) { node.addEventListener('click', (e) => { e.stopPropagation(); }); node.addEventListener('dblclick', (e) => { e.stopPropagation(); }); }
    });
}

async function forceReloadRemotePipelineData() {
    try {
        const response = await fetch('https://fuel-cron-scraper.jasonlung0.workers.dev/');
        const data = await response.json();
        rawGlobalStationsPool = data.map(s => {
            const baseDiesel = parseFloat(s.B7);
            return { ...s, PremiumDiesel: (baseDiesel && !isNaN(baseDiesel)) ? (baseDiesel + 14.2).toFixed(1) : null };
        });
        const liveClock = new Date();
        const lbl = document.getElementById('live-timestamp-label');
        if (lbl) lbl.innerHTML = `Prices Updated At ${liveClock.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        executeStationDataFilteringPipeline();
    } catch (error) {
        console.error(error);
        const lbl = document.getElementById('live-timestamp-label');
        if (lbl) lbl.textContent = "Offline Data Buffer Frame";
    }
}

window.focusAndHighlightMapMarker = function(lat, lon) {
    if (isNaN(lat) || isNaN(lon)) return;
    map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
    
    const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) ||
                           rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
    
    if (selectedStation) { setTimeout(() => { openForecourtDetailSheet(selectedStation); }, 300); }
};

window.executeStationDataFilteringPipeline = async function() {
    if (!rawGlobalStationsPool?.length && document.getElementById('fuel-type')?.value !== 'electric') return;
    
    const targetFuelType = document.getElementById('fuel-type')?.value || 'E10';
    const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
    const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
    let dynamicBoundedStations = [];

    // --- EV CHARGING STATION FETCH PIPELINE ---
    if (targetFuelType === 'electric') {
        const timelineContainer = document.getElementById('refuel-timeline-output');
        if (timelineContainer) timelineContainer.innerHTML = '<p class="text-center py-2 text-xs font-medium text-zinc-400">Locating optimal charge points...</p>';
        try {
            let ocmUrl = '';
            if (activeTabContext === 'route' && typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
                const sampledWaypoints = plottedRouteCoordinates.filter((_, idx) => idx % 12 === 0);
                const lats = sampledWaypoints.map(c => c[0]);
                const lngs = sampledWaypoints.map(c => c[1]);
                ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&key=${OCM_KEY}&swlatitude=${Math.min(...lats)}&swlongitude=${Math.min(...lngs)}&nelatitude=${Math.max(...lats)}&nelongitude=${Math.max(...lngs)}&maxresults=60&verbose=false`;
            } else {
                const searchLat = activeTabContext === 'local' ? mapSearchAnchorCoordinates[0] : (plottedRouteCoordinates.length > 0 ? plottedRouteCoordinates[0][0] : mapSearchAnchorCoordinates[0]);
                const searchLon = activeTabContext === 'local' ? mapSearchAnchorCoordinates[1] : (plottedRouteCoordinates.length > 0 ? plottedRouteCoordinates[0][1] : mapSearchAnchorCoordinates[1]);
                ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&key=${OCM_KEY}&latitude=${searchLat}&longitude=${searchLon}&distance=${targetLocalRadiusThreshold}&distanceunit=Miles&maxresults=50`;
            }
    
            const res = await fetch(ocmUrl);
            const data = await res.json();
    
            currentlyVisibleStations = data.map(poi => ({
                id: poi.ID, brand_name: poi.OperatorInfo?.Title || 'Independent Charger', address: poi.AddressInfo?.AddressLine1 || 'Location Registered',
                latitude: poi.AddressInfo?.Latitude, longitude: poi.AddressInfo?.Longitude,
                electric: poi.Connections?.[0]?.PowerKW || 50, 
                electric_price: 65.0, 
                is_public: poi.UsageType?.IsPayAtLocation ?? true, usage_title: poi.UsageType?.Title || 'Public Access', operator_url: poi.OperatorInfo?.WebsiteURL || null, isEV: true
            }));

            if (activeTabContext === 'route' && typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
                currentlyVisibleStations = currentlyVisibleStations.filter(s => {
                    return computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude), parseFloat(s.longitude)) <= targetCorridorRadiusThreshold;
                });
            }

            paintMarkerCanvasLayersToMap(currentlyVisibleStations, 'electric', currentlyVisibleStations.length, globalRouteDistanceMiles);
            generateCheapestRankingListDeck(currentlyVisibleStations, 'electric');
            if (activeTabContext === 'route') calculateOptimalRefuelStrategy();
        } catch (err) { Toast.show("Failed to fetch live EV locations from OpenChargeMap", "error"); }
        return;
    }
    // --- COMBUSTION FUEL PIPELINE ---
    else {
        if (activeTabContext === 'local' || !plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
            dynamicBoundedStations = rawGlobalStationsPool.filter(s => {
                if (!s[targetFuelType] || isNaN(parseFloat(s[targetFuelType]))) return false;
                return computeDistanceVectorMiles(mapSearchAnchorCoordinates[0], mapSearchAnchorCoordinates[1], parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetLocalRadiusThreshold;
            });
        } else {
            dynamicBoundedStations = rawGlobalStationsPool.filter(s => {
                if (!s[targetFuelType] || isNaN(parseFloat(s[targetFuelType]))) return false;
                return computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) <= targetCorridorRadiusThreshold;
            });
        }
    }

    currentlyVisibleStations = dynamicBoundedStations;
    let distanceContext = (activeTabContext === 'route' && typeof globalRouteDistanceMiles !== 'undefined') ? globalRouteDistanceMiles : null;
    paintMarkerCanvasLayersToMap(currentlyVisibleStations.slice(0, 250), targetFuelType, currentlyVisibleStations.length, distanceContext);
    generateCheapestRankingListDeck(currentlyVisibleStations, targetFuelType);
    if (activeTabContext === 'route') calculateOptimalRefuelStrategy();
};

window.generateCheapestRankingListDeck = function(pool, fuelVariant) {
    const block = document.getElementById('cheapest-ranking-block');
    const container = document.getElementById('cheapest-cards-stack');
    const blockTitle = document.getElementById('ranking-block-title');
    if (!block || !container) return;

    const isEV = fuelVariant === 'electric';
    const validPool = pool.filter(s => {
        if (isEV) return s.isEV === true || s.hasOwnProperty('electric_price');
        return s[fuelVariant] && !isNaN(parseFloat(s[fuelVariant])) && parseFloat(s[fuelVariant]) > 0;
    });

    if (validPool.length === 0) { block.classList.add('hidden'); return; }
    container.innerHTML = '';
    
    const unitString = isEV ? 'p/kWh' : 'p';
    blockTitle.textContent = isEV ? "3 Cheapest EV Chargers Nearby" : "3 Cheapest Stations Nearby";

    if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
        blockTitle.textContent = isEV ? "3 Cheapest EV Chargers On Route" : "3 Cheapest Stations On Route";
        const milestones = [];
        milestones.push({ label: "Start", node: cachedGeocodedWaypoints.start });
        Object.keys(cachedGeocodedWaypoints.vids).forEach(key => { milestones.push({ label: `Stopover`, node: cachedGeocodedWaypoints.vids[key] }); });
        milestones.push({ label: "Destination", node: cachedGeocodedWaypoints.end });

        milestones.forEach(milestone => {
            let sortedSubPool = validPool.map(station => {
                const sLat = parseFloat(station.latitude || station.lat); const sLon = parseFloat(station.longitude || station.lng);
                return { station, distanceToNode: computeDistanceVectorMiles(milestone.node.lat, milestone.node.lon, sLat, sLon) };
            }).filter(item => item.distanceToNode <= 12);
            
            sortedSubPool.sort((a, b) => {
                const priceA = isEV ? parseFloat(a.station.electric_price || 65) : parseFloat(a.station[fuelVariant]);
                const priceB = isEV ? parseFloat(b.station.electric_price || 65) : parseFloat(b.station[fuelVariant]);
                return priceA - priceB;
            });

            let slicedTopThree = sortedSubPool.slice(0, 3);
            if (slicedTopThree.length > 0) {
                const subGroupWrapper = document.createElement('div');
                subGroupWrapper.className = "space-y-1.5 p-2 bg-zinc-50/70 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-800/60";
                const subGroupHeader = document.createElement('div');
                subGroupHeader.className = "flex justify-between items-center px-1 text-[9px] font-black tracking-tight text-zinc-400 dark:text-zinc-500 uppercase";
                subGroupHeader.innerHTML = `<span>📍 ${milestone.label}: <span class="text-zinc-700 dark:text-zinc-300 font-black">${milestone.node.name.split(',')[0]}</span></span>`;
                subGroupWrapper.appendChild(subGroupHeader);

                slicedTopThree.forEach((item, idx) => {
                    const lat = parseFloat(item.station.latitude || item.station.lat); const lon = parseFloat(item.station.longitude || item.station.lng);
                    const priceValue = isEV ? parseFloat(item.station.electric_price || 65).toFixed(1) : parseFloat(item.station[fuelVariant]).toFixed(1);
                    const card = document.createElement('div');
                    card.className = "flex items-center justify-between p-2.5 bg-white dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800 rounded-lg hover:border-emerald-500 transition shadow-xs cursor-pointer";
                    card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
                    card.innerHTML = `
                        <div class="flex items-center gap-2 min-w-0"><div class="w-4 h-4 rounded bg-emerald-500/10 text-[8px] flex items-center justify-center shrink-0 font-black text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">${idx + 1}</div><div class="min-w-0"><div class="text-xs font-bold text-zinc-900 dark:text-white truncate">${(item.station.brand_name || 'Independent').replace(/['"]/g, '')}</div><div class="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 truncate">${item.station.address || ''} • <span class="font-bold text-emerald-700 dark:text-emerald-500">${item.distanceToNode.toFixed(1)} mi</span></div></div></div>
                        <div class="text-right shrink-0"><div class="text-[10px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md">${priceValue}${unitString}</div></div>
                    `;
                    subGroupWrapper.appendChild(card);
                });
                container.appendChild(subGroupWrapper);
            }
        });
    } else {
        validPool.sort((a, b) => {
            const priceA = isEV ? parseFloat(a.electric_price || 65) : parseFloat(a[fuelVariant]);
            const priceB = isEV ? parseFloat(b.electric_price || 65) : parseFloat(b[fuelVariant]);
            return priceA - priceB;
        });
        validPool.slice(0, 3).forEach((station, idx) => {
            const lat = parseFloat(station.latitude || station.lat); const lon = parseFloat(station.longitude || station.lng);
            const priceValue = isEV ? parseFloat(station.electric_price || 65).toFixed(1) : parseFloat(station[fuelVariant]).toFixed(1);
            const card = document.createElement('div');
            card.className = "flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl hover:border-emerald-500 transition shadow-sm cursor-pointer";
            card.setAttribute('onclick', `focusAndHighlightMapMarker(${lat}, ${lon})`);
            card.innerHTML = `
                <div class="flex items-center gap-2 min-w-0"><div class="w-5 h-5 rounded-md bg-emerald-500/10 text-[9px] flex items-center justify-center shrink-0 font-black text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">#${idx + 1}</div><div class="min-w-0"><div class="text-xs font-black text-zinc-900 dark:text-white truncate">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div><div class="text-[9px] font-medium text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${station.address || ''}</div></div></div>
                <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md">${priceValue}${unitString}</div></div>
            `;
            container.appendChild(card);
        });
    }
    block.classList.remove('hidden');
};

function assignPricingTierColorStyles(valueRaw, variantKey) {
    const fallbackClasses = "bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900 dark:border-zinc-800";
    if (!valueRaw) return fallbackClasses;
    const numericVal = parseFloat(valueRaw);
    if (isNaN(numericVal) || numericVal <= 0) return fallbackClasses;
    if (variantKey === 'electric') {
        if (numericVal <= 50) return "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold";
        if (numericVal <= 70) return "bg-blue-50 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold";
        return "bg-rose-50 dark:bg-rose-950/40 border-rose-400 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold";
    }
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

window.paintMarkerCanvasLayersToMap = function(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
    if(!markerClusterGroupInstance) return;
    markerClusterGroupInstance.clearLayers();
    const isEV = variant === 'electric';
    const pricesArray = stationsList.map(s => {
        let p = parseFloat(s[variant]);
        if (isEV && (!p || isNaN(p))) p = parseFloat(s.electric_price || s.electric);
        return p;
    }).filter(p => !isNaN(p) && p > 0);
    
    const globalPricesArray = rawGlobalStationsPool.map(s => parseFloat(s[variant])).filter(p => !isNaN(p) && p > 0).sort((a, b) => a - b);
    let greenThreshold = 0, blueThreshold = 0;

    if (isEV) { greenThreshold = 65; blueThreshold = 75; } 
    else if (globalPricesArray.length > 0) {
        greenThreshold = globalPricesArray[Math.floor(globalPricesArray.length * 0.333)];
        blueThreshold = globalPricesArray[Math.floor(globalPricesArray.length * 0.666)];
    }

    stationsList.forEach((station) => {
        let numericPrice = parseFloat(station[variant]);
        if (isEV && (!numericPrice || isNaN(numericPrice))) numericPrice = parseFloat(station.electric_price || station.electric);
        if (!numericPrice || isNaN(numericPrice)) return;
        
        let tierBgClassColor = 'bg-fuel-blue';
        if (isEV || globalPricesArray.length > 0) {
            if (numericPrice <= greenThreshold) tierBgClassColor = 'bg-fuel-green';
            else if (numericPrice <= blueThreshold) tierBgClassColor = 'bg-fuel-blue';
            else tierBgClassColor = 'bg-fuel-red';
        }

        const markerInstance = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
            stationRawData: station,
            icon: L.divIcon({ html: `<div class="leaflet-div-icon-reset"><div class="fuel-marker-bubble ${tierBgClassColor} transform transition-all duration-200 hover:scale-125 shadow-lg flex items-center justify-center text-white font-black text-[10px] rounded-full px-2 py-0.5 whitespace-nowrap">${isEV?'⚡':''}${numericPrice.toFixed(1)}${isEV?'p':'p'}</div></div>`, className: 'leaflet-div-icon-reset', iconSize: [50, 24], iconAnchor: [25, 12] })
        });
        
        markerInstance.on('click', (e) => { L.DomEvent.stopPropagation(e); openForecourtDetailSheet(station); });
        markerClusterGroupInstance.addLayer(markerInstance);
    });

    const cNode = document.getElementById('station-counter');
    if (cNode) cNode.textContent = `Stations: ${fallbackTotalCount}`;
};

window.toggleCurrentStationStar = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;
    const stationKey = `${activeSheetStation.latitude || activeSheetStation.lat}_${activeSheetStation.longitude || activeSheetStation.lng}`;
    const matchingIndex = starredStations.findIndex(s => `${s.latitude || s.lat}_${s.longitude || s.lng}` === stationKey);

    if (matchingIndex > -1) starredStations.splice(matchingIndex, 1);
    else starredStations.push(activeSheetStation);
    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    updateDirectoryTotalBadge(); updateAllStarUIStates();
};

function updateAllStarUIStates() {
    if (!activeSheetStation) return;
    const isStarred = starredStations.some(s => `${s.latitude || s.lat}_${s.longitude || s.lng}` === `${activeSheetStation.latitude || activeSheetStation.lat}_${activeSheetStation.longitude || activeSheetStation.lng}`);
    const sheetBtn = document.getElementById('sheet-star-btn');
    if (sheetBtn) {
        sheetBtn.innerHTML = isStarred ? ACTIVE_STAR_SVG : INACTIVE_STAR_SVG;
        sheetBtn.className = isStarred ? "p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8" : "p-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-400 hover:text-amber-500 rounded-xl cursor-pointer flex items-center justify-center w-8 h-8";
    }
    const dPanel = document.getElementById('starred-dropdown-panel');
    if (dPanel && !dPanel.classList.contains('hidden')) renderDirectoryDropdown();
}

window.toggleStarredDropdownDashboardPanel = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const panel = document.getElementById('starred-dropdown-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) { closeForecourtDetailSheet(); panel.classList.remove('hidden'); renderDirectoryDropdown(); } 
    else { panel.classList.add('hidden'); }
};

function renderDirectoryDropdown() {
    const container = document.getElementById('starred-list-container');
    if (!container) return;
    starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
    savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];

    if (activeDirectoryTab === 'stations') {
        if (starredStations.length === 0) { container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No monitored terminals.</div>`; return; }
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
                <div class="min-w-0"><div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">${(station.brand_name || 'Independent').replace(/['"]/g, '')}</div><div class="text-[9px] font-semibold text-zinc-400 dark:text-zinc-500 truncate mt-0.5">${(station.address || '').replace(/['"]/g, '')}</div></div>
                <div class="grid grid-cols-2 gap-1 pt-0.5"><div class="border p-1 rounded-lg text-center tabular-nums ${assignPricingTierColorStyles(station.E10, 'E10')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">E10</div><div class="text-[10px] font-black mt-0.5">${station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A'}</div></div><div class="border p-1 rounded-lg text-center tabular-nums ${assignPricingTierColorStyles(station.B7, 'B7')}"><div class="text-[7px] font-bold uppercase tracking-tight opacity-75">Diesel</div><div class="text-[10px] font-black mt-0.5">${station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A'}</div></div></div>`;
            container.appendChild(cardRow);
        });
    } else {
        if (savedRoutes.length === 0) { container.innerHTML = `<div class="text-center py-6 text-zinc-400 text-xs font-semibold">No custom routes found.</div>`; return; }
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
                <div class="min-w-0 flex-1"><div class="text-xs font-black text-zinc-900 dark:text-white truncate flex items-center gap-1">🛣️ ${route.name}</div><div class="text-[8px] font-bold text-zinc-400 dark:text-zinc-500 tracking-wide uppercase mt-1 tabular-nums">MPG: ${route.mpg} • Stops: ${route.waypoints ? route.waypoints.length : 0}</div></div>
                <button onclick="deleteSavedRouteCorridor('${route.id}', event)" class="p-1.5 text-zinc-400 hover:text-rose-500 cursor-pointer rounded-lg hover:bg-rose-500/10 transition focus:outline-none focus:ring-1 focus:ring-rose-500" title="Delete Saved Corridor">✕</button>
            `;
            container.appendChild(cardRow);
        });
    }
}

window.openForecourtDetailSheet = function(stationData) {
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;
    const sp = document.getElementById('starred-dropdown-panel');
    if (sp) sp.classList.add('hidden');
    
    activeSheetStation = stationData;
    document.getElementById('sheet-brand-title').textContent = (stationData.brand_name || 'Independent Hub').replace(/['"]/g, '');
    document.getElementById('sheet-address-details').textContent = (stationData.address || 'UK Grid Station').replace(/['"]/g, '');

    const isEVPipe = stationData.isEV || document.getElementById('fuel-type')?.value === 'electric';

    if (isEVPipe) {
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        let evCard = document.getElementById('card-wrap-ev');
        if (!evCard) {
            evCard = document.createElement('div'); evCard.id = 'card-wrap-ev';
            const e10Card = document.getElementById('card-wrap-e10'); if (e10Card) e10Card.parentElement.appendChild(evCard);
        }
        
        let pRate = parseFloat(stationData.electric_price || stationData.electric || 65);
        let speed = parseFloat(stationData.charge_rate || stationData.electric || 50);

        if(evCard) {
            evCard.style.display = 'block';
            evCard.className = `border p-3 rounded-xl text-center transition-all duration-200 col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-sm`;
            evCard.innerHTML = `<span class="text-[10px] font-black uppercase tracking-wider block opacity-75">⚡ Rapid Charging Rate</span><span class="text-xl font-black block mt-1 tabular-nums">${pRate.toFixed(1)} <span class="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70">p/kWh</span> <span class="text-[10px] font-medium text-emerald-700 dark:text-emerald-500 ml-1">(${speed}kW Max)</span></span>`;
        }
        document.getElementById('sheet-brand-title').textContent = `⚡ ${(stationData.brand_name || 'EV Charger').replace(/['"]/g, '')}`;

    } else {
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'block'; });
        const evCard = document.getElementById('card-wrap-ev'); if (evCard) evCard.style.display = 'none';

        const ce10 = document.getElementById('card-wrap-e10'); if(ce10) ce10.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E10, 'E10')}`;
        const ce5 = document.getElementById('card-wrap-e5'); if(ce5) ce5.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.E5, 'E5')}`;
        const cb7 = document.getElementById('card-wrap-b7'); if(cb7) cb7.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.B7, 'B7')}`;
        const cpd = document.getElementById('card-wrap-premiumdiesel'); if(cpd) cpd.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(stationData.PremiumDiesel, 'PremiumDiesel')}`;

        const se10 = document.getElementById('sheet-price-e10'); if(se10) se10.textContent = stationData.E10 ? `${parseFloat(stationData.E10).toFixed(1)}p` : 'N/A';
        const se5 = document.getElementById('sheet-price-e5'); if(se5) se5.textContent = stationData.E5 ? `${parseFloat(stationData.E5).toFixed(1)}p` : 'N/A';
        const sb7 = document.getElementById('sheet-price-b7'); if(sb7) sb7.textContent = stationData.B7 ? `${parseFloat(stationData.B7).toFixed(1)}p` : 'N/A';
        const spd = document.getElementById('sheet-price-premiumdiesel'); if(spd) spd.textContent = stationData.PremiumDiesel ? `${parseFloat(stationData.PremiumDiesel).toFixed(1)}p` : 'N/A';
    }

    updateAllStarUIStates();
    sheet.classList.remove('hidden'); 
    if (window.innerWidth < 768) setMobileSheetUIState('full'); 
};

window.closeForecourtDetailSheet = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;
    if (window.innerWidth < 768) setMobileSheetUIState('hidden'); else sheet.classList.add('hidden');
    activeSheetStation = null;
};

window.triggerExternalMappingVectorRoute = function(event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;
    window.open(`http://googleusercontent.com/maps.google.com/maps?q=${activeSheetStation.latitude || activeSheetStation.lat},${activeSheetStation.longitude || activeSheetStation.lng}`, '_blank');
};

// -------------------------------------------------------------
// CORE CALCULATOR: Smart Refuel Optimization
// -------------------------------------------------------------
window.calculateOptimalRefuelStrategy = function() {
    const fuelType = document.getElementById('fuel-type')?.value || 'E10';
    const isEV = fuelType === 'electric';
    const capacity = parseFloat(document.getElementById('refuel-tank-size')?.value) || (isEV ? 60 : 55);
    const currentPct = parseFloat(document.getElementById('refuel-current-level')?.value) || 25;
    const safetyBuffer = parseFloat(document.getElementById('refuel-safety-buffer')?.value) || 10;
    const userMpg = parseFloat(document.getElementById('vehicle-mpg')?.value) || 45;
    
    const timeline = document.getElementById('refuel-timeline-output');
    
    if (!globalRouteDistanceMiles || globalRouteDistanceMiles === 0 || !plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
        if (timeline) { timeline.classList.remove('hidden'); timeline.innerHTML = '<p class="text-zinc-500 dark:text-zinc-500 text-[10px] text-center font-medium">Map a route to unlock AI Refuel Strategy.</p>'; }
        return; 
    }

    let maxRangeMiles = 0;
    let currentRangeMiles = 0;

    if (isEV) { 
        const efficiency = 3.5;
        const currentKwh = capacity * (currentPct / 100);
        currentRangeMiles = currentKwh * efficiency;
        maxRangeMiles = capacity * efficiency; 
    } 
    else { 
        const mpg = userMpg;
        const currentLiters = capacity * (currentPct / 100);
        const gallons = currentLiters * 0.219969;
        currentRangeMiles = gallons * mpg;
        maxRangeMiles = (capacity * 0.219969) * mpg;
    }

    const remainingUsableRange = currentRangeMiles - safetyBuffer;

    if (remainingUsableRange >= globalRouteDistanceMiles) {
        if (timeline) { timeline.classList.remove('hidden'); timeline.innerHTML = `<div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-3.5 rounded-xl text-xs flex flex-col gap-1 shadow-sm"><div class="font-bold flex items-center gap-1">🎉 ${isEV ? 'Battery Charge' : 'Fuel Tank'} Sufficient!</div><p class="text-zinc-500 font-medium leading-normal">Your current range covers this ${globalRouteDistanceMiles.toFixed(1)} mi trip without stopping.</p></div>`; }
        if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) refuelMarkersGroup.clearLayers();
        return;
    }

    let validStations = currentlyVisibleStations.filter(s => {
        let p = isEV ? parseFloat(s.electric_price || 65) : parseFloat(s[fuelType]);
        return p && !isNaN(p) && p > 0;
    });

    if (validStations.length === 0) {
        if (timeline) { timeline.classList.remove('hidden'); timeline.innerHTML = `<p class="text-zinc-400 text-xs text-center py-2 font-medium">No active ${isEV ? 'chargers' : 'fuel stations'} found.</p>`; }
        return;
    }

    let bestStation = null;
    let isEmergencyMode = false;
    const startLat = plottedRouteCoordinates[0][0]; const startLon = plottedRouteCoordinates[0][1];

    if (currentPct <= 5 || remainingUsableRange <= 0) {
        isEmergencyMode = true;
        validStations.sort((a, b) => computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng)) - computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng)));
        bestStation = validStations[0];
    } else {
        let reachableStations = validStations.filter(s => { return (computeDistanceVectorMiles(startLat, startLon, parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng)) * 1.2) <= remainingUsableRange; });
        if (reachableStations.length === 0) {
            isEmergencyMode = true;
            validStations.sort((a, b) => computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng)) - computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng)));
            bestStation = validStations[0];
            Toast.show(`Showing nearest emergency stop.`, 'warning');
        } else {
            reachableStations.sort((a, b) => {
                let pA = isEV ? parseFloat(a.electric_price || 65) : parseFloat(a[fuelType]);
                let pB = isEV ? parseFloat(b.electric_price || 65) : parseFloat(b[fuelType]);
                return pA - pB;
            });
            bestStation = reachableStations[0];
        }
    }
    
    if (!bestStation) return;
    const lat = parseFloat(bestStation.latitude || bestStation.lat || 0); const lon = parseFloat(bestStation.longitude || bestStation.lng || 0);
    let bestPrice = isEV ? parseFloat(bestStation.electric_price || 65) : parseFloat(bestStation[fuelType] || 0);
    const currentEnergyUnits = capacity * (currentPct / 100);
    const energyToFill = Math.max(0, capacity - currentEnergyUnits);
    const totalCost = (energyToFill * bestPrice) / 100;
    const distToStop = computeDistanceVectorMiles(startLat, startLon, lat, lon) * 1.2;

    if (timeline) {
        timeline.classList.remove('hidden');
        timeline.innerHTML = `
            <div class="bg-zinc-100 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800/80 p-4 rounded-xl text-xs space-y-3 shadow-sm tabular-nums mt-1">
                <div class="relative border-l-2 border-dashed border-zinc-300 dark:border-zinc-700 ml-2 pl-4 py-1 space-y-4">
                    <div class="relative">
                        <div class="absolute w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[23px] top-0.5"></div>
                        <span class="text-zinc-600 dark:text-zinc-500 font-medium block leading-none">Start</span>
                    </div>
                    <div class="relative">
                        <div class="absolute w-3 h-3 bg-amber-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[23px] top-0.5"></div>
                        <div class="flex justify-between items-start">
                            <div>
                                <span class="text-zinc-900 dark:text-white font-bold block leading-none">${(bestStation.brand_name || 'Station').replace(/['"]/g, '')}</span>
                                <span class="text-[9px] text-zinc-500 block mt-1">${(bestStation.address || '').replace(/['"]/g, '')}</span>
                            </div>
                            <span class="font-bold text-zinc-900 dark:text-white">~${distToStop.toFixed(1)} mi</span>
                        </div>
                    </div>
                    <div class="relative">
                        <div class="absolute w-3 h-3 bg-rose-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[23px] top-0.5"></div>
                        <div class="flex justify-between items-center">
                            <span class="text-zinc-600 dark:text-zinc-500 font-medium block leading-none">Destination</span>
                            <span class="font-bold text-zinc-900 dark:text-white">${globalRouteDistanceMiles.toFixed(1)} mi</span>
                        </div>
                    </div>
                </div>
                <div class="border-t border-zinc-200 dark:border-zinc-800/50 pt-2 mt-2">
                    <div class="flex justify-between bg-emerald-50/50 dark:bg-emerald-950/20 -mx-4 px-4 py-2">
                        <span class="text-emerald-600 dark:text-emerald-500 font-bold">Action</span>
                        <span class="font-black text-emerald-700 dark:text-emerald-400">${isEV ? 'Charge' : 'Fill'} ${energyToFill.toFixed(1)} ${isEV ? 'kWh' : 'L'}</span>
                    </div>
                    <div class="flex justify-between pt-2 items-center">
                        <span class="text-zinc-600 dark:text-zinc-500 font-medium">Est. Cost</span>
                        <div class="text-right">
                            <span class="font-black text-zinc-900 dark:text-white text-base">£${totalCost.toFixed(2)}</span>
                            <span class="text-[9px] text-zinc-500 block">@ ${bestPrice.toFixed(1)}${isEV?'p/kWh':'p'}</span>
                        </div>
                    </div>
                </div>
                <button type="button" onclick="focusAndHighlightMapMarker(${lat}, ${lon})" class="w-full mt-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-[11px] font-bold py-2.5 rounded-lg transition active:scale-95 shadow-sm">View on Map</button>
            </div>
        `;
    }

    if (typeof window.refuelMarkersGroup === 'undefined' || window.refuelMarkersGroup === null) window.refuelMarkersGroup = L.layerGroup().addTo(map);
    window.refuelMarkersGroup.clearLayers();
    const customFuelIcon = L.divIcon({ className: 'custom-fuel-icon', html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-amber-500 border-amber-800'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">${isEV ? '⚡' : '⛽'}</div>`, iconSize: [32, 32], iconAnchor: [16, 32] });
    L.marker([lat, lon], { icon: customFuelIcon }).addTo(window.refuelMarkersGroup);
};

window.clearFuelOptimizationState = function() {
    const inputTank = document.getElementById('refuel-tank-size'); const inputStarting = document.getElementById('refuel-current-level'); const inputReserve = document.getElementById('refuel-safety-buffer');
    if (inputTank) inputTank.value = "55"; if (inputStarting) inputStarting.value = "25"; if (inputReserve) inputReserve.value = "30";
    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) refuelMarkersGroup.clearLayers();
    const timelineContainer = document.getElementById('refuel-timeline-output');
    if (timelineContainer) timelineContainer.innerHTML = '<p class="text-zinc-400 dark:text-zinc-500 text-[10px] text-center font-medium">Map a route to unlock AI Refuel Strategy.</p>';
};

window.toggleRightSidebar = function(forceState = null) {
    const sidebar = document.getElementById('right-telemetry-sidebar');
    if (!sidebar) return;
    const isHidden = sidebar.classList.contains('translate-x-full');
    const targetOpen = forceState !== null ? forceState : isHidden;

    if (targetOpen) {
        sidebar.classList.remove('translate-x-full');
        if (window.innerWidth < 768 && typeof setMobileSidebarState === 'function') setMobileSidebarState('hidden');
    } else {
        sidebar.classList.add('translate-x-full');
    }
};

// --- APP LIFECYCLE INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initMap(); 
    try {
        if (document.getElementById('sidebar-drag-handle')) bindSwipeGestureDetectionToMobileSheets('sidebar-drag-handle', 'desktop-sidebar', setMobileSidebarState);
        if (document.getElementById('detail-sheet-drag-handle')) bindSwipeGestureDetectionToMobileSheets('detail-sheet-drag-handle', 'global-detail-sheet', setMobileSheetUIState);
    } catch (err) { console.warn('UI Initialization skipped: Sidebar/Sheet elements not found.', err); }

    const fuelTypeSelector = document.getElementById('fuel-type');
    if (fuelTypeSelector) { fuelTypeSelector.addEventListener('change', (e) => { const isEV = e.target.value === 'electric'; updateUIForMode(isEV); executeStationDataFilteringPipeline(); }); }
    const radiusSlider = document.getElementById('radius-slider');
    if (radiusSlider) { radiusSlider.addEventListener('input', (e) => { const readout = document.getElementById('radius-val'); if (readout) readout.textContent = `${e.target.value} Miles`; executeStationDataFilteringPipeline(); }); }
    const detourSlider = document.getElementById('route-radius-slider');
    if (detourSlider) { detourSlider.addEventListener('input', (e) => { const readout = document.getElementById('route-radius-val'); if (readout) readout.textContent = `${e.target.value} Mi`; executeStationDataFilteringPipeline(); }); }

    setupAutocompleteListeners();
    initializeClickIsolationBubbling();

    if (typeof switchWorkflowTabContext === 'function') {
        switchWorkflowTabContext('local');
    }
});
