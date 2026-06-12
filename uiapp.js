// ==========================================
// UIAPP-3.JS: INTERFACE CONTROLLER LAYER
// ==========================================

// --- OpenWeatherMap Credential Integrations
const OPENWEATHER_API_KEY = '5e67010087dac92dd2eb31bc4c0a2abf';
const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e';
const weatherCacheMap = new Map();

// --- Tailwind Dynamic Design Token Injection Setup Layer
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                colors: {
                    zinc: { 950: '#040405', 1000: '#000000' },
                    fuel: { green: '#10b981', blue: '#3b82f6', red: '#ef4444' }
                }
            }
        }
    };
}

// --- Dynamic Async Weather Retrieval Component
async function fetchWeatherForStation(lat, lng) {
    const cacheKey = `${parseFloat(lat).toFixed(1)},${parseFloat(lng).toFixed(1)}`;
    if (weatherCacheMap.has(cacheKey)) {
        return weatherCacheMap.get(cacheKey);
    }
    const fallbackEmojis = ['☀️', '☁️', '🌦️', '🌧️'];
    const standardFallback = fallbackEmojis[Math.abs(Math.floor(Math.sin(lat) * 10)) % fallbackEmojis.length];

    if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'YOUR_OPENWEATHERMAP_API_KEY') {
        return { emoji: standardFallback, text: 'Default Weather' };
    }
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`;
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const type = data.weather?.[0]?.main || 'Clear';
        
        let emoji = '☀️';
        if (type.includes('Cloud')) emoji = '☁️';
        else if (type.includes('Rain') || type.includes('Drizzle')) emoji = '🌧️';
        else if (type.includes('Thunder')) emoji = '⛈️';
        else if (type.includes('Snow')) emoji = '❄️';
        else if (type.includes('Mist') || type.includes('Fog')) emoji = '🌫️';

        const payload = { emoji, text: type };
        weatherCacheMap.set(cacheKey, payload);
        return payload;
    } catch (err) {
        return { emoji: standardFallback, text: 'N/A' };
    }
}

// --- CORE TOAST NOTIFICATION SYSTEM MODULE
const Toast = {
    container: null,
    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
            document.body.appendChild(this.container);
        }
    },
    show(message, type = 'info') {
        this.init();
        const icons = {
            success: '✔',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xl border border-zinc-200/50 dark:border-zinc-800/50 p-3 rounded-xl flex items-center gap-2.5 transition-all duration-300 opacity-0 translate-y-2 pointer-events-auto max-w-sm`;
        toast.innerHTML = `
            <div class="relative z-10 flex items-center justify-center font-bold text-sm">${icons[type]}</div>
            <p class="relative z-10 m-0 leading-tight tracking-tight text-xs font-medium">${message}</p>
        `;
        this.container.appendChild(toast);
        
        requestAnimationFrame(() => {
            setTimeout(() => {
                toast.classList.add('opacity-100', 'translate-y-0');
            }, 10);
        });

        setTimeout(() => {
            toast.classList.remove('opacity-100', 'translate-y-0');
            toast.classList.add('opacity-0', 'translate-y-[-4px]');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

// --- CORE STATE MANAGERS & INTERFACE DATA BINDINGS
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

// --- Window Scoped Action Handlers
window.closeForecourtDetailSheet = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const sheet = document.getElementById('global-detail-sheet');
    if (sheet) {
        sheet.classList.add('hidden');
        if (window.innerWidth < 1024) {
            setMobileSheetUIState('hidden');
        }
    }
    activeSheetStation = null;
};

window.updateAllStarUIStates = function() {
    const btn = document.getElementById('sheet-star-btn');
    if (!btn || !activeSheetStation) return;
    const targetId = getStationId(activeSheetStation);
    const isStarred = starredStations.some(s => getStationId(s) === targetId);

    if (isStarred) {
        btn.innerHTML = '⭐ Saved';
        btn.className = 'flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 text-amber-500 text-xs font-semibold transition-all shadow-sm';
    } else {
        btn.innerHTML = '☆ Save Station';
        btn.className = 'flex items-center gap-1 px-3 py-1.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-transparent text-zinc-400 text-xs font-semibold transition-all hover:text-zinc-600 dark:hover:text-zinc-200';
    }
};

window.renderStarredDropdownList = function() {
    const container = document.getElementById('starred-list-items-container');
    if (!container) return;
    container.innerHTML = '';

    if (activeDirectoryTab === 'stations') {
        if (!starredStations || starredStations.length === 0) {
            container.innerHTML = '<div class="p-3 text-center text-xs text-zinc-500 font-medium">No saved stations yet.</div>';
            return;
        }
        starredStations.forEach(station => {
            const el = document.createElement('div');
            el.className = "flex items-center justify-between p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg cursor-pointer transition border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700/50";
            
            const lat = parseFloat(station.latitude || station.lat);
            const lon = parseFloat(station.longitude || station.lng);
            const stationName = (station.brand_name || station.name || station.brand || 'Independent Station').replace(/['"]/g, '');
            const stationAddress = (station.address || 'Location stored').replace(/['"]/g, '');
            const stationId = getStationId(station);

            el.onclick = () => {
                focusAndHighlightMapMarker(lat, lon);
                document.getElementById('starred-dropdown-panel').classList.add('hidden');
            };
            el.innerHTML = `
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">${stationName}</div>
                    <div class="text-[9px] text-zinc-500 truncate">${stationAddress}</div>
                </div>
                <button onclick="event.stopPropagation(); toggleStarStation('${stationId}')" class="p-1.5 text-zinc-400 hover:text-rose-500 transition text-xs">✕</button>
            `;
            container.appendChild(el);
        });
    } else {
        if (!savedRoutes || savedRoutes.length === 0) {
            container.innerHTML = '<div class="p-3 text-center text-xs text-zinc-500 font-medium">No saved routes yet.</div>';
            return;
        }
        savedRoutes.forEach(route => {
            const el = document.createElement('div');
            el.className = "flex flex-col gap-1 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg cursor-pointer transition border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700/50";
            el.onclick = () => { loadSavedRouteCorridorDataIntoWorkspace(route.id); };
            el.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="text-xs font-bold text-emerald-600 dark:text-emerald-400 truncate pr-2">${route.name}</div>
                    <button onclick="deleteSavedRouteCorridor('${route.id}', event)" class="p-1.5 text-zinc-400 hover:text-rose-500 transition text-xs shrink-0">✕</button>
                </div>
                <div class="text-[9px] text-zinc-500 truncate flex items-center gap-1">${route.start.split(',')[0]} → ${route.end.split(',')[0]}</div>
            `;
            container.appendChild(el);
        });
    }
};

window.toggleCurrentStationStar = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (activeSheetStation) {
        toggleStarStation(getStationId(activeSheetStation));
    }
};

window.triggerExternalMappingVectorRoute = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    if (!activeSheetStation) return;
    const lat = activeSheetStation.latitude || activeSheetStation.lat;
    const lon = activeSheetStation.longitude || activeSheetStation.lng;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    window.open(url, '_blank');
};

window.toggleStarredDropdownDashboardPanel = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const panel = document.getElementById('starred-dropdown-panel');
    if (panel) {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            renderStarredDropdownList();
        }
    }
};

window.toggleStarStation = function(stationId) {
    const index = starredStations.findIndex(s => getStationId(s) === String(stationId));
    if (index > -1) {
        starredStations.splice(index, 1);
        Toast.show("Station removed from your saved list.", "info");
    } else {
        const station = rawGlobalStationsPool.find(s => getStationId(s) === String(stationId)) || 
                        currentlyVisibleStations.find(s => getStationId(s) === String(stationId));
        if (station) {
            if (!station.id) station.id = stationId;
            starredStations.push(station);
            Toast.show("Station saved to your shortcuts successfully!", "success");
        }
    }
    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    updateAllStarUIStates();
    updateSavedItemsCountUI();
    
    const dp = document.getElementById('starred-dropdown-panel');
    if (dp && !dp.classList.contains('hidden')) renderStarredDropdownList();
};

window.fetchEVStationsInBounds = async function(southwest, northEast) {
    try {
        const url = `https://api.openchargemap.io/v3/poi/?key=${OCM_KEY}&output=json&swlat=${southwest.lat}&swlng=${southwest.lng}&nelat=${northEast.lat}&nelng=${northEast.lng}&maxresults=500&compact=true&verbose=false`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map(poi => ({
            id: 'ev-' + poi.ID,
            name: poi.AddressInfo.Title,
            brand: poi.OperatorInfo ? poi.OperatorInfo.Title : 'Independent Charger',
            address: poi.AddressInfo.AddressLine1 + ', ' + (poi.AddressInfo.Town || ''),
            lat: poi.AddressInfo.Latitude,
            lon: poi.AddressInfo.Longitude,
            isEV: true,
            connections: (poi.Connections || []).map(c => ({
                type: c.ConnectionType ? c.ConnectionType.Title : 'Unknown Plug',
                power: c.PowerKW || null
            }))
        }));
    } catch (err) {
        console.error("OpenChargeMap network ingestion failure:", err);
        return [];
    }
};

// --- Form State Listeners Hooks Bindings
document.getElementById('refuel-tank-size')?.addEventListener('change', () => { 
    if (typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); 
});
document.getElementById('refuel-current-level')?.addEventListener('change', () => { 
    if (typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); 
});
document.getElementById('refuel-safety-buffer')?.addEventListener('change', () => { 
    if (typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); 
});

const fuelTypeSelectListener = document.getElementById('fuel-type-select');
if (fuelTypeSelectListener) {
    fuelTypeSelectListener.addEventListener('change', () => {
        if (activeTabContext === 'route') {
            const startInput = document.getElementById('route-start');
            const endInput = document.getElementById('route-end');
            if (startInput && endInput && startInput.value.trim() !== '' && endInput.value.trim() !== '') {
                if (typeof executeRouteGenerationPipeline === 'function') {
                    executeRouteGenerationPipeline();
                }
            }
        }
    });
}

// --- MOBILE UX OVERLAY SIDEBAR SWITCHERS
window.setActiveMobileSheet = function(targetType) {
    const leftSidebar = document.getElementById('primary-control-sidebar');
    const rightSidebar = document.getElementById('secondary-control-sidebar');
    const btnSearch = document.getElementById('btn-mob-search');
    const btnTelemetry = document.getElementById('btn-mob-telemetry');
    const btnViewStationsDesktop = document.getElementById('toggle-view-stations');
    const btnViewTelemetryDesktop = document.getElementById('toggle-view-telemetry');

    if (targetType === 'search') {
        if (rightSidebar) {
            rightSidebar.classList.remove('mobile-active-sheet');
            rightSidebar.classList.add('hidden', 'desktop-collapsed-right');
        }
        if (leftSidebar) {
            leftSidebar.classList.remove('hidden', 'desktop-collapsed');
            leftSidebar.classList.add('mobile-active-sheet');
            leftSidebar.style.zIndex = "2000";
        }
        if (btnSearch) btnSearch.className = "h-full text-[11px] font-black tracking-wide px-4 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 transition-all shadow-sm focus:outline-none";
        if (btnTelemetry) btnTelemetry.className = "h-full text-[11px] font-bold tracking-wide px-4 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all focus:outline-none";
        if (btnViewStationsDesktop) btnViewStationsDesktop.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/40 dark:border-zinc-700/30 transition-all duration-200 focus:outline-none";
        if (btnViewTelemetryDesktop) btnViewTelemetryDesktop.className = "flex-1 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 focus:outline-none";
        setMobileSidebarState('mid');
    } else if (targetType === 'telemetry') {
        if (leftSidebar) {
            leftSidebar.classList.remove('mobile-active-sheet');
            leftSidebar.classList.add('hidden', 'desktop-collapsed');
        }
        if (rightSidebar) {
            rightSidebar.classList.remove('hidden', 'desktop-collapsed-right');
            rightSidebar.classList.add('mobile-active-sheet');
            rightSidebar.style.zIndex = "2000";
        }
        if (btnTelemetry) btnTelemetry.className = "h-full text-[11px] font-black tracking-wide px-4 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 transition-all shadow-sm focus:outline-none";
        if (btnSearch) btnSearch.className = "h-full text-[11px] font-bold tracking-wide px-4 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all focus:outline-none";
        if (btnViewTelemetryDesktop) btnViewTelemetryDesktop.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/40 dark:border-zinc-700/30 transition-all duration-200 focus: outline-none";
        if (btnViewStationsDesktop) btnViewStationsDesktop.className = "flex-1 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 focus:outline-none";
        setMobileRightSidebarState('mid');
    }
};

// --- 3-STATE MOBILE GESTURE SWIPE MECHANICAL ENGINE
let currentMobileSidebarUIState = 'peek';
let currentMobileRightSidebarUIState = 'hidden';
let currentMobileSheetUIState = 'hidden';

function bindMobileSwipeDrawer(handleId, elementId) {
    const handle = document.getElementById(handleId);
    const drawer = document.getElementById(elementId);
    if (!handle || !drawer) return;

    let startY = 0, currentY = 0, isDragging = false, startTime = 0;
    const isMainSidebar = elementId === 'primary-control-sidebar';
    const isRightSidebar = elementId === 'secondary-control-sidebar';

    handle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        startTime = Date.now();
        isDragging = true;
        drawer.classList.add('dragging');
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        
        let activeState = isMainSidebar ? currentMobileSidebarUIState : (isRightSidebar ? currentMobileRightSidebarUIState : currentMobileSheetUIState);
        let baseTranslate = (activeState === 'full') ? 0 : (activeState === 'mid') ? window.innerHeight * 0.5 : (window.innerHeight - 110);
        let newTranslate = baseTranslate + deltaY;
        
        if (newTranslate < 0) newTranslate = 0;
        drawer.style.transform = `translateY(${newTranslate}px)`;
    }, { passive: true });

    handle.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        drawer.classList.remove('dragging');
        drawer.style.transform = '';
        
        const deltaY = currentY - startY;
        const timeDiff = Date.now() - startTime;
        const velocity = Math.abs(deltaY) / timeDiff;
        let activeState = isMainSidebar ? currentMobileSidebarUIState : (isRightSidebar ? currentMobileRightSidebarUIState : currentMobileSheetUIState);

        if (Math.abs(deltaY) < 30) {
            if (activeState === 'peek' || activeState === 'hidden') setDrawerState(elementId, 'mid');
            else if (activeState === 'mid') setDrawerState(elementId, 'full');
            else if (activeState === 'full') setDrawerState(elementId, 'peek');
            return;
        }

        if (deltaY < -30) {
            if (velocity > 0.8 || deltaY < -150) setDrawerState(elementId, 'full');
            else if (activeState === 'peek' || activeState === 'hidden') setDrawerState(elementId, 'mid');
            else setDrawerState(elementId, 'full');
        } else if (deltaY > 30) {
            let hideState = (isMainSidebar || isRightSidebar) ? 'peek' : 'hidden';
            if (velocity > 0.8 || deltaY > 150) setDrawerState(elementId, hideState);
            else if (activeState === 'full') setDrawerState(elementId, 'mid');
            else setDrawerState(elementId, hideState);
        }
    });
}

