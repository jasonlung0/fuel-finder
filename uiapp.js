// --- GLOBAL CONFIGURATION CREDENTIALS ---
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6';
const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e';
const OPENWEATHER_API_KEY = '5e67010087dac92dd2eb31bc4c0a2abf'; 

// --- UNIVERSAL ID HELPER ---
function getStationId(station) {
    if (!station) return null;
    if (station.id) return String(station.id);
    if (station.site_id) return String(station.site_id);
    if (station.uuid) return String(station.uuid);
    return `${station.latitude || station.lat},${station.longitude || station.lng}`;
}

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
        },
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

// --- OpenWeatherMap Integration ---
const weatherCacheMap = new Map();

async function fetchWeatherForStation(lat, lng) {
    const cacheKey = `${parseFloat(lat).toFixed(1)},${parseFloat(lng).toFixed(1)}`;
    if (weatherCacheMap.has(cacheKey)) {
        return weatherCacheMap.get(cacheKey);
    }

    const fallbackEmojis = ['☀️', '☁️', '🌧️', '🌤️'];
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

// --- CORE TOAST NOTIFICATION SYSTEM ---
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
            success: `✅`, error: `❌`, warning: `⚠️`, info: `ℹ️`
        };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<div class="relative z-10 flex items-center justify-center">${icons[type]}</div><p class="relative z-10 m-0 leading-tight tracking-tight text-xs">${message}</p>`;
        this.container.appendChild(toast);
        requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('show'); }); });
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3500);
    }
};

// --- CORE STATE MANAGERS & MISSING UI BINDINGS ---
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

window.closeForecourtDetailSheet = function(event) {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const sheet = document.getElementById('global-detail-sheet');
    if (sheet) {
        sheet.classList.add('hidden');
        if (window.innerWidth < 1024) setMobileSheetUIState('hidden');
    }
    activeSheetStation = null;
};

window.updateAllStarUIStates = function() {
    const btn = document.getElementById('sheet-star-btn');
    if (!btn || !activeSheetStation) return;
    
    const targetId = getStationId(activeSheetStation);
    const isStarred = starredStations.some(s => getStationId(s) === targetId);
    
    if (isStarred) {
        btn.innerHTML = '⭐';
        btn.classList.add('text-amber-500', 'border-amber-500/50', 'bg-amber-50', 'dark:bg-amber-500/10');
        btn.classList.remove('text-zinc-400', 'border-zinc-200/80', 'dark:border-zinc-800/80');
    } else {
        btn.innerHTML = '☆';
        btn.classList.remove('text-amber-500', 'border-amber-500/50', 'bg-amber-50', 'dark:bg-amber-500/10');
        btn.classList.add('text-zinc-400', 'border-zinc-200/80', 'dark:border-zinc-800/80');
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

            el.onclick = () => { focusAndHighlightMapMarker(lat, lon); document.getElementById('starred-dropdown-panel').classList.add('hidden'); };
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
                <div class="text-[9px] text-zinc-500 truncate flex items-center gap-1">📍 ${route.start.split(',')[0]} ➔ ${route.end.split(',')[0]}</div>
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
        const station = rawGlobalStationsPool.find(s => getStationId(s) === String(stationId)) 
                     || currentlyVisibleStations.find(s => getStationId(s) === String(stationId));
                     
        if (station) {
            if (!station.id) station.id = stationId; 
            starredStations.push(station);
            Toast.show("Station saved to your shortcuts successfully!", "success");
        }
    }
    
    localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
    
    if (activeSheetStation && getStationId(activeSheetStation) === String(stationId)) {
        updateAllStarUIStates();
    }
    updateSavedItemsCountUI();
    const dp = document.getElementById('starred-dropdown-panel');
    if (dp && !dp.classList.contains('hidden')) renderStarredDropdownList();
};

window.fetchEVStationsInBounds = async function(southWest, northEast) {
    try {
        const url = `https://api.openchargemap.io/v3/poi/?key=${OCM_KEY}&output=json&swlat=${southWest.lat}&swlng=${southWest.lng}&nelat=${northEast.lat}&nelng=${northEast.lng}&maxresults=500&compact=true&verbose=false`;
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

document.getElementById('refuel-tank-size')?.addEventListener('change', () => { if(typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); });
document.getElementById('refuel-current-level')?.addEventListener('change', () => { if(typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); });
document.getElementById('refuel-safety-buffer')?.addEventListener('change', () => { if(typeof calculateOptimalRefuelStrategy === 'function') calculateOptimalRefuelStrategy(); });

const fuelTypeSelectListener = document.getElementById('fuel-type-select');
if(fuelTypeSelectListener) {
    fuelTypeSelectListener.addEventListener('change', () => {
        if(activeTabContext === 'route') {
            const startInput = document.getElementById('route-start');
            const endInput = document.getElementById('route-end');
            if (startInput && endInput && startInput.value.trim() !== '' && endInput.value.trim() !== '') {
                executeRouteGenerationPipeline();
            }
        }
    });
}

// --- MOBILE UX SWITCHER LOGIC ---
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
            rightSidebar.classList.add('hidden'); 
            rightSidebar.classList.add('desktop-collapsed-right');
        }
        if (leftSidebar) {
            leftSidebar.classList.remove('hidden'); 
            leftSidebar.classList.add('mobile-active-sheet');
            leftSidebar.style.zIndex = "2000";
            leftSidebar.classList.remove('desktop-collapsed');
        }
        if(btnSearch) btnSearch.className = "h-full text-[11px] font-black tracking-wide px-4 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 transition-all shadow-sm focus:outline-none";
        if(btnTelemetry) btnTelemetry.className = "h-full text-[11px] font-bold tracking-wide px-4 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all focus:outline-none";
        
        if (btnViewStationsDesktop) btnViewStationsDesktop.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/40 dark:border-zinc-700/30 transition-all duration-200 focus:outline-none";
        if (btnViewTelemetryDesktop) btnViewTelemetryDesktop.className = "flex-1 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 focus:outline-none";

        setMobileSidebarState('mid');
    } else if (targetType === 'telemetry') {
        if (leftSidebar) {
            leftSidebar.classList.remove('mobile-active-sheet');
            leftSidebar.classList.add('hidden'); 
            leftSidebar.classList.add('desktop-collapsed');
        }
        if (rightSidebar) {
            rightSidebar.classList.remove('hidden');
            rightSidebar.classList.add('mobile-active-sheet');
            rightSidebar.style.zIndex = "2000";
            rightSidebar.classList.remove('desktop-collapsed-right');
        }
        if(btnTelemetry) btnTelemetry.className = "h-full text-[11px] font-black tracking-wide px-4 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 transition-all shadow-sm focus:outline-none";
        if(btnSearch) btnSearch.className = "h-full text-[11px] font-bold tracking-wide px-4 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all focus:outline-none";
        
        if (btnViewTelemetryDesktop) btnViewTelemetryDesktop.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/40 dark:border-zinc-700/30 transition-all duration-200 focus:outline-none";
        if (btnViewStationsDesktop) btnViewStationsDesktop.className = "flex-1 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 focus:outline-none";

        setMobileRightSidebarState('mid');
    }
};

// --- 3-STATE MOBILE SWIPE MECHANICS ---
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
        const activeState = isMainSidebar ? currentMobileSidebarUIState : (isRightSidebar ? currentMobileRightSidebarUIState : currentMobileSheetUIState);
        
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
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const sidebar = document.getElementById('primary-control-sidebar');
    if (sidebar) sidebar.classList.toggle('desktop-collapsed');
};

