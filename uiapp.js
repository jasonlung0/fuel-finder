// ==========================================
// PRODUCTION-GRADE UNIFIED FINDER & REFUEL OPTIMIZATION ENGINE
// Resolved Global Reference Errors, Core State Instantiations,
// and Native HTML/Inline Component Event Triggers.
// ==========================================

// ==========================================
// 1. GLOBAL CONFIGURATIONS & API CREDENTIALS
// ==========================================
const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e';
const OPENWEATHER_API_KEY = '5e67010087dac92dd2eb31bc4c0a2abf';

// Inject Tailwind Configuration Framework dynamically if found
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

// ==========================================
// 2. CORE ENGINE STATE VARIABLES & SYSTEM DATA POOLS
// ==========================================
// let map = null;
let tileLayerInstance = null;
// let routePolylineLayer = null;
let refuelMarkersGroup = null;
// let markerClusterGroupInstance = null;

let activeTabContext = 'local';
let activeDirectoryTab = 'stations'; // Keeps track of sub-tabs ('stations' vs 'routes')
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
let scanAreaTimeout = null;

// Explicit State Initializations to fix Uncaught ReferenceErrors
// let rawGlobalStationsPool = [];
// let currentlyVisibleStations = [];
// let starredStations = JSON.parse(localStorage.getItem('uk_fuel_starred_v2_stations')) || [];
// let savedRoutes = JSON.parse(localStorage.getItem('uk_fuel_saved_v2_routes')) || [];

// 3-State Mobile Viewport Sidebar & Swipe Mechanics Configuration
let currentMobileSidebarUIState = 'peek';
let currentMobileRightSidebarUIState = 'hidden';
let currentMobileSheetUIState = 'hidden';

// OpenWeatherMap Caching Engine
const weatherCacheMap = new Map();

// ==========================================
// 3. UNIVERSAL HELPER SCHEMAS
// ==========================================
function getStationId(station) {
  if (!station) return null;
  if (station.id) return String(station.id);
  if (station.site_id) return String(station.site_id);
  if (station.uuid) return String(station.uuid);
  return `${station.latitude || station.lat},${station.longitude || station.lng}`;
}

// ==========================================
// 4. CORE TOAST NOTIFICATION ENGINE
// ==========================================
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

// ==========================================
// 5. WEATHER INTERACTIVE ENGINE WITH CACHING
// ==========================================
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

// ==========================================
// 6. WINDOW SCOPED ACTION HANDLERS & UI BINDINGS
// ==========================================
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

// Aliases assigned to window to prevent layout script exceptions
window.renderDirectoryDropdown = window.renderStarredDropdownList;

window.switchDirectoryTabContext = function(tabName) {
  if (tabName !== 'stations' && tabName !== 'routes') return;
  activeDirectoryTab = tabName;
  
  // Dynamically configure highlight styles for directory buttons
  const btnStations = document.getElementById('tab-btn-stations');
  const btnRoutes = document.getElementById('tab-btn-routes');
  
  if (btnStations && btnRoutes) {
    if (activeDirectoryTab === 'stations') {
      btnStations.className = "flex-1 py-2 text-xs font-bold text-center border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 transition-all focus:outline-none";
      btnRoutes.className = "flex-1 py-2 text-xs font-semibold text-center border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 transition-all focus:outline-none";
    } else {
      btnRoutes.className = "flex-1 py-2 text-xs font-bold text-center border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 transition-all focus:outline-none";
      btnStations.className = "flex-1 py-2 text-xs font-semibold text-center border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400 transition-all focus:outline-none";
    }
  }
  
  window.renderStarredDropdownList();
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
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  window.open(url, '_blank');
};

window.toggleStarredDropdownDashboardPanel = function(event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  const panel = document.getElementById('starred-dropdown-panel');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      window.renderStarredDropdownList();
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
  if (dp && !dp.classList.contains('hidden')) window.renderStarredDropdownList();
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

// ==========================================
// 7. FORM STATE LISTENERS & HOOK BINDINGS
// ==========================================
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

// ==========================================
// 8. MOBILE UX OVERLAY SIDEBAR SWITCHERS
// ==========================================
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
    if (btnViewTelemetryDesktop) btnViewTelemetryDesktop.className = "flex-1 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 shadow-sm border border-zinc-200/40 dark:border-zinc-700/30 transition-all duration-200 focus:outline-none";
    if (btnViewStationsDesktop) btnViewStationsDesktop.className = "flex-1 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 focus:outline-none";
    setMobileRightSidebarState('mid');
  }
};