function setDrawerState(elementId, state) {
    if (elementId === 'primary-control-sidebar') currentMobileSidebarUIState = state;
    else if (elementId === 'secondary-control-sidebar') currentMobileRightSidebarUIState = state;
    else currentMobileSheetUIState = state;

    const drawer = document.getElementById(elementId);
    if (!drawer) return;

    drawer.className = drawer.className.replace(/\b(drawer|sheet)-(hidden|peek|mid|full)\b/g, '').trim();
    const prefix = (elementId === 'global-detail-sheet') ? 'sheet' : 'drawer';
    drawer.classList.add(`${prefix}-${state}`);
}

function setMobileSidebarState(stateStr) { setDrawerState('primary-control-sidebar', stateStr); }
function setMobileRightSidebarState(stateStr) { setDrawerState('secondary-control-sidebar', stateStr); }
function setMobileSheetUIState(stateStr) { setDrawerState('global-detail-sheet', stateStr); }

window.toggleDesktopSidebar = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const sidebar = document.getElementById('primary-control-sidebar');
    if (sidebar) sidebar.classList.toggle('desktop-collapsed');
};

window.toggleRightSidebar = function(event) {
    if (event && event.type !== 'boolean') { event.stopPropagation(); event.preventDefault(); }
    const sidebar = document.getElementById('secondary-control-sidebar');
    if (sidebar) {
        if (event === true) sidebar.classList.remove('desktop-collapsed-right');
        else if (event === false) sidebar.classList.add('desktop-collapsed-right');
        else sidebar.classList.toggle('desktop-collapsed-right');
    }
};