window.toggleRightSidebar = function(event) {
    if(event && event.type !== 'boolean') { event.stopPropagation(); event.preventDefault(); }
    const sidebar = document.getElementById('secondary-control-sidebar');
    if (sidebar) {
        if (event === true) sidebar.classList.remove('desktop-collapsed-right');
        else if (event === false) sidebar.classList.add('desktop-collapsed-right');
        else sidebar.classList.toggle('desktop-collapsed-right');
    }
};

window.setGlobalFuelSelectionType = function(type) {
    const hiddenFuelInput = document.getElementById('fuel-type');
    if(hiddenFuelInput) hiddenFuelInput.value = type;
    
    updateUIForMode(type === 'electric');
    executeStationDataFilteringPipeline();
    
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

document.addEventListener('DOMContentLoaded', () => {
    initMap(); 
    updateSavedItemsCountUI();
    
    try {
        if (document.getElementById('sidebar-drag-handle')) bindMobileSwipeDrawer('sidebar-drag-handle', 'primary-control-sidebar');
        if (document.getElementById('right-sidebar-drag-handle')) bindMobileSwipeDrawer('right-sidebar-drag-handle', 'secondary-control-sidebar');
        if (document.getElementById('detail-sheet-drag-handle')) bindMobileSwipeDrawer('detail-sheet-drag-handle', 'global-detail-sheet');
    } catch (err) { console.warn('UI Initialization skipped.', err); }

    const radiusSlider = document.getElementById('radius-slider');
    if (radiusSlider) {
        radiusSlider.addEventListener('input', (e) => {
            document.getElementById('radius-val').textContent = `${e.target.value} Miles`;
            executeStationDataFilteringPipeline();
        });
    }

    const detourSlider = document.getElementById('route-radius-slider');
    if (detourSlider) {
        detourSlider.addEventListener('input', (e) => {
            document.getElementById('route-radius-val').textContent = `${e.target.value} Mi`;
            executeStationDataFilteringPipeline();
        });
    }

    setupAutocompleteListeners();
    initializeClickIsolationBubbling();

    if (window.innerWidth < 1024) {
        setActiveMobileSheet('search');
    }

    const detailSheet = document.getElementById('global-detail-sheet');
    if (detailSheet) {
        detailSheet.classList.add('hidden');
        setMobileSheetUIState('hidden');
    }
});

function updateSavedItemsCountUI() {
    const badge = document.getElementById('saved-items-count-badge');
    if (badge) badge.textContent = starredStations.length + savedRoutes.length;
}

window.focusAndHighlightMapMarker = function(lat, lon) {
    if (isNaN(lat) || isNaN(lon)) return;
    map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
    const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) || rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
    if (selectedStation) setTimeout(() => { openForecourtDetailSheet(selectedStation); }, 300);
};

window.focusIncidentMapView = function(lat, lng) {
    if (!map) return;
    let targetedLat = parseFloat(lat);
    let targetedLng = parseFloat(lng);
    
    if (Math.abs(targetedLat) < Math.abs(targetedLng) && targetedLng > 49 && targetedLng < 61) {
        const temp = targetedLat; targetedLat = targetedLng; targetedLng = temp;
    }
    if (isNaN(targetedLat) || isNaN(targetedLng)) return;

    map.flyTo([targetedLat, targetedLng], 16, { animate: true, duration: 1.5 });
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
        bodyNode.classList.remove('light'); bodyNode.classList.add('dark'); document.documentElement.classList.add('dark');
    } else {
        bodyNode.classList.remove('dark'); bodyNode.classList.add('light'); document.documentElement.classList.remove('dark');
    }
    if (map && tileLayerInstance) {
        map.removeLayer(tileLayerInstance);
        const targetedTilesetURI = isDarkMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
        tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
    }
    if (typeof executeStationDataFilteringPipeline === 'function') executeStationDataFilteringPipeline();
    updateSavedItemsCountUI();
    updateAllStarUIStates();
}