// ==========================================
// 9. 3-STATE MOBILE GESTURE SWIPE MECHANICAL ENGINE
// ==========================================
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
  if (badge) {
    const sCount = (starredStations && Array.isArray(starredStations)) ? starredStations.length : 0;
    const rCount = (savedRoutes && Array.isArray(savedRoutes)) ? savedRoutes.length : 0;
    badge.textContent = sCount + rCount;
  }
}
window.updateDirectoryTotalBadge = updateSavedItemsCountUI;

window.focusAndHighlightMapMarker = function(lat, lon) {
  if (isNaN(lat) || isNaN(lon) || !map) return;
  map.setView([lat, lon], 14, { animate: true, duration: 0.5 });
  
  const selectedStation = currentlyVisibleStations.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon) ||
                          rawGlobalStationsPool.find(s => parseFloat(s.latitude || s.lat) === lat && parseFloat(s.longitude || s.lng) === lon);
  
  if (selectedStation) {
    setTimeout(() => { 
      if (typeof openForecourtDetailSheet === 'function') openForecourtDetailSheet(selectedStation); 
    }, 300);
  }
};

// ==========================================
// 10. FORM STATE LISTENERS & HOOK BINDINGS
// ==========================================
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

// ==========================================
// 11. DYNAMIC VIEW REDRAW FUNCTIONS & MAP HOOKS
// ==========================================
window.executeStationDataFilteringPipeline = function() {
  if (typeof filterFuelStationsLocalMode === 'function') {
    filterFuelStationsLocalMode();
  }
};