window.setGlobalFuelSelectionType = function(type) {
    const hiddenFuelInput = document.getElementById('fuel-type');
    if (hiddenFuelInput) hiddenFuelInput.value = type;
    updateUIForMode(type === 'electric');
    
    if (typeof executeStationDataFilteringPipeline === 'function') {
        executeStationDataFilteringPipeline();
    }
    const telemetryCostLabel = document.getElementById('telemetry-cost-label');
    if (telemetryCostLabel) {
        telemetryCostLabel.innerText = type === 'electric' ? 'Cost' : 'Price';
    }
};

window.updateUIForMode = function(isEV) {
    const capLabel = document.getElementById('label-capacity');
    const capSelect = document.getElementById('refuel-tank-size');
    const currLabel = document.getElementById('label-current-fuel');
    const mpgLabel = document.getElementById('mpg-label');

    if (isEV) {
        if (capLabel) capLabel.innerText = 'Battery Capacity';
        if (currLabel) currLabel.innerText = 'State of Charge (SoC)';
        if (mpgLabel) mpgLabel.innerText = 'Efficiency (mi/kWh)';
        if (capSelect) {
            capSelect.innerHTML = `<option value="40">40 kWh</option><option value="60" selected>60 kWh</option><option value="80">80 kWh</option><option value="100">100+ kWh</option>`;
        }
    } else {
        if (capLabel) capLabel.innerText = 'Tank Capacity';
        if (currLabel) currLabel.innerText = 'Current Level';
        if (mpgLabel) mpgLabel.innerText = 'Efficiency (MPG)';
        if (capSelect) {
            capSelect.innerHTML = `<option value="45">45 L</option><option value="55" selected>55 L</option><option value="70">70 L</option>`;
        }
    }
    if (typeof calculateOptimalRefuelStrategy === 'function') {
        calculateOptimalRefuelStrategy();
    }
};