function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(mapSearchAnchorCoordinates, 11);
    const targetedTilesetURI = isDarkMode ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    tileLayerInstance = L.tileLayer(targetedTilesetURI, { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    
    initializeClusterLayerPipeline();
    
    map.on('click', function(e) {
        map.closePopup(); 
        if (typeof closeForecourtDetailSheet === 'function') closeForecourtDetailSheet(); 
    });
    
    const scanBtn = document.getElementById('btn-scan-bounds');
    if (scanBtn) {
        scanBtn.classList.add('hidden');
    }

    originalMapCenter = map.getCenter();
    
    map.on('moveend', () => {
        if (!originalMapCenter || !scanBtn) return;
        if (activeTabContext === 'route') return;
        
        const dist = map.getCenter().distanceTo(originalMapCenter); 
        if (dist > 500) {
            scanBtn.classList.remove('hidden');
        }
    });
    
    triggerActiveDeviceLocationLookup();
    forceReloadRemotePipelineData();
}

window.executeContextualAreaScanPipeline = function(event) {
    if (event) event.stopPropagation();
    const btn = document.getElementById('btn-scan-bounds');
    if (btn) btn.classList.add('hidden');

    const newCenter = map.getCenter();
    mapSearchAnchorCoordinates = [newCenter.lat, newCenter.lng];
    originalMapCenter = newCenter;

    executeStationDataFilteringPipeline();
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
    if(inputField) inputField.value = "Detecting location...";

    navigator.geolocation.getCurrentPosition(async (position) => {
        const userLat = position.coords.latitude;
        const userLng = position.coords.longitude;
        mapSearchAnchorCoordinates = [userLat, userLng];
        map.setView(mapSearchAnchorCoordinates, 13);
        originalMapCenter = L.latLng(userLat, userLng);

        try {
            const lookupRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&zoom=14`);
            const lookupData = await lookupRes.json();
            if(inputField && lookupData && lookupData.display_name) inputField.value = lookupData.address.city || lookupData.address.town || lookupData.address.suburb || "My Coordinates";
            else if(inputField) inputField.value = `${userLat.toFixed(4)}, ${userLng.toFixed(4)}`;
        } catch { if(inputField) inputField.value = "Current Location"; }
        executeStationDataFilteringPipeline();
    }, () => {
        if(inputField) inputField.value = "Access Denied";
    }, { enableHighAccuracy: true, timeout: 8000 });
};

function initializeClusterLayerPipeline() {
    if(markerClusterGroupInstance && map) { map.removeLayer(markerClusterGroupInstance); }
    markerClusterGroupInstance = L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
        iconCreateFunction: function (cluster) {
            const dynamicChildMarkers = cluster.getAllChildMarkers();
            const activeFuelKey = document.getElementById('fuel-type-select')?.value || 'E10';
            const isEV = activeFuelKey === 'electric';
            
            let pricesExtracted = [];
            dynamicChildMarkers.forEach(marker => {
                if(marker.options?.stationRawData) {
                    let val = parseFloat(marker.options.stationRawData[activeFuelKey]);
                    if (isEV && (!val || isNaN(val))) val = parseFloat(marker.options.stationRawData.electric_price || marker.options.stationRawData.charge_rate || marker.options.stationRawData.electric);
                    if(!isNaN(val) && val > 0) pricesExtracted.push(val);
                }
            });

            if(pricesExtracted.length === 0) return L.divIcon({ html: `<div class="fuel-cluster-capsule tabular-nums"><span>Cluster</span></div>`, className: 'leaflet-div-icon-reset', iconSize: [95, 32] });

            const min = Math.min(...pricesExtracted);
            const max = Math.max(...pricesExtracted);
            const labelString = (min === max) ? `${isEV?'⚡':''}${min.toFixed(1)}${isEV?'kW':'p'}` : `${isEV?'⚡':''}${min.toFixed(1)}${isEV?'':'p'} - ${max.toFixed(1)}${isEV?'kW':'p'}`;
            return L.divIcon({ html: `<div class="fuel-cluster-capsule tabular-nums"><span>${labelString}</span></div>`, className: 'leaflet-div-icon-reset', iconSize: [115, 32], iconAnchor: [57, 16] });
        }
    });
    map.addLayer(markerClusterGroupInstance);
}

window.switchWorkflowTabContext = function(contextType) {
    activeTabContext = contextType;
    const btnLocal = document.getElementById('tab-btn-local');
    const btnRoute = document.getElementById('tab-btn-route');
    const panelLocal = document.getElementById('panel-tab-local');
    const panelRoute = document.getElementById('panel-tab-route');

    if (contextType === 'local') {
        if(btnLocal) btnLocal.className = "py-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm focus:outline-none";
        if(btnRoute) btnRoute.className = "py-2.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white focus:outline-none";
        if(panelLocal) panelLocal.classList.remove('hidden');
        if(panelRoute) panelRoute.classList.add('hidden');
        clearRoute();
    } else {
        if(btnRoute) btnRoute.className = "py-2.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center justify-center gap-1 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm focus:outline-none";
        if(btnLocal) btnLocal.className = "py-2.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white focus:outline-none";
        if(panelRoute) panelRoute.classList.remove('hidden');
        if(panelLocal) panelLocal.classList.add('hidden');
        
        const scanBtn = document.getElementById('btn-scan-bounds');
        if (scanBtn) {
            scanBtn.classList.add('hidden');
        }
    }
    executeStationDataFilteringPipeline();
};

window.switchDirectoryTabContext = function(dirType) {
    activeDirectoryTab = dirType;
    const tabStations = document.getElementById('dir-tab-stations');
    const tabRoutes = document.getElementById('dir-tab-routes');
    
    if (dirType === 'stations') {
        if(tabStations) tabStations.className = "flex-1 py-1.5 rounded-md text-[10px] font-black bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm focus:outline-none";
        if(tabRoutes) tabRoutes.className = "flex-1 py-1.5 rounded-md text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none transition";
    } else {
        if(tabRoutes) tabRoutes.className = "flex-1 py-1.5 rounded-md text-[10px] font-black bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm focus:outline-none";
        if(tabStations) tabStations.className = "flex-1 py-1.5 rounded-md text-[10px] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none transition";
    }
    renderStarredDropdownList();
};

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
    rowNode.className = "relative flex items-center w-full gap-3 mt-1 animate-fadeIn";
    rowNode.innerHTML = `
        <div class="w-6 flex justify-center z-10 shrink-0"><div class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm outline outline-2 outline-white dark:outline-zinc-950"></div></div>
        <div class="relative flex-1">
            <input id="route-via-${currentUid}" type="text" value="${initialValue}" placeholder="Midway stop point..." class="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-2.5 pr-14 py-2 text-xs text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent waypoint-dynamic-input-field shadow-sm" />
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
    if (rowTarget) rowTarget.remove();
};

window.clearSingleWaypointRowInputValue = function(uid, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    const inputField = document.getElementById(`route-via-${uid}`);
    if (inputField) inputField.value = '';
};

function bindAutocompleteToSpecificInput(inputId, suggestionsBoxId) {
    const inputField = document.getElementById(inputId);
    const matchingBox = document.getElementById(suggestionsBoxId);
    if (!inputField || !matchingBox) return;

    inputField.addEventListener('input', (e) => {
        const textQuery = e.target.value.trim();
        clearTimeout(autocompleteDebounceTimer);
        if (!textQuery || textQuery.length < 2) { matchingBox.classList.add('hidden'); return; }

        autocompleteDebounceTimer = setTimeout(async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(textQuery)}&countrycodes=gb&limit=4`;
                const res = await fetch(url, { headers: { 'User-Agent': 'UKFuelPriceWorkspace/2.0' } });
                const optionsList = await res.json();
                if (!optionsList || optionsList.length === 0) { matchingBox.classList.add('hidden'); return; }

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
            if (window.innerWidth < 1024) setMobileSidebarState('peek');
        }
    } catch (err) { console.error(err); }
};

function generateTrafficBoundingBoxes(coords, maxArea = 8500) {
    if (!coords || coords.length === 0) return [];
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const pt of coords) {
        if (pt[0] < minLat) minLat = pt[0];
        if (pt[0] > maxLat) maxLat = pt[0];
        if (pt[1] < minLon) minLon = pt[1];
        if (pt[1] > maxLon) maxLon = pt[1];
    }
    minLat -= 0.01; maxLat += 0.01; minLon -= 0.01; maxLon += 0.01;
    const R = 6371;
    const dLat = (maxLat - minLat) * (Math.PI / 180);
    const dLon = (maxLon - minLon) * (Math.PI / 180);
    const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const area = (R * Math.abs(dLon) * Math.cos(meanLat)) * (R * Math.abs(dLat));
    if (area <= maxArea) return [[minLon, minLat, maxLon, maxLat]];
    const mid = Math.floor(coords.length / 2);
    return [...generateTrafficBoundingBoxes(coords.slice(0, mid + 1), maxArea), ...generateTrafficBoundingBoxes(coords.slice(mid), maxArea)];
}

async function fetchTrafficChunk(bbox) {
    try {
        const bboxString = `${Number(bbox[0]).toFixed(6)},${Number(bbox[1]).toFixed(6)},${Number(bbox[2]).toFixed(6)},${Number(bbox[3]).toFixed(6)}`;
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
        const results = await Promise.all(bboxes.map(bbox => fetchTrafficChunk(bbox)));
        const allIncidents = results.flat();
        const uniqueIncidents = [];
        const seenIds = new Set();
        for (const incident of allIncidents) {
            if (incident && incident.properties && incident.properties.id && !seenIds.has(incident.properties.id)) {
                seenIds.add(incident.properties.id);
                uniqueIncidents.push(incident);
            }
        }
        return uniqueIncidents;
    } catch (e) { return null; }
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
    const alertsViewport = document.getElementById('route-alerts-container');
    const ticker = document.getElementById('dash-metric-delay-ticker');
    const fuelType = document.getElementById('fuel-type-select')?.value || 'E10';
    const isEV = fuelType === 'electric';

    if (!incidents || incidents.length === 0) {
        if(ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 truncate tracking-tight">✅ Fluid traffic flow detected along active corridor.</div>`;
        if (alertsViewport) alertsViewport.classList.add('hidden');
        const badge = document.getElementById('traffic-status-badge');
        if (badge) { badge.textContent = "CLEAR"; badge.className = "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 border-emerald-500/20"; }
        return;
    }

    let processed = incidents.filter(i => {
        const severity = i.properties?.magnitudeOfDelay || 0;
        const delay = i.properties?.delay || 0;
        
        if (severity < 3 && delay < 300) return false;
        
        if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) return true;
        let coords = i.geometry?.coordinates;
        if (!coords) return false;
        
        let checkPoint = i.geometry.type === 'Point' ? coords : coords[0];
        return plottedRouteCoordinates.some(rc => computeDistanceVectorMiles(rc[0], rc[1], checkPoint[1], checkPoint[0]) <= 2.0);
    });

    if (processed.length === 0) {
        if (ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-emerald-500 truncate">✅ Route corridor is free-flowing.</div>`;
        if (alertsViewport) alertsViewport.classList.add('hidden');
        const badge = document.getElementById('traffic-status-badge');
        if (badge) { badge.textContent = "CLEAR"; badge.className = "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 border-emerald-500/20"; }
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

    if(ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center justify-between px-2 text-[10px] font-bold text-amber-600 dark:text-amber-400 truncate tracking-tight"><span>⚠️ ${processed.length} incidents mapping ahead (+${delayMins}m)</span><span class="text-zinc-500 font-medium border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-2">${wasteStr}</span></div>`;

    const badge = document.getElementById('traffic-status-badge');
    if (badge) {
        badge.textContent = processed.length >= 3 ? "CONGESTED" : "ALERTS";
        badge.className = processed.length >= 3 
            ? "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-rose-500/10 text-rose-600 border-rose-500/20"
            : "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-amber-500/10 text-amber-700 border-amber-500/20";
    }

    if (alertsViewport) {
        alertsViewport.classList.remove('hidden');
        alertsViewport.innerHTML = processed.map(inc => {
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
                    <p class="text-[9px] font-medium text-zinc-500 truncate">${formatIncidentLocation(p.from, p.to)}</p>
                </div>
            `;
        }).join('');
    }
};

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
        
        cachedGeocodedWaypoints.start = { name: startInput, lat: parseFloat(startNodes[0].lat), lon: parseFloat(startNodes[0].lon) };
        cachedGeocodedWaypoints.end = { name: endInput, lat: parseFloat(endNodes[0].lat), lon: parseFloat(endNodes[0].lon) };
        
        let coordinatesPayloadString = `${startNodes[0].lat},${startNodes[0].lon}`;
        if (waypointStrings.length > 0) {
            const waypointPromises = waypointStrings.map(async (wpStr, wIndex) => {
                try {
                    const viaRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(wpStr)}&countrycodes=gb&limit=1`);
                    const viaNodes = await viaRes.json();
                    if (viaNodes.length) return { wIndex, name: wpStr, lat: viaNodes[0].lat, lon: viaNodes[0].lon };
                } catch (e) {} return null;
            });
            const resolvedWaypoints = await Promise.all(waypointPromises);
            resolvedWaypoints.forEach(wp => {
                if (wp) { coordinatesPayloadString += `:${wp.lat},${wp.lon}`; cachedGeocodedWaypoints.vids[`wp_${wp.wIndex}`] = { name: wp.name, lat: parseFloat(wp.lat), lon: parseFloat(wp.lon) }; }
            });
        }
        coordinatesPayloadString += `:${endNodes[0].lat},${endNodes[0].lon}`;
        
        const userMpg = parseFloat(document.getElementById('vehicle-mpg')?.value) || 45;
        const litersPer100km = (282.48 / userMpg).toFixed(2);
        const tomtomUrl = `https://api.tomtom.com/routing/1/calculateRoute/${coordinatesPayloadString}/json?key=${TOMTOM_API_KEY}&traffic=true&routeType=fastest&sectionType=traffic&vehicleEngineType=combustion&constantSpeedConsumptionInLitersPerHundredkm=50,${litersPer100km}:120,${litersPer100km}`;
        
        const routeRes = await fetch(tomtomUrl);
        if (!routeRes.ok) throw new Error(`Routing failure`);
        const routeData = await routeRes.json();
        const currentActiveRoute = routeData.routes[0];

        globalActiveRoute = currentActiveRoute;
        globalRouteDistanceMiles = (currentActiveRoute.summary.lengthInMeters / 1609.34);
        window.globalCalculatedFuelLiters = currentActiveRoute.summary.fuelConsumptionInLiters;
        
        plottedRouteCoordinates = [];
        currentActiveRoute.legs.forEach(leg => leg.points.forEach(pt => plottedRouteCoordinates.push([pt.latitude, pt.longitude])));
        
        if (routePolylineLayer) map.removeLayer(routePolylineLayer);
        routePolylineLayer = L.featureGroup().addTo(map);
        
        L.polyline(plottedRouteCoordinates, { color: '#10b981', weight: 4.5, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(routePolylineLayer);
        
        if (currentActiveRoute.sections) {
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
            
            const statusBadge = document.getElementById('traffic-status-badge');
            const tickerContainer = document.getElementById('dash-metric-delay-ticker');
            if (statusBadge) { statusBadge.textContent = "SCANNING..."; statusBadge.className = "px-1.5 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse"; }
            if(tickerContainer) tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-zinc-500 truncate tracking-tight">Scanning route chunks for live telemetry...</div>`;

            const rSidebar = document.getElementById('secondary-control-sidebar');
            if (rSidebar) {
                rSidebar.classList.remove('desktop-collapsed-right');
                if (window.innerWidth < 1024) setActiveMobileSheet('telemetry');
            }

            const stitchedIncidents = await fetchAllRouteTraffic(plottedRouteCoordinates);
            renderLiveTrafficDashboard(stitchedIncidents);
        }
        
        const travelTimeSeconds = currentActiveRoute.summary.travelTimeInSeconds || 0;
        const timeString = Math.floor(travelTimeSeconds / 3600) > 0 ? `${Math.floor(travelTimeSeconds / 3600)}h ${Math.floor((travelTimeSeconds % 3600) / 60)}m` : `${Math.floor((travelTimeSeconds % 3600) / 60)} m`;

        const activeFuelType = document.getElementById('fuel-type-select')?.value || 'E10';
        let tripCost = 0; let consumptionString = "--";
        
        if (activeFuelType === 'electric') {
            const elab = document.getElementById('energy-label'); if(elab) elab.innerText = "ENERGY";
            const evEfficiencyMpkWh = parseFloat(document.getElementById('vehicle-mpg')?.value) || 3.5;
            const expectedKwh = globalRouteDistanceMiles / evEfficiencyMpkWh;
            consumptionString = `${expectedKwh.toFixed(1)} kWh`;
            tripCost = expectedKwh * 0.75; 
        } else {
            const elab = document.getElementById('energy-label'); if(elab) elab.innerText = "FUEL";
            const expectedLitres = (globalRouteDistanceMiles / userMpg) * 4.54609;
            consumptionString = `${expectedLitres.toFixed(1)} L`;
            let validPrices = [];
            if (currentlyVisibleStations) currentlyVisibleStations.forEach(s => { const price = parseFloat(s[activeFuelType]); if (!isNaN(price) && price > 0) validPrices.push(price); });
            let averageFuelPricePence = 145.0; 
            if (validPrices.length > 0) averageFuelPricePence = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
            tripCost = expectedLitres * (averageFuelPricePence / 100);
        }

        const dMD = document.getElementById('dash-metric-distance'); if(dMD) dMD.innerText = `${globalRouteDistanceMiles.toFixed(1)} mi`;
        const timeEl = document.getElementById('dash-metric-time'); if(timeEl) timeEl.innerText = timeString;
        const litresEl = document.getElementById('dash-metric-litres'); if(litresEl) litresEl.innerText = consumptionString;
        const costEl = document.getElementById('summary-cost'); if(costEl) costEl.innerText = `£${tripCost.toFixed(2)}`;

        if (currentActiveRoute.summary) {
            const avgSpeedMph = Math.round((currentActiveRoute.summary.lengthInMeters / currentActiveRoute.summary.travelTimeInSeconds) * 2.23694);
            const speedBadge = document.getElementById('dash-header-speed-badge');
            if (speedBadge) {
                speedBadge.innerText = `${avgSpeedMph} mph`;
                const delay = currentActiveRoute.summary.trafficDelayInSeconds || 0;
                if (delay > 300) speedBadge.className = "ml-1 px-1 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/40";
                else if (delay > 60) speedBadge.className = "ml-1 px-1 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40";
                else speedBadge.className = "ml-1 px-1 py-0.5 rounded text-[8px] font-black tracking-tight border uppercase bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40";
            }
        }
        
        if (typeof executeStationDataFilteringPipeline === 'function') {
            await executeStationDataFilteringPipeline();
        }
        
        if (typeof calculateOptimalRefuelStrategy === 'function') {
            calculateOptimalRefuelStrategy();
        }
        
        if (window.innerWidth >= 1024) {
            const sidebar = document.getElementById('primary-control-sidebar');
            if (sidebar && !sidebar.classList.contains('desktop-collapsed')) sidebar.classList.add('desktop-collapsed');
        }
    } catch (err) { Toast.show(`Failed to trace route: ${err.message}`, "error"); }
};

window.saveActiveRouteCorridor = function() {
    const startVal = document.getElementById('route-start')?.value.trim();
    const endVal = document.getElementById('route-end')?.value.trim();
    const currentMpg = document.getElementById('vehicle-mpg')?.value;
    const currentDev = document.getElementById('route-radius-slider')?.value;
    if (!startVal || !endVal) return;

    const waypointNodes = Array.from(document.querySelectorAll('.waypoint-dynamic-input-field')).map(input => input.value.trim()).filter(val => val.length > 0);
    savedRoutes.push({ id: 'route_' + Date.now(), name: `${startVal.split(',')[0]} ➔ ${endVal.split(',')[0]}`, start: startVal, waypoints: waypointNodes, end: endVal, mpg: currentMpg, radius: currentDev });
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    
    updateSavedItemsCountUI();
    const dp = document.getElementById('starred-dropdown-panel');
    if (dp && !dp.classList.contains('hidden')) renderStarredDropdownList();
    Toast.show("Corridor routing successfully saved.", "success");
};

window.deleteSavedRouteCorridor = function(routeId, event) {
    if(event) { event.stopPropagation(); event.preventDefault(); }
    savedRoutes = savedRoutes.filter(r => r.id !== routeId);
    localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
    updateSavedItemsCountUI();
    renderStarredDropdownList();
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
        if(matchedRoute.waypoints && matchedRoute.waypoints.length > 0) matchedRoute.waypoints.forEach(wpStr => addWaypointFieldInputRow(wpStr));
        else addWaypointFieldInputRow();
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
    globalRouteDistanceMiles = 0;
    
    ['route-start', 'route-end', 'location-input'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    const container = document.getElementById('dynamic-waypoints-container');
    if (container) { container.innerHTML = ''; addWaypointFieldInputRow(); }

    const rSidebar = document.getElementById('secondary-control-sidebar');
    if (rSidebar) rSidebar.classList.add('desktop-collapsed-right');
    const crb = document.getElementById('cheapest-ranking-block');
    if (crb) crb.classList.add('hidden');

    clearFuelOptimizationState();
    executeStationDataFilteringPipeline();
};

function computeDistanceVectorMiles(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * 69.1;
    const dLon = (lon2 - lon1) * 41.0; 
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

function computeMinimumDistanceToRouteCorridor(pointLat, pointLon) {
    let minimumTrackSeparationMiles = Infinity;
    for (let i = 0; i < plottedRouteCoordinates.length; i++) {
        const distanceEstimate = computeDistanceVectorMiles(plottedRouteCoordinates[i][0], plottedRouteCoordinates[i][1], pointLat, pointLon);
        if (distanceEstimate < minimumTrackSeparationMiles) minimumTrackSeparationMiles = distanceEstimate;
    }
    return minimumTrackSeparationMiles;
}

document.addEventListener('click', (e) => {
    document.querySelectorAll('[id$="-suggestions"], [id^="via-suggestions-"]').forEach(box => { if (!box.contains(e.target)) box.classList.add('hidden'); });
});

function initializeClickIsolationBubbling() {
    ['global-detail-sheet', 'starred-dropdown-panel', 'primary-control-sidebar', 'secondary-control-sidebar'].forEach(id => {
        const node = document.getElementById(id);
        if (node) { node.addEventListener('click', (e) => { e.stopPropagation(); }); node.addEventListener('dblclick', (e) => { e.stopPropagation(); }); }
    });
}

async function forceReloadRemotePipelineData() {
    try {
        const response = await fetch('https://fuel-api-proxy.jasonlung0.workers.dev/');
        const data = await response.json();
        rawGlobalStationsPool = data.map(s => { return { ...s, PremiumDiesel: (parseFloat(s.B7) && !isNaN(parseFloat(s.B7))) ? (parseFloat(s.B7) + 14.2).toFixed(1) : null }; });
        const lbl = document.getElementById('live-timestamp-label');
        if (lbl) lbl.innerHTML = `Prices Updated At ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        executeStationDataFilteringPipeline();
    } catch (error) {
        const lbl = document.getElementById('live-timestamp-label');
        if (lbl) lbl.textContent = "Offline Data Buffer Frame";
    }
}

// -------------------------------------------------------------
// MAIN PIPELINE: Filter Stations & Draw Map
// -------------------------------------------------------------
window.executeStationDataFilteringPipeline = async function() {
    if (!rawGlobalStationsPool?.length && document.getElementById('fuel-type-select')?.value !== 'electric') return;
    const targetFuelType = document.getElementById('fuel-type-select')?.value || 'E10';
    const targetLocalRadiusThreshold = parseFloat(document.getElementById('radius-slider')?.value || 5);
    const targetCorridorRadiusThreshold = parseFloat(document.getElementById('route-radius-slider')?.value || 2);
    let dynamicBoundedStations = [];

    // --- EV CHARGING STATION FETCH PIPELINE ---
    if (targetFuelType === 'electric') {
        const timelineContainer = document.getElementById('refuel-timeline-output');
        if (timelineContainer) timelineContainer.innerHTML = '<p class="text-center py-2 text-xs font-medium text-zinc-400">Locating optimal charge points...</p>';
        try {
            if (activeTabContext === 'route' && typeof plottedRouteCoordinates !== 'undefined' && plottedRouteCoordinates.length > 0) {
                const sampleInterval = Math.max(1, Math.floor(plottedRouteCoordinates.length / 25)); 
                const sampledCoords = [];
                for (let i = 0; i < plottedRouteCoordinates.length; i += sampleInterval) sampledCoords.push(plottedRouteCoordinates[i]);
                sampledCoords.push(plottedRouteCoordinates[plottedRouteCoordinates.length - 1]);

                let combinedStations = [];
                for (const coord of sampledCoords) {
                    const lat = coord[0];
                    const lon = coord[1];
                    try {
                        const url = `https://api.openchargemap.io/v3/poi/?key=${OCM_KEY}&output=json&latitude=${lat}&longitude=${lon}&distance=15&distanceunit=Miles&maxresults=40&compact=true&verbose=false`;
                        const response = await fetch(url);
                        const data = await response.json();
                        if (Array.isArray(data)) combinedStations = combinedStations.concat(data);
                    } catch (err) {}
                }

                const uniqueMap = new Map();
                combinedStations.forEach(item => { if (item.ID) uniqueMap.set(item.ID, item); });

                currentlyVisibleStations = Array.from(uniqueMap.values()).map(poi => ({
                    id: poi.ID, brand_name: poi.OperatorInfo?.Title || 'Independent Charger', address: poi.AddressInfo?.AddressLine1 || 'Location Registered',
                    latitude: poi.AddressInfo?.Latitude, longitude: poi.AddressInfo?.Longitude, electric: poi.Connections?.[0]?.PowerKW || 50, 
                    is_public: poi.UsageType?.IsPayAtLocation ?? true, usage_title: poi.UsageType?.Title || 'Public Access', operator_url: poi.OperatorInfo?.WebsiteURL || null, isEV: true
                }));

                currentlyVisibleStations = currentlyVisibleStations.filter(s => computeMinimumDistanceToRouteCorridor(parseFloat(s.latitude), parseFloat(s.longitude)) <= targetCorridorRadiusThreshold);
            } else {
                const searchLat = mapSearchAnchorCoordinates[0];
                const searchLon = mapSearchAnchorCoordinates[1];
                let ocmUrl = `https://api.openchargemap.io/v3/poi/?output=json&key=${OCM_KEY}&countrycode=GB&latitude=${searchLat}&longitude=${searchLon}&distance=${targetLocalRadiusThreshold}&distanceunit=Miles&maxresults=100`;
                
                const res = await fetch(ocmUrl);
                const data = await res.json();
                currentlyVisibleStations = data.map(poi => ({
                    id: poi.ID, brand_name: poi.OperatorInfo?.Title || 'Independent Charger', address: poi.AddressInfo?.AddressLine1 || 'Location Registered',
                    latitude: poi.AddressInfo?.Latitude, longitude: poi.AddressInfo?.Longitude, electric: poi.Connections?.[0]?.PowerKW || 50, 
                    is_public: poi.UsageType?.IsPayAtLocation ?? true, usage_title: poi.UsageType?.Title || 'Public Access', operator_url: poi.OperatorInfo?.WebsiteURL || null, isEV: true
                }));
            }

            paintMarkerCanvasLayersToMap(currentlyVisibleStations, 'electric', currentlyVisibleStations.length, globalRouteDistanceMiles);
            generateCheapestRankingListDeck(currentlyVisibleStations, 'electric');
            if (activeTabContext === 'route') calculateOptimalRefuelStrategy();
        } catch (err) { Toast.show("Failed to fetch live EV locations", "error"); }
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

    let validPool = pool.map(station => {
        let price = parseFloat(station[fuelVariant]);
        if (fuelVariant === 'electric' && (!price || isNaN(price))) price = parseFloat(station.electric_price || station.charge_rate || station.electric || 42.8);
        return { ...station, processedPrice: price };
    }).filter(s => s.processedPrice && !isNaN(s.processedPrice) && s.processedPrice > 0);

    if (validPool.length === 0) { block.classList.add('hidden'); return; }
    container.innerHTML = '';
    const isEV = fuelVariant === 'electric';

    if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
        blockTitle.textContent = "3 Optimal Stations On Your Route";
        const milestoneLocationsList = [];
        milestoneLocationsList.push({ label: "Start", node: cachedGeocodedWaypoints.start });
        Object.keys(cachedGeocodedWaypoints.vids).forEach(key => milestoneLocationsList.push({ label: `Stopover`, node: cachedGeocodedWaypoints.vids[key] }));
        milestoneLocationsList.push({ label: "Destination", node: cachedGeocodedWaypoints.end });

        milestoneLocationsList.forEach(milestone => {
            let rawMilestonePool = validPool.map(station => {
                let distanceToNode = computeDistanceVectorMiles(milestone.node.lat, milestone.node.lon, parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng));
                return { station, distanceToNode };
            }).filter(item => item.distanceToNode <= 12).sort((a, b) => a.station.processedPrice - b.station.processedPrice);

            let slicedTopThree = rawMilestonePool.slice(0, 3);
            if (slicedTopThree.length > 0) {
                const subGroupWrapper = document.createElement('div');
                subGroupWrapper.className = "space-y-1.5 p-2 bg-zinc-50/70 dark:bg-zinc-900/40 rounded-xl border border-zinc-100 dark:border-zinc-800/60";
                subGroupWrapper.innerHTML = `<div class="flex justify-between items-center px-1 text-[9px] font-black tracking-tight text-zinc-400 dark:text-zinc-500 uppercase"><span>📍 ${milestone.label}: <span class="text-zinc-700 dark:text-zinc-300 font-black">${milestone.node.name.split(',')[0]}</span></span></div>`;

                slicedTopThree.forEach((item, idx) => {
                    const lat = parseFloat(item.station.latitude || item.station.lat);
                    const lon = parseFloat(item.station.longitude || item.station.lng);
                    subGroupWrapper.innerHTML += `
                        <div onclick="focusAndHighlightMapMarker(${lat}, ${lon})" class="flex items-center justify-between p-2.5 bg-white dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800 rounded-lg hover:border-emerald-500 transition shadow-xs cursor-pointer">
                            <div class="flex items-center gap-2 min-w-0">
                                <div class="w-4 h-4 rounded bg-emerald-500/10 text-[8px] flex items-center justify-center shrink-0 font-black text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 tabular-nums">#${idx + 1}</div>
                                <div class="min-w-0">
                                    <div class="text-xs font-bold text-zinc-900 dark:text-white truncate">${(item.station.brand_name || 'Independent').replace(/['"]/g, '')}</div>
                                    <div class="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 truncate block">${item.station.address || ''} • <span class="font-bold text-emerald-700 dark:text-emerald-500">${item.distanceToNode.toFixed(1)} mi away</span></div>
                                </div>
                            </div>
                            <div class="text-right shrink-0"><div class="text-[11px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${isEV?'⚡':''}${parseFloat(item.station.processedPrice).toFixed(1)}${isEV?'kW':'p'}</div></div>
                        </div>`;
                });
                container.appendChild(subGroupWrapper);
            }
        });
    } else {
        blockTitle.textContent = "Optimal Stations Nearby";
        validPool.sort((a, b) => a.processedPrice - b.processedPrice).slice(0, 3).forEach((station, idx) => {
            const lat = parseFloat(station.latitude || station.lat);
            const lon = parseFloat(station.longitude || station.lng);
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
                <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${isEV?'⚡':''}${parseFloat(station.processedPrice).toFixed(1)}${isEV?'kW':'p'}</div></div>
            `;
            container.appendChild(card);
        });
    }
    block.classList.remove('hidden');
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

    if (activeTabContext === 'route' && routeDistanceContext && pricesArray.length > 0) {
        const costNode = document.getElementById('summary-cost');
        if (costNode && !isEV) costNode.textContent = `${minPrice.toFixed(1)}p`;
    }

    let gT = 0, bT = 0;
    if (isEV) { gT = 55; bT = 75; }
    else if (pricesArray.length > 0) {
        pricesArray.sort((a, b) => a - b);
        gT = pricesArray[Math.floor(pricesArray.length * 0.333)];
        bT = pricesArray[Math.floor(pricesArray.length * 0.666)];
    }

    stationsList.forEach((station) => {
        let numericPrice = parseFloat(station[variant]);
        if (isEV && (!numericPrice || isNaN(numericPrice))) numericPrice = parseFloat(station.electric_price || station.charge_rate || station.electric);
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
        
        markerInstance.on('click', (e) => { L.DomEvent.stopPropagation(e); openForecourtDetailSheet(station); });
        markerClusterGroupInstance.addLayer(markerInstance);
    });
};

// -------------------------------------------------------------
// CORE CALCULATOR: Smart Refuel Optimization & Savings Logic 
// -------------------------------------------------------------
window.calculateOptimalRefuelStrategy = function() {
    const fuelType = document.getElementById('fuel-type-select')?.value || 'E10';
    const isEV = fuelType === 'electric';

    const currentPct = parseFloat(document.getElementById('refuel-current-level')?.value) || 0;
    const safetyBuffer = parseFloat(document.getElementById('refuel-safety-buffer')?.value) || 0;
    const capacity = parseFloat(document.getElementById('refuel-tank-size')?.value) || (isEV ? 60 : 55);
    const efficiency = parseFloat(document.getElementById('vehicle-mpg')?.value) || (isEV ? 3.5 : 40);
    
    const timeline = document.getElementById('refuel-timeline-output');
    const savingsBlock = document.getElementById('smart-refuel-savings-block');
    if (savingsBlock) savingsBlock.classList.add('hidden');
    
    if (!globalRouteDistanceMiles || globalRouteDistanceMiles === 0 || !plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
        if (timeline) { timeline.classList.remove('hidden'); timeline.innerHTML = '<p class="text-zinc-500 text-[10px] text-center py-2 font-medium">Map a route to unlock Smart Refuel.</p>'; }
        return; 
    }

    let remainingRangeMiles = 0;
    let currentEnergyUnits = capacity * (currentPct / 100);

    // AI Math Conversion for EV (kWh to Miles) vs ICE (Liters to Miles)
    if (isEV) {
        const bufferKwh = safetyBuffer / efficiency;
        const usableKwh = Math.max(0, currentEnergyUnits - bufferKwh);
        remainingRangeMiles = usableKwh * efficiency;
    } else {
        const milesPerLiter = efficiency / 4.54609; 
        const usableLiters = Math.max(0, currentEnergyUnits - (safetyBuffer / milesPerLiter));
        remainingRangeMiles = usableLiters * milesPerLiter;
    }
    
    if (remainingRangeMiles >= globalRouteDistanceMiles) {
        if (timeline) {
            timeline.classList.remove('hidden');
            timeline.innerHTML = `<div class="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-3.5 rounded-xl text-xs flex flex-col gap-1 shadow-sm"><div class="font-bold flex items-center gap-1">🎉 ${isEV ? 'Battery Charge' : 'Fuel Tank'} Sufficient!</div><p class="text-zinc-400 font-medium leading-normal">Your current range covers this ${globalRouteDistanceMiles.toFixed(1)} mi trip without stopping.</p></div>`;
        }
        if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) refuelMarkersGroup.clearLayers();
        return;
    }

    let validStations = currentlyVisibleStations.filter(s => {
        let p = parseFloat(s[fuelType]);
        if (isEV && (!p || isNaN(p))) p = parseFloat(s.electric_price || s.charge_rate || s.electric);
        return p && !isNaN(p) && p > 0;
    });

    if (validStations.length === 0 && rawGlobalStationsPool) {
        validStations = rawGlobalStationsPool.filter(s => {
            let p = parseFloat(s[fuelType]);
            if (isEV && (!p || isNaN(p))) p = parseFloat(s.electric_price || s.charge_rate || s.electric);
            return p && !isNaN(p) && p > 0;
        });
    }

    if (validStations.length === 0) {
        if (timeline) { timeline.classList.remove('hidden'); timeline.innerHTML = `<p class="text-zinc-400 text-xs text-center py-2 font-medium">No active ${isEV ? 'chargers' : 'fuel stations'} found.</p>`; }
        return;
    }

    let bestStation = null;
    let isEmergencyMode = false;
    const startLat = plottedRouteCoordinates[0][0];
    const startLon = plottedRouteCoordinates[0][1];

    if (currentPct <= 5 || remainingRangeMiles <= 0) {
        isEmergencyMode = true;
        validStations.sort((a, b) => computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng)) - computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng)));
        bestStation = validStations[0];
    } else {
        let reachableStations = validStations.filter(s => {
            const distFromStart = computeDistanceVectorMiles(startLat, startLon, parseFloat(s.latitude || s.lat), parseFloat(s.longitude || s.lng));
            return (distFromStart * 1.2) <= remainingRangeMiles;
        });

        if (reachableStations.length === 0) {
            isEmergencyMode = true;
            validStations.sort((a, b) => computeDistanceVectorMiles(startLat, startLon, parseFloat(a.latitude || a.lat), parseFloat(a.longitude || a.lng)) - computeDistanceVectorMiles(startLat, startLon, parseFloat(b.latitude || b.lat), parseFloat(b.longitude || b.lng)));
            bestStation = validStations[0];
            Toast.show(`Showing nearest emergency stop.`, 'warning');
        } else {
            reachableStations.sort((a, b) => {
                let pA = parseFloat(a[fuelType]); if (isEV && !pA) pA = parseFloat(a.electric_price || a.electric || 50);
                let pB = parseFloat(b[fuelType]); if (isEV && !pB) pB = parseFloat(b.electric_price || b.electric || 50);
                return pA - pB;
            });
            bestStation = reachableStations[0];
        }
    }
    
    if (!bestStation) return;

    const lat = parseFloat(bestStation.latitude || bestStation.lat || 0);
    const lon = parseFloat(bestStation.longitude || bestStation.lng || 0);
    
    let bestPrice = parseFloat(bestStation[fuelType] || 0);
    if (isEV && (!bestPrice || bestPrice === 0)) bestPrice = parseFloat(bestStation.electric_price || bestStation.charge_rate || bestStation.electric || 50);
    
    const validPrices = rawGlobalStationsPool.map(s => {
        let p = parseFloat(s[fuelType]);
        if (isEV && !p) p = parseFloat(s.electric_price || s.electric);
        return p;
    }).filter(p => !isNaN(p) && p > 0);
    
    const averagePrice = validPrices.length > 0 ? (validPrices.reduce((a, b) => a + b, 0) / validPrices.length) : bestPrice;
    
    const energyToFill = Math.max(0, capacity - currentEnergyUnits);
    const totalCost = (energyToFill * bestPrice) / 100;
    
    const savingsPence = (averagePrice - bestPrice) * energyToFill;
    const savingsGBP = Math.max(0, savingsPence / 100);

    if (savingsGBP > 0 && savingsBlock) {
        savingsBlock.classList.remove('hidden');
        savingsBlock.innerHTML = `
            <div class="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-center justify-between">
                <div>
                    <p class="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">Saving you</p>
                    <p class="text-xl font-black text-emerald-700 dark:text-emerald-400">£${savingsGBP.toFixed(2)}</p>
                </div>
                <div class="text-right">
                    <p class="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Pump Price</p>
                    <p class="text-sm font-black text-zinc-800 dark:text-zinc-100">${bestPrice.toFixed(1)}${isEV?'p/kWh':'p'}</p>
                </div>
            </div>
        `;
    }
    
    const distToStop = computeDistanceVectorMiles(startLat, startLon, lat, lon) * 1.2;

    if (timeline) {
        timeline.classList.remove('hidden');
        timeline.innerHTML = `
            <div class="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-xs space-y-3 shadow-sm tabular-nums">
                <div class="relative border-l-2 border-dashed border-zinc-300 dark:border-zinc-700 ml-4 pl-6 py-2 space-y-6">
                    <div class="relative">
                        <div class="absolute w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[32px] top-1"></div>
                        <div class="flex justify-between items-center">
                            <span class="text-zinc-600 dark:text-zinc-500 font-medium block leading-none">Start</span>
                            <span class="font-bold text-zinc-400">0.0 mi</span>
                        </div>
                    </div>
                    <div class="relative">
                        <div class="absolute w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[32px] top-1"></div>
                        <div class="flex justify-between items-start">
                            <div>
                                <span class="text-zinc-900 dark:text-white font-bold block leading-none">${(bestStation.brand_name || 'Station').replace(/['"]/g, '')}</span>
                                <span class="text-[9px] text-zinc-500 block mt-1">${(bestStation.address || '').replace(/['"]/g, '')}</span>
                            </div>
                            <span class="font-bold text-zinc-900 dark:text-white">~${distToStop.toFixed(1)} mi</span>
                        </div>
                    </div>
                    <div class="relative">
                        <div class="absolute w-3.5 h-3.5 bg-rose-500 rounded-full border-2 border-white dark:border-zinc-900 -left-[32px] top-1"></div>
                        <div class="flex justify-between items-center">
                            <span class="text-zinc-600 dark:text-zinc-500 font-medium block leading-none">Destination</span>
                            <span class="font-bold text-zinc-900 dark:text-white">${globalRouteDistanceMiles.toFixed(1)} mi</span>
                        </div>
                    </div>
                </div>
                
                <div class="border-t border-zinc-800 pt-3 mt-3">
                    <div class="flex justify-between bg-emerald-950/20 -mx-4 px-4 py-2">
                        <span class="text-emerald-500 font-bold">Action</span>
                        <span class="font-black text-emerald-400">${isEV ? 'Charge' : 'Fill'} ${energyToFill.toFixed(1)} ${isEV ? 'kWh' : 'L'}</span>
                    </div>
                    <div class="flex justify-between pt-2 items-center">
                        <span class="text-zinc-500 font-medium">Est. Cost</span>
                        <div class="text-right">
                            <span class="font-black text-white text-base">£${totalCost.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                <button type="button" onclick="focusAndHighlightMapMarker(${lat}, ${lon})" class="w-full mt-2 bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-bold py-2.5 rounded-lg transition active:scale-95 shadow-sm">View on Map</button>
            </div>
        `;
    }

    if (typeof window.refuelMarkersGroup === 'undefined' || window.refuelMarkersGroup === null) {
        window.refuelMarkersGroup = L.layerGroup().addTo(map);
    }
    window.refuelMarkersGroup.clearLayers();

    const customFuelIcon = L.divIcon({
        className: 'custom-fuel-icon',
        html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-amber-500 border-amber-900'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">${isEV ? '⚡' : '⛽'}</div>`,
        iconSize: [32, 32], iconAnchor: [16, 32]
    });
    
    L.marker([lat, lon], { icon: customFuelIcon }).addTo(window.refuelMarkersGroup);
};

window.renderOptimalRefuelStopMarkerOnMap = function(lat, lon, isEV, isEmergencyMode) {
    if (typeof window.refuelMarkersGroup === 'undefined' || !window.refuelMarkersGroup) {
        window.refuelMarkersGroup = L.layerGroup().addTo(map);
    }
    window.refuelMarkersGroup.clearLayers();

    const customFuelIcon = L.divIcon({
        className: 'custom-fuel-icon',
        html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-emerald-500 border-emerald-900'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">${isEV ? '⚡' : '⛽'}</div>`,
        iconSize: [32, 32], iconAnchor: [16, 32]
    });
    
    L.marker([lat, lon], { icon: customFuelIcon }).addTo(window.refuelMarkersGroup);
};

window.clearFuelOptimizationState = function() {
    const inputTank = document.getElementById('refuel-tank-size');
    const inputStarting = document.getElementById('refuel-current-level');
    const inputReserve = document.getElementById('refuel-safety-buffer');

    if (inputTank) inputTank.value = "55";
    if (inputStarting) inputStarting.value = "25";
    if (inputReserve) inputReserve.value = "30";

    if (typeof refuelMarkersGroup !== 'undefined' && refuelMarkersGroup) refuelMarkersGroup.clearLayers();

    const timelineContainer = document.getElementById('refuel-timeline-output');
    if (timelineContainer) {
        timelineContainer.innerHTML = '';
        timelineContainer.classList.add('hidden');
    }

    const savingsBlock = document.getElementById('smart-refuel-savings-block');
    if (savingsBlock) {
        savingsBlock.classList.add('hidden');
    }
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
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
        let evCard = document.getElementById('card-wrap-ev');
        if (!evCard) { evCard = document.createElement('div'); evCard.id = 'card-wrap-ev'; document.getElementById('sheet-prices-grid')?.appendChild(evCard); }
        
        let pRate = parseFloat(station.electric_price || station.charge_rate || station.electric || 50);

        if(evCard) {
            evCard.style.display = 'block';
            evCard.className = `border p-3 rounded-xl text-center transition-all duration-200 col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-sm`;
            evCard.innerHTML = `<span class="text-[10px] font-black uppercase tracking-wider block opacity-75">⚡ Rapid Charging Rate</span><span class="text-xl font-black block mt-1 tabular-nums">${pRate.toFixed(1)} <span class="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70">kW</span></span>`;
        }
        if (titleEl) titleEl.textContent = `⚡ ${(station.brand_name || station.name || 'EV Charger').replace(/['"]/g, '')}`;
    } else {
        ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'block'; });
        const evCard = document.getElementById('card-wrap-ev'); if (evCard) evCard.style.display = 'none';

        const ce10 = document.getElementById('card-wrap-e10'); if(ce10) ce10.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E10, 'E10')}`;
        const ce5 = document.getElementById('card-wrap-e5'); if(ce5) ce5.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E5, 'E5')}`;
        const cb7 = document.getElementById('card-wrap-b7'); if(cb7) cb7.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.B7, 'B7')}`;
        const cpd = document.getElementById('card-wrap-premiumdiesel'); if(cpd) cpd.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.PremiumDiesel, 'PremiumDiesel')}`;

        const se10 = document.getElementById('sheet-price-e10'); if(se10) se10.textContent = station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A';
        const se5 = document.getElementById('sheet-price-e5'); if(se5) se5.textContent = station.E5 ? `${parseFloat(station.E5).toFixed(1)}p` : 'N/A';
        const sb7 = document.getElementById('sheet-price-b7'); if(sb7) sb7.textContent = station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A';
        const spd = document.getElementById('sheet-price-premiumdiesel'); if(spd) spd.textContent = station.PremiumDiesel ? `${parseFloat(station.PremiumDiesel).toFixed(1)}p` : 'N/A';
    }

    updateAllStarUIStates();
    sheet.classList.remove('hidden'); 
    
    if (window.innerWidth < 1024) { setMobileSheetUIState('full'); } 
    else { sheet.classList.remove('drawer-hidden', 'drawer-peek', 'drawer-mid', 'drawer-full'); }
};