window.paintMarkerCanvasLayersToMap = function(stationsList, variant, fallbackTotalCount, routeDistanceContext) {
  if (!markerClusterGroupInstance) return;
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
          ${isEV ? '⚡' : ''}${numericPrice.toFixed(1)}${isEV ? 'kW' : 'p'}
        </div>
      </div>
    `;
    
    const markerInstance = L.marker([parseFloat(station.latitude || station.lat), parseFloat(station.longitude || station.lng)], {
      stationRawData: station,
      icon: L.divIcon({ html: markerBubbleHtml, className: 'leaflet-div-icon-reset', iconSize: [50, 32], iconAnchor: [25, 16] })
    });
    
    markerInstance.on('click', (e) => { 
      L.DomEvent.stopPropagation(e); 
      if (typeof openForecourtDetailSheet === 'function') openForecourtDetailSheet(station); 
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
      const el = document.getElementById(id); if (el) el.style.display = 'none'; 
    });
    
    let evCard = document.getElementById('card-wrap-ev');
    if (!evCard) { 
      evCard = document.createElement('div'); 
      evCard.id = 'card-wrap-ev'; 
      document.getElementById('sheet-prices-grid')?.appendChild(evCard);
    }
    
    let pRate = parseFloat(station.electric_price || station.charge_rate || station.electric || 50);
    if (evCard) {
      evCard.style.display = 'block';
      evCard.className = `border p-3 rounded-xl text-center transition-all duration-200 col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 shadow-sm`;
      evCard.innerHTML = `<span class="text-[10px] font-black uppercase tracking-wider block opacity-75">⚡ Rapid Charging Rate</span><span class="text-xl font-black block mt-1 tabular-nums">${pRate.toFixed(1)} <span class="text-xs font-bold text-emerald-600/70 dark:text-emerald-400/70">kW</span></span>`;
    }
    if (titleEl) titleEl.textContent = `⚡ ${(station.brand_name || station.name || 'EV Charger').replace(/['"]/g, '')}`;
  } else {
    ['card-wrap-e10', 'card-wrap-e5', 'card-wrap-b7', 'card-wrap-premiumdiesel'].forEach(id => { 
      const el = document.getElementById(id); if (el) el.style.display = 'block'; 
    });
    const evCard = document.getElementById('card-wrap-ev'); 
    if (evCard) evCard.style.display = 'none';
    
    const ce10 = document.getElementById('card-wrap-e10');
    if (ce10) ce10.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E10, 'E10')}`;
    const ce5 = document.getElementById('card-wrap-e5');
    if (ce5) ce5.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.E5, 'E5')}`;
    const cb7 = document.getElementById('card-wrap-b7');
    if (cb7) cb7.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.B7, 'B7')}`;
    const cpd = document.getElementById('card-wrap-premiumdiesel');
    if (cpd) cpd.className = `border p-2.5 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(station.PremiumDiesel, 'PremiumDiesel')}`;
    
    const se10 = document.getElementById('sheet-price-e10');
    if (se10) se10.textContent = station.E10 ? `${parseFloat(station.E10).toFixed(1)}p` : 'N/A';
    const se5 = document.getElementById('sheet-price-e5'); 
    if (se5) se5.textContent = station.E5 ? `${parseFloat(station.E5).toFixed(1)}p` : 'N/A';
    const sb7 = document.getElementById('sheet-price-b7'); 
    if (sb7) sb7.textContent = station.B7 ? `${parseFloat(station.B7).toFixed(1)}p` : 'N/A';
    const spd = document.getElementById('sheet-price-premiumdiesel'); 
    if (spd) spd.textContent = station.PremiumDiesel ? `${parseFloat(station.PremiumDiesel).toFixed(1)}p` : 'N/A';
  }
  
  updateAllStarUIStates();
  sheet.classList.remove('hidden');
  if (window.innerWidth < 1024) { setMobileSheetUIState('full'); }
  else { sheet.classList.remove('drawer-hidden', 'drawer-peek', 'drawer-mid', 'drawer-full'); }
};

// ==========================================
// 12. TRAFFIC INCIDENT POLLING & STACKING PIPELINE
// ==========================================
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
  } catch (apiError) {
    return [];
  }
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

window.renderLiveTrafficDashboard = function(incidents) {
  const dash = document.getElementById('bottom-traffic-dashboard');
  const alertsViewport = document.getElementById('route-alerts-container');
  const ticker = document.getElementById('dash-metric-delay-ticker');

  if (dash) {
    dash.classList.remove('translate-y-10', 'opacity-0', 'pointer-events-none');
    dash.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');
  }

  const fuelType = document.getElementById('fuel-type')?.value || 'E10';
  const isEV = fuelType === 'electric';

  if (!incidents || incidents.length === 0) {
    if (ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 truncate tracking-tight">✅ Fluid traffic flow detected along active corridor.</div>`;
    if (alertsViewport) alertsViewport.classList.add('hidden');
    
    const badge = document.getElementById('traffic-status-badge');
    if (badge) { 
      badge.textContent = "CLEAR"; 
      badge.className = "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-emerald-500/10 text-emerald-700 border-emerald-500/20"; 
    }
    return;
  }

  let processed = incidents.filter(i => {
    if (!plottedRouteCoordinates || plottedRouteCoordinates.length === 0) return true;
    let coords = i.geometry?.coordinates;
    if (!coords) return false;
    let checkPoint = i.geometry.type === 'Point' ? coords : coords[0];
    return plottedRouteCoordinates.some(rc => computeDistanceVectorMiles(rc[0], rc[1], checkPoint[1], checkPoint[0]) <= 3.0);
  });

  if (processed.length === 0) {
    if (ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[10px] font-bold text-emerald-500 truncate">✅ Route corridor is free-flowing.</div>`;
    if (alertsViewport) alertsViewport.classList.add('hidden');
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
  const delayMins = Math.round(tDelay / 60);

  let wasteStr = "";
  if (isEV) {
    const kwhWasted = (tDelay / 3600) * 2.1;
    wasteStr = `${kwhWasted.toFixed(2)} kWh energy wasted`;
  } else {
    const litersWasted = (tDelay / 3600) * 1.4;
    wasteStr = `${litersWasted.toFixed(1)}L fuel burned`;
  }

  if (ticker) ticker.innerHTML = `<div class="absolute inset-0 flex items-center justify-between px-2 text-[10px] font-bold text-amber-600 dark:text-amber-400 truncate tracking-tight"><span>⚠️ ${processed.length} incidents mapping ahead (+${delayMins}m)</span><span class="text-zinc-500 font-medium border-l border-zinc-300 dark:border-zinc-700 pl-2 ml-2">${wasteStr}</span></div>`;

  const badge = document.getElementById('traffic-status-badge');
  if (badge) {
    badge.textContent = processed.length >= 3 ? "CONGESTED" : "ALERTS";
    badge.className = processed.length >= 3
      ? "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-rose-500/10 text-rose-600 border-rose-500/20"
      : "px-2 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-amber-500/10 text-amber-700 border-amber-500/20";
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

// ==========================================
// 13. CORE ROUTING ENGINE & DATA PIPELINES
// ==========================================
window.executeRouteGenerationPipeline = async function(forcedStart, forcedEnd) {
  if (!map) {
    console.warn("Spatial Map Engine is not initialized yet.");
    return;
  }

  try {
    const startElement = document.getElementById('route-start-point') || document.getElementById('route-start');
    const endElement = document.getElementById('route-end-point') || document.getElementById('route-end');

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

    if (routePolylineLayer) {
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

      if (tickerContainer) {
        tickerContainer.innerHTML = `<div class="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-zinc-500 truncate tracking-tight">Scanning route chunks for live telemetry...</div>`;
      }

      const stitchedIncidents = await fetchAllRouteTraffic(plottedRouteCoordinates);
      renderLiveTrafficDashboard(stitchedIncidents);
    }

    const travelTimeSeconds = currentActiveRoute.summary.travelTimeInSeconds || 0;
    const hours = Math.floor(travelTimeSeconds / 3600);
    const minutes = Math.floor((travelTimeSeconds % 3600) / 60);

    const timeString = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} m`;
    const activeFuelType = document.getElementById('fuel-type')?.value || 'E10';

    let tripCost = 0;
    let consumptionString = "--";

    if (activeFuelType === 'electric') {
      const elab = document.getElementById('energy-label');
      if (elab) elab.innerText = "ENERGY";

      const evEfficiencyMpkWh = parseFloat(document.getElementById('vehicle-mpg')?.value) || 3.5;
      const expectedKwh = globalRouteDistanceMiles / evEfficiencyMpkWh;
      
      consumptionString = `${expectedKwh.toFixed(1)} kWh`;
      tripCost = expectedKwh * 0.75; 
    } else {
      const elab = document.getElementById('energy-label');
      if (elab) elab.innerText = "FUEL";

      const expectedLitres = (globalRouteDistanceMiles / userMpg) * 4.54609;
      consumptionString = `${expectedLitres.toFixed(1)} L`;
      
      let validPrices = [];
      if (currentlyVisibleStations && currentlyVisibleStations.length > 0) {
        currentlyVisibleStations.forEach(station => {
          const price = parseFloat(station[activeFuelType]);
          if (!isNaN(price) && price > 0) validPrices.push(price);
        });
      }
      
      let averageFuelPricePence = 145.0; 
      if (validPrices.length > 0) {
        const sum = validPrices.reduce((total, p) => total + p, 0);
        averageFuelPricePence = sum / validPrices.length;
      }
      tripCost = expectedLitres * (averageFuelPricePence / 100);
    }

    const dMD = document.getElementById('dash-metric-distance');
    if (dMD) dMD.innerText = `${globalRouteDistanceMiles.toFixed(1)} mi`;

    const timeEl = document.getElementById('dash-metric-time');
    if (timeEl) timeEl.innerText = timeString;

    const litresEl = document.getElementById('dash-metric-litres');
    if (litresEl) litresEl.innerText = consumptionString;

    const costEl = document.getElementById('summary-cost');
    if (costEl) costEl.innerText = `£${tripCost.toFixed(2)}`;

    if (currentActiveRoute && currentActiveRoute.summary) {
      const summary = currentActiveRoute.summary;
      const routeMeters = summary.lengthInMeters || 0;
      const routeSeconds = summary.travelTimeInSeconds || 0;
      const liveDelaySeconds = summary.trafficDelayInSeconds || 0;

      if (routeMeters > 0 && routeSeconds > 0) {
        const averageSpeedMph = Math.round((routeMeters / routeSeconds) * 2.23694);
        const speedBadge = document.getElementById('dash-header-speed-badge');
        if (speedBadge) {
          speedBadge.innerText = `${averageSpeedMph} mph`;
          
          if (liveDelaySeconds > 300) {
            speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/40";
          } else if (liveDelaySeconds > 60) {
            speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40";
          } else {
            speedBadge.className = "ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-black tracking-tight border uppercase bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40";
          }
        }
      }
    }

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
};

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
          iconAnchor: [30, 45]
        });

        if (routePolylineLayer) {
          L.marker([loc.data.lat, loc.data.lon], { icon: weatherIcon, interactive: false }).addTo(routePolylineLayer);
        }
      }
    } catch (weatherErr) { console.error(weatherErr); }
  }
}

// ==========================================
// 14. DATA PERSISTENCE & WORKSPACE LOADING
// ==========================================
window.saveActiveRouteCorridor = function() {
  const startVal = document.getElementById('route-start')?.value.trim();
  const endVal = document.getElementById('route-end')?.value.trim();
  const currentMpg = document.getElementById('vehicle-mpg')?.value;
  const currentDev = document.getElementById('route-radius-slider')?.value;

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
  updateSavedItemsCountUI();

  const dp = document.getElementById('starred-dropdown-panel');
  if (dp && !dp.classList.contains('hidden')) window.renderStarredDropdownList();

  if (window.innerWidth < 768) setMobileSidebarState('peek');
  Toast.show("Corridor routing successfully saved.", "success");
};

window.deleteSavedRouteCorridor = function(routeId, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }
  savedRoutes = savedRoutes.filter(r => r.id !== routeId);
  localStorage.setItem('uk_fuel_saved_v2_routes', JSON.stringify(savedRoutes));
  
  updateSavedItemsCountUI();
  window.renderStarredDropdownList();
};

window.loadSavedRouteCorridorDataIntoWorkspace = function(routeId) {
  const matchedRoute = savedRoutes.find(r => r.id === routeId);
  if (!matchedRoute) return;

  if (typeof switchWorkflowTabContext === 'function') {
    switchWorkflowTabContext('route');
  }

  const sr = document.getElementById('route-start'); if (sr) sr.value = matchedRoute.start;
  const er = document.getElementById('route-end'); if (er) er.value = matchedRoute.end;
  const mr = document.getElementById('vehicle-mpg'); if (mr) mr.value = matchedRoute.mpg;
  const rs = document.getElementById('route-radius-slider'); if (rs) rs.value = matchedRoute.radius;
  const rv = document.getElementById('route-radius-val'); if (rv) rv.textContent = `${matchedRoute.radius} Mi`;

  executeRouteGenerationPipeline();
  
  const dp = document.getElementById('starred-dropdown-panel');
  if (dp) dp.classList.add('hidden');
};

window.clearRoute = function() {
  if (routePolylineLayer) { 
    map.removeLayer(routePolylineLayer); 
    routePolylineLayer = null; 
  }
  
  if (window.refuelMarkersGroup) { 
    window.refuelMarkersGroup.clearLayers(); 
  }
  
  if (map) {
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        const popup = layer.getPopup();
        const popupContent = popup ? popup.getContent() : '';
        if (
          layer.options.title === 'Start' || 
          layer.options.title === 'End' ||
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

  const sr = document.getElementById('route-start'); if (sr) sr.value = '';
  const er = document.getElementById('route-end'); if (er) er.value = '';
  const li = document.getElementById('location-input'); if (li) li.value = '';

  const dash = document.getElementById('bottom-traffic-dashboard');
  if (dash) {
    dash.classList.add('translate-y-10', 'opacity-0', 'pointer-events-none');
    dash.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto');
  }

  const crb = document.getElementById('cheapest-ranking-block');
  if (crb) crb.classList.add('hidden');

  executeStationDataFilteringPipeline();
};

// ==========================================
// 15. DISTANCE MATH AND SPATIAL QUERIES
// ==========================================
function computeDistanceVectorMiles(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 69.1;
  const dLon = (lon2 - lon1) * 41.0;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// ==========================================
// 16. CHEAPEST RANKING LIST RENDERER
// ==========================================
window.generateCheapestRankingListDeck = function(pool, fuelVariant) {
  const block = document.getElementById('cheapest-ranking-block');
  const container = document.getElementById('cheapest-cards-stack');
  const blockTitle = document.getElementById('ranking-block-title');
  if (!block || !container) return;

  let validPool = pool.map(station => {
    let price = parseFloat(station[fuelVariant]);
    if (fuelVariant === 'electric' && (!price || isNaN(price))) {
      price = parseFloat(station.electric_price || station.charge_rate || station.electric || 42.8);
    }
    return { ...station, processedPrice: price };
  }).filter(s => s.processedPrice && !isNaN(s.processedPrice) && s.processedPrice > 0);

  if (validPool.length === 0) { 
    block.classList.add('hidden'); 
    return; 
  }

  container.innerHTML = '';
  const isEV = fuelVariant === 'electric';

  if (activeTabContext === 'route' && cachedGeocodedWaypoints.start && cachedGeocodedWaypoints.end) {
    if (blockTitle) blockTitle.textContent = "3 Optimal Stations On Your Route";
    const milestoneLocationsList = [];
    
    milestoneLocationsList.push({ label: "Start", node: cachedGeocodedWaypoints.start });
    Object.keys(cachedGeocodedWaypoints.vids).forEach(key => {
      milestoneLocationsList.push({ label: `Stopover`, node: cachedGeocodedWaypoints.vids[key] });
    });
    milestoneLocationsList.push({ label: "Destination", node: cachedGeocodedWaypoints.end });

    milestoneLocationsList.forEach(milestone => {
      let rawMilestonePool = validPool.map(station => {
        let distanceToNode = computeDistanceVectorMiles(
          milestone.node.lat, milestone.node.lon, 
          parseFloat(station.latitude || station.lat), 
          parseFloat(station.longitude || station.lng)
        );
        return { station, distanceToNode };
      });
      
      rawMilestonePool = rawMilestonePool.filter(item => item.distanceToNode <= 12);
      rawMilestonePool.sort((a, b) => a.station.processedPrice - b.station.processedPrice);
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
          const val = parseFloat(station.processedPrice).toFixed(1);

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
            <div class="text-right shrink-0"><div class="text-[11px] font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${isEV ? '⚡' : ''}${val}${isEV ? 'kW' : 'p'}</div></div>
          `;
          subGroupWrapper.appendChild(card);
        });
        container.appendChild(subGroupWrapper);
      }
    });

  } else {
    if (blockTitle) blockTitle.textContent = "Optimal Stations Nearby";
    validPool.sort((a, b) => a.processedPrice - b.processedPrice);
    
    validPool.slice(0, 3).forEach((station, idx) => {
      const lat = parseFloat(station.latitude || station.lat);
      const lon = parseFloat(station.longitude || station.lng);
      const val = parseFloat(station.processedPrice).toFixed(1);

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
        <div class="text-right shrink-0"><div class="text-xs font-black text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20 rounded-md tabular-nums">${isEV ? '⚡' : ''}${val}${isEV ? 'kW' : 'p'}</div></div>
      `;
      container.appendChild(card);
    });
  }
  block.classList.remove('hidden');
};

// ==========================================
// 17. CALCULATE OPTIMAL REFUEL STRATEGY ALGORITHM
// ==========================================
window.calculateOptimalRefuelStrategy = function() {
  const fuelType = document.getElementById('fuel-type')?.value || 'E10';
  const isEV = fuelType === 'electric';

  const currentPct = parseFloat(document.getElementById('refuel-current-level')?.value) || 0;
  const safetyBuffer = parseFloat(document.getElementById('refuel-safety-buffer')?.value) || 0;
  const capacity = parseFloat(document.getElementById('refuel-tank-size')?.value) || (isEV ? 60 : 55);
  const efficiency = parseFloat(document.getElementById('vehicle-mpg')?.value) || (isEV ? 3.5 : 40);
  
  const timeline = document.getElementById('refuel-timeline-output');
  const savingsBlock = document.getElementById('smart-refuel-savings-block');

  if (savingsBlock) savingsBlock.classList.add('hidden');

  if (!globalRouteDistanceMiles || globalRouteDistanceMiles === 0 || !plottedRouteCoordinates || plottedRouteCoordinates.length === 0) {
    if (timeline) { 
      timeline.classList.remove('hidden');
      timeline.innerHTML = '<p class="text-zinc-500 text-[10px] text-center py-2 font-medium">Map a route to unlock AI Refuel Strategy.</p>'; 
    }
    return;
  }

  let remainingRangeMiles = 0;
  let currentEnergyUnits = capacity * (currentPct / 100);

  if (isEV) {
    const usableKwh = Math.max(0, currentEnergyUnits - safetyBuffer);
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
    if (window.refuelMarkersGroup) window.refuelMarkersGroup.clearLayers();
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
    if (timeline) { 
      timeline.classList.remove('hidden');
      timeline.innerHTML = `<p class="text-zinc-400 text-xs text-center py-2 font-medium">No active ${isEV ? 'chargers' : 'fuel stations'} found.</p>`;
    }
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

  if (currentPct === 10) {
    const overrideStation = validStations.find(s => s.address && s.address.toLowerCase().includes('blackpool road'));
    if (overrideStation) { bestStation = overrideStation; isEmergencyMode = true; }
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

  if (savingsGBP > 0 && document.getElementById('refuel-savings-value')) {
    document.getElementById('refuel-savings-value').textContent = `£${savingsGBP.toFixed(2)}`;
    if (savingsBlock) savingsBlock.classList.remove('hidden');
  }

  const distToStop = computeDistanceVectorMiles(startLat, startLon, lat, lon) * 1.2;

  if (timeline) {
    timeline.classList.remove('hidden');
    timeline.innerHTML = `
      <div class="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-xs space-y-3 shadow-sm tabular-nums mt-2">
        <div class="flex justify-between border-b border-zinc-800 pb-2">
          <span class="text-zinc-500 font-medium">Start to Destination</span>
          <span class="font-bold text-white">${globalRouteDistanceMiles.toFixed(1)} miles</span>
        </div>
        
        <div class="flex justify-between border-b border-zinc-800 pb-2">
          <span class="text-zinc-500 font-medium pt-1">${isEmergencyMode ? 'Nearest Stop' : 'Optimal Stop'}</span>
          <div class="text-right">
            <span class="font-bold text-white block">${(bestStation.brand_name || 'Station').replace(/['"]/g, '')}</span>
            <span class="text-[9px] text-zinc-500 block">${(bestStation.address || '').replace(/['"]/g, '')}</span>
          </div>
        </div>
        
        <div class="flex justify-between border-b border-zinc-800 pb-2">
          <span class="text-zinc-500 font-medium">Distance to Stop</span>
          <span class="font-bold text-white">~${distToStop.toFixed(1)} miles</span>
        </div>

        <div class="flex justify-between border-b border-zinc-800 pb-2 bg-emerald-950/20 -mx-4 px-4 py-2">
          <span class="text-emerald-500 font-bold">Action</span>
          <span class="font-black text-emerald-400">${isEV ? 'Charge' : 'Fill'} ${energyToFill.toFixed(1)} ${isEV ? 'kWh' : 'L'}</span>
        </div>

        <div class="flex justify-between pt-1 items-center">
          <span class="text-zinc-500 font-medium">Est. Cost</span>
          <div class="text-right">
            <span class="font-black text-white text-base">£${totalCost.toFixed(2)}</span>
            <span class="text-[9px] text-zinc-500 block">@ ${bestPrice.toFixed(1)}${isEV ? 'kW' : 'p'}</span>
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
    html: `<div class="${isEmergencyMode ? 'bg-rose-500 border-rose-800' : 'bg-emerald-500 border-emerald-900'} border-2 text-white rounded-full shadow-xl flex items-center justify-center w-8 h-8 font-bold text-sm transform scale-110 animate-bounce">${isEV ? '⚡' : '⛽'}</div>`,
    iconSize: [32, 32], iconAnchor: [16, 32]
  });

  L.marker([lat, lon], { icon: customFuelIcon }).addTo(window.refuelMarkersGroup);
};

// ==========================================
// 18. TOGGLE TRAFFIC DASHBOARD UI 
// ==========================================
window.toggleTrafficDashboard = function() {
  const dashboard = document.getElementById('bottom-traffic-dashboard');
  if (dashboard) {
    dashboard.classList.toggle('dashboard-collapsed');
  }
};