function updateSavedItemsCountUI() {
    const badge = document.getElementById('saved-items-count-badge');
    if (badge) badge.textContent = starredStations.length + savedRoutes.length;
}

window.focusAndHighlightMapMarker = function(lat, lon) {
    if (isNaN(lat) || isNaN(lon)) return;
    map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
    
    const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) ||
                            rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
    
    if (selectedStation) {
        setTimeout(() => { 
            if (typeof openForecourtDetailSheet === 'function') openForecourtDetailSheet(selectedStation); 
        }, 300);
    }
};

// --- Wire UI Interaction Engine State Components
document.addEventListener('DOMContentLoaded', () => {
    updateSavedItemsCountUI();
    try {
        if (document.getElementById('sidebar-drag-handle')) bindMobileSwipeDrawer('sidebar-drag-handle', 'primary-control-sidebar');
        if (document.getElementById('right-sidebar-drag-handle')) bindMobileSwipeDrawer('right-sidebar-drag-handle', 'secondary-control-sidebar');
        if (document.getElementById('detail-sheet-drag-handle')) bindMobileSwipeDrawer('detail-sheet-drag-handle', 'global-detail-sheet');
    } catch (err) {
        console.warn('UI Swipe Drawer initialization skipped.', err);
    }

    const radiusSlider = document.getElementById('radius-slider');
    if (radiusSlider) {
        radiusSlider.addEventListener('input', (e) => {
            document.getElementById('radius-val').textContent = `${e.target.value} Miles`;
            if (typeof executeStationDataFilteringPipeline === 'function') {
                executeStationDataFilteringPipeline();
            } else if (typeof filterFuelStationsLocalMode === 'function') {
                filterFuelStationsLocalMode();
            }
        });
    }

    const detourSlider = document.getElementById('route-radius-slider');
    if (detourSlider) {
        detourSlider.addEventListener('input', (e) => {
            document.getElementById('route-radius-val').textContent = `${e.target.value} Mi`;
            if (typeof executeStationDataFilteringPipeline === 'function') {
                executeStationDataFilteringPipeline();
            }
        });
    }

    if (window.innerWidth < 1024) {
        setActiveMobileSheet('search');
    }

    const detailSheet = document.getElementById('global-detail-sheet');
    if (detailSheet) {
        detailSheet.classList.add('hidden');
        setMobileSheetUIState('hidden');
    }
});

// --- Dynamic View Redraw Functions from `app-2.js` Hooks
window.executeStationDataFilteringPipeline = function() {
   if (typeof filterFuelStationsLocalMode === 'function') {
        filterFuelStationsLocalMode();
   }
};

window.paintMarkerCanvasLayersToMap = function(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
    if(!markerClusterGroupInstance) return;
    markerClusterGroupInstance.clearLayers();
    const isEV = variant === 'electric';

    const pricesArray = stationsList.map(s => {
        let p = parseFloat(s[variant]);
        if (isEV && (!p || isNaN(p))) p = parseFloat(s.electric_price || s.charge_rate || s.electric);
        return p;
    }).filter(p => !isNaN(p) && p > 0);

    const minPrice = Math.min(...pricesArray) || 0;
    
    let gT = 0, bT = 0;
    if (isEV) { 
        gT = 55; bT = 75; 
    } else if (pricesArray.length > 0) {
        pricesArray.sort((a, b) => a - b);
        gT = pricesArray[Math.floor(pricesArray.length * 0.333)];
        bT = pricesArray[Math.floor(pricesArray.length * 0.666)];
    }

    stationsList.forEach((station) => {
        let numericPrice = parseFloat(station[variant]);
        if (isEV && (!numericPrice || isNaN(numericPrice))) {
            numericPrice = parseFloat(station.electric_price || station.charge_rate || station.electric);
        }
        
        if (!numericPrice || isNaN(numericPrice)) return;
        
        let tierBgClassColor = 'bg-fuel-blue';
        if (numericPrice <= gT) tierBgClassColor = 'bg-fuel-green';
        else if (numericPrice <= bT) tierBgClassColor = 'bg-fuel-blue';
        else tierBgClassColor = 'bg-fuel-red';
        
        const markerBubbleHtml = `
            <div class="leaflet-div-icon-reset relative">
                <div class="fuel-marker-bubble ${tierBgClassColor} transform transition-all duration-200 hover:scale-125 shadow-lg flex items-center justify-center text-white font-black text-[10px] rounded-full px-2 py-0.5 whitespace-nowrap">
                    ${isEV?'⚡':''}${numericPrice.toFixed(1)}${isEV?'kW':'p'}
                </div>
            </div>
        `;
        
        const markerInstance = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
            stationRawData: station,
            icon: L.divIcon({ html: markerBubbleHtml, className: 'leaflet-div-icon-reset', iconSize: [50, 32], iconAnchor: [25, 16] })
        });
        
        markerInstance.on('click', (e) => { 
            L.DomEvent.stopPropagation(e); 
            if(typeof openForecourtDetailSheet === 'function') openForecourtDetailSheet(station); 
        });
        
        markerClusterGroupInstance.addLayer(markerInstance);
    });
};

window.assignPricingTierColorStyles = function(valueRaw, variantKey) {
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
};

window.openForecourtDetailSheet = function(station) {
    if (!station) return;
    if (typeof station === 'string' || typeof station === 'number') {
        const found = rawGlobalStationsPool.find(s => getStationId(s) === String(station));
        if (found) station = found; else return;
    }
    const sheet = document.getElementById('global-detail-sheet');
    if (!sheet) return;
    const sp = document.getElementById('starred-dropdown-panel');
    if (sp) sp.classList.add('hidden');
    
    activeSheetStation = station;
    const titleEl = document.getElementById('sheet-station-name');
    const brandEl = document.getElementById('sheet-station-brand');
    
    if (titleEl) titleEl.textContent = (station.brand_name || station.name || 'Independent Hub').replace(/['"]/g, '');
    if (brandEl) brandEl.textContent = (station.address || 'Information Available').replace(/['"]/g, '');
    
    const isEVPipe = station.isEV || document.getElementById('fuel-type-select')?.value === 'electric';
    
    if (isEVPipe) {
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { 
            const el = document.getElementById(id); if(el) el.style.display = 'none'; 
        });
        
        let evCard = document.getElementById('card-wrap-ev');
        if (!evCard) { 
            evCard = document.createElement('div'); 
            evCard.id = 'card-wrap-ev'; 
            document.getElementById('sheet-prices-grid')?.appendChild(evCard);
        }
        
        let pRate = parseFloat(station.electric_price || station.charge_rate || station.electric || 50);
        if(evCard) {
            evCard.style.display = 'block';
            evCard.className = `border p-3 rounded-xl text-center transition-all duration-200 col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-sm`;
            evCard.innerHTML = `<span class="text-[10px] font-black uppercase tracking-wider block opacity-75">⚡ Rapid Charging Rate</span><span class="text-xl font-black block mt-1 tabular-nums">${pRate.toFixed(1)} <span class="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70">kW</span></span>`;
        }
        if (titleEl) titleEl.textContent = `⚡ ${(station.brand_name || station.name || 'EV Charger').replace(/['"]/g, '')}`;
    } else {
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { 
            const el = document.getElementById(id); if(el) el.style.display = 'block'; 
        });
        const evCard = document.getElementById('card-wrap-ev'); 
        if (evCard) evCard.style.display = 'none';
        
        const ce10 = document.getElementById('card-wrap-e10');
        if(ce10) ce10.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E10, 'E10')}`;
        const ce5 = document.getElementById('card-wrap-e5');
        if(ce5) ce5.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E5, 'E5')}`;
        const cb7 = document.getElementById('card-wrap-b7');
        if(cb7) cb7.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.B7, 'B7')}`;
        const cpd = document.getElementById('card-wrap-premiumdiesel');
        if(cpd) cpd.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.PremiumDiesel, 'PremiumDiesel')}`;
        
        const se10 = document.getElementById('sheet-price-e10');
        if(se10) se10.textContent = station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A';
        const se5 = document.getElementById('sheet-price-e5'); 
        if(se5) se5.textContent = station.E5 ? `${parseFloat(station.E5).toFixed(1)}p` : 'N/A';
        const sb7 = document.getElementById('sheet-price-b7'); 
        if(sb7) sb7.textContent = station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A';
        const spd = document.getElementById('sheet-price-premiumdiesel'); 
        if(spd) spd.textContent = station.PremiumDiesel ? `${parseFloat(station.PremiumDiesel).toFixed(1)}p` : 'N/A';
    }
    
    updateAllStarUIStates();
    sheet.classList.remove('hidden');
    if (window.innerWidth < 1024) { setMobileSheetUIState('full'); }
    else { sheet.classList.remove('drawer-hidden', 'drawer-peek', 'drawer-mid', 'drawer-full'); }
};
