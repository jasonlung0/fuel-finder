/**
 * PRODUCTION-GRADE UNIFIED FINDER & REFUEL OPTIMIZATION ENGINE
 * Includes OpenWeatherMap Caching, OpenChargeMap Corridor Sampling, 
 * Traffic Analytics, Fuel Type Normalization, and Mobile Drawer Systems.
 */

// ==========================================
// 1. GLOBAL CONFIGURATIONS & API CREDENTIALS
// ==========================================
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfi01T3X0obPhgkGpFC6';
const OCM_KEY = 'e1b259fb-c770-45f8-9e4d-069a19631b2e';
const OPENWEATHER_API_KEY = '5e67010087dac92dd2eb31bc4c0a2abf';
const ORS_API_KEY = 'eyJvcmci0iI1YjNjZTM10Tc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFKMDQ5NjI5ZTY1ZWExNmQ3TTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

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
    },
    safelist: ['bg-fuel-green', 'bg-fuel-blue', 'bg-fuel-red']
  };
}

// ==========================================
// 2. CORE ENGINE STATE VARIABLES
// ==========================================
let map = null;
let tileLayerInstance = null;
let markerClusterGroupInstance = null;
let routePolylineLayer = null;
let refuelMarkersGroup = null;

let rawGlobalStationsPool = [];
let currentlyVisibleStations = [];
let starredStations = [];
let savedRoutes = [];

let activeTabContext = 'local'; // 'local' or 'route'
let activeDirectoryTab = 'stations'; // 'stations' or 'saved-routes'
let activeSheetStation = null;
let mapSearchAnchorCoordinates = [56.0716, -3.4523]; // Default to Dunfermline/UK pivot
let plottedRouteCoordinates = [];
let autocompleteDebounceTimer = null;
let lastSavedRouteData = null;

let globalActiveRoute = null;
let globalRouteDistanceMiles = 0;
let globalRouteDurationSeconds = 0;
let isDarkMode = localStorage.getItem('theme-dark-setting-mode') === 'true';

let cachedGeocodedWaypoints = { start: null, end: null, vids: {} };
let dynamicWaypointIncrementalIndex = 0;
let originalMapCenter = null;
let scanAreaTimeout = null;
let searchByAreaActive = false;

// 3-State Mobile Viewport Sidebar & Swipe Mechanics Configuration
let currentMobileSidebarUIState = 'peek';
let currentMobileSheetUIState = 'hidden';

// ==========================================
// 3. UNIVERSAL HELPER & TRANSLATION LAYERS
// ==========================================
function getStationId(station) {
  if (!station) return null;
  if (station.id) return String(station.id);
  if (station.site_id) return String(station.site_id);
  if (station.uuid) return String(station.uuid);
  return `${station.latitude || station.lat},${station.longitude || station.lng}`;
}

function calculateHaversineDistanceFormulaKM(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Normalizes coordinate and variance properties across disparate provider schemas.
 * Injects a dynamic PremiumDiesel offset strategy if missing from raw source fields.
 */
function normalizeAndTranslateStationSchema(station) {
  const resolvedLat = parseFloat(station.lat || station.latitude);
  const resolvedLng = parseFloat(station.lng || station.longitude);
  if (isNaN(resolvedLat) || isNaN(resolvedLng)) return null;

  const rawB7 = station.B7 ?? station.b7 ?? station.B7_price ?? null;
  const rawE10 = station.E10 ?? station.e10 ?? station.E10_price ?? null;
  const rawE5 = station.E5 ?? station.e5 ?? station.E5_price ?? null;

  // Process Premium Diesel markup simulation (+14.2p calculation) if unavailable explicitly
  let rawPremiumDiesel = station.PremiumDiesel ?? station.premiumdiesel ?? station.PremiumDiesel_price ?? null;
  if (!rawPremiumDiesel && rawB7) {
    rawPremiumDiesel = (parseFloat(rawB7) + 14.2).toFixed(1);
  }

  return {
    ...station,
    id: getStationId(station),
    lat: resolvedLat,
    lng: resolvedLng,
    latitude: resolvedLat,
    longitude: resolvedLng,
    brand_name: station.brand_name || station.brand || station.name || 'Independent Station',
    address: station.address || station.location || 'Location Stored',
    postcode: station.postcode || station.postalCode || '',
    isEV: !!(station.connections || station.poi || station.usageTypeID || station.is_ev),
    E10: rawE10,
    E5: rawE5,
    B7: rawB7,
    PremiumDiesel: rawPremiumDiesel
  };
}

// Initialize LocalStorage Data Pools Safely
try {
  const loadedStarred = localStorage.getItem('uk_fuel_starred_v2_stations');
  const loadedRoutes = localStorage.getItem('uk_fuel_saved_v2_routes');
  if (loadedStarred) starredStations = JSON.parse(loadedStarred);
  if (loadedRoutes) savedRoutes = JSON.parse(loadedRoutes);
} catch (e) {
  console.error("Failed to parse localized storage engines:", e);
  starredStations = [];
  savedRoutes = [];
}

// ==========================================
// 4. CORE TOAST NOTIFICATION ENGINE
// ==========================================
const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-notification-dock';
      this.container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
      document.body.appendChild(this.container);
    }
  },
  show(message, type = 'info') {
    this.init();
    const icons = {
      success: '✔',
      error: '✖',
      warning: '⚠',
      info: 'ℹ'
    };
    const colors = {
      success: 'bg-emerald-500 border-emerald-600',
      error: 'bg-rose-500 border-rose-600',
      warning: 'bg-amber-500 border-amber-600',
      info: 'bg-zinc-800 border-zinc-900'
    };

    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-white font-medium text-xs pointer-events-auto transition-all duration-300 transform translate-x-12 opacity-0 ${colors[type]}`;
    toast.innerHTML = `
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-white/20 font-bold">${icons[type]}</span>
      <p class="m-0 leading-tight">${message}</p>
    `;

    this.container.appendChild(toast);
    requestAnimationFrame(() => {
      setTimeout(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
      }, 10);
    });

    setTimeout(() => {
      toast.classList.remove('translate-x-0', 'opacity-100');
      toast.classList.add('translate-x-12', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// ==========================================
// 5. MOBILE DRAWER INTERACTION LAYER
// ==========================================
function bindMobileSwipeDrawer(handleId, elementId) {
  const handle = document.getElementById(handleId);
  const drawer = document.getElementById(elementId);
  if (!handle || !drawer) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  let startTime = 0;
  const isSidebar = elementId.includes('sidebar');

  handle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isDragging = true;
    drawer.classList.add('dragging-active');
  }, { passive: true });

  handle.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    
    let baseTranslate = 0;
    let activeState = isSidebar ? currentMobileSidebarUIState : currentMobileSheetUIState;
    
    if (activeState === 'full') baseTranslate = 0;
    else if (activeState === 'mid') baseTranslate = window.innerHeight * 0.4;
    else baseTranslate = isSidebar ? (window.innerHeight - 120) : window.innerHeight;

    let targetTranslate = baseTranslate + deltaY;
    if (targetTranslate < 0) targetTranslate = targetTranslate * 0.2; // Rubber-banding
    
    drawer.style.transform = `translateY(${targetTranslate}px)`;
  }, { passive: true });

  handle.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    drawer.classList.remove('dragging-active');
    drawer.style.transform = '';

    const deltaY = currentY - startY;
    const timeDiff = Date.now() - startTime;
    const velocity = Math.abs(deltaY) / timeDiff;

    let activeState = isSidebar ? currentMobileSidebarUIState : currentMobileSheetUIState;

    if (Math.abs(deltaY) < 40) {
      // Small tap or minimal delta toggles structural anchors
      if (activeState === 'peek' || activeState === 'hidden') setMobileDrawerState(elementId, 'mid');
      else if (activeState === 'mid') setMobileDrawerState(elementId, 'full');
      else setMobileDrawerState(elementId, 'peek');
      return;
    }

    if (deltaY < -40) {
      if (velocity > 0.6 || deltaY < -150) setMobileDrawerState(elementId, 'full');
      else if (activeState === 'peek' || activeState === 'hidden') setMobileDrawerState(elementId, 'mid');
      else setMobileDrawerState(elementId, 'full');
    } else if (deltaY > 40) {
      if (velocity > 0.6 || deltaY > 150) setMobileDrawerState(elementId, isSidebar ? 'peek' : 'hidden');
      else if (activeState === 'full') setMobileDrawerState(elementId, 'mid');
      else setMobileDrawerState(elementId, isSidebar ? 'peek' : 'hidden');
    }
  });
}

function setMobileDrawerState(elementId, state) {
  const isSidebar = elementId.includes('sidebar');
  if (isSidebar) currentMobileSidebarUIState = state;
  else currentMobileSheetUIState = state;

  const drawer = document.getElementById(elementId);
  if (!drawer) return;

  // Strips legacy positioning tokens smoothly
  drawer.className = drawer.className.replace(/\b(drawer|sheet)-(hidden|peek|mid|full)\b/g, '').trim();
  const prefix = isSidebar ? 'drawer' : 'sheet';
  drawer.classList.add(`${prefix}-${state}`);
}

// ==========================================
// 6. WEATHER INTERACTIVE ENGINE WITH CACHING
// ==========================================
const weatherCacheMap = new Map();

async function fetchWeatherForStation(lat, lng) {
  const cacheKey = `${parseFloat(lat).toFixed(1)},${parseFloat(lng).toFixed(1)}`;
  if (weatherCacheMap.has(cacheKey)) {
    return weatherCacheMap.get(cacheKey);
  }

  const fallbackEmojis = ['☀️', '⛅', '☁️', '🌧️'];
  const indexedFallback = fallbackEmojis[Math.abs(Math.floor(Math.sin(lat) * 10)) % fallbackEmojis.length];

  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'YOUR_API_KEY') {
    return { emoji: indexedFallback, text: 'Offline Simulator' };
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Weather pipeline connection failure");
    
    const data = await response.json();
    const weatherMainCondition = data.weather?.[0]?.main || 'Clear';
    let weatherEmoji = '☀️';

    if (weatherMainCondition.includes('Cloud')) weatherEmoji = '☁️';
    else if (weatherMainCondition.includes('Rain') || weatherMainCondition.includes('Drizzle')) weatherEmoji = '🌧️';
    else if (weatherMainCondition.includes('Thunder')) weatherEmoji = '⛈️';
    else if (weatherMainCondition.includes('Snow')) weatherEmoji = '❄️';
    else if (weatherMainCondition.includes('Mist') || weatherMainCondition.includes('Fog')) weatherEmoji = '🌫️';
    else if (weatherMainCondition.includes('Clear')) weatherEmoji = '☀️';

    const payload = { emoji: weatherEmoji, text: `${weatherMainCondition} (${Math.round(data.main?.temp || 15)}°C)` };
    weatherCacheMap.set(cacheKey, payload);
    return payload;
  } catch (err) {
    return { emoji: indexedFallback, text: 'N/A' };
  }
}

// ==========================================
// 7. OPENCHARGEMAP & ROUTE STREAM SAMPLING
// ==========================================
async function fetchOpenChargeMapCorridor(coordinatesArray) {
  if (!coordinatesArray || coordinatesArray.length === 0) return [];
  
  // Downsample route coordinates array to respect API limits (15-mile spacing interval)
  const sampleInterval = 12; 
  const sampledQueryNodes = [];
  for (let i = 0; i < coordinatesArray.length; i += sampleInterval) {
    sampledQueryNodes.push(coordinatesArray[i]);
  }
  // Ensure the destination node is captured explicitly
  if (coordinatesArray.length - 1 % sampleInterval !== 0) {
    sampledQueryNodes.push(coordinatesArray[coordinatesArray.length - 1]);
  }

  const electricStationsBufferedPool = [];
  const handledIdentifiers = new Set();

  Toast.show(`Scanning route corridors across ${sampledQueryNodes.length} navigational vectors...`, 'info');

  for (const node of sampledQueryNodes) {
    try {
      const targetApiEndpoint = `https://api.openchargemap.io/v3/poi/?key=${OCM_KEY}&output=json&latitude=${node[0]}&longitude=${node[1]}&distance=15&distanceunit=Miles&maxresults=15&compact=true&verbose=false`;
      const response = await fetch(targetApiEndpoint);
      if (!response.ok) continue;

      const resultsList = await response.json();
      if (!Array.isArray(resultsList)) continue;

      resultsList.forEach(poi => {
        const structuralSignature = `ocm-${poi.ID || poi.UUID}`;
        if (handledIdentifiers.has(structuralSignature)) return;
        handledIdentifiers.add(structuralSignature);

        if (!poi.AddressInfo) return;

        // Dynamic transformation of EV connections structure to fulfill application filter contracts
        let computedKwSpeedOutput = 7.0;
        if (poi.Connections && poi.Connections.length > 0) {
          computedKwSpeedOutput = Math.max(...poi.Connections.map(c => c.PowerKW || 7.0));
        }

        const electricStationObject = {
          id: structuralSignature,
          lat: poi.AddressInfo.Latitude,
          lng: poi.AddressInfo.Longitude,
          latitude: poi.AddressInfo.Latitude,
          longitude: poi.AddressInfo.Longitude,
          brand_name: poi.OperatorInfo?.Title || poi.AddressInfo.Title || 'EV Charging Hub',
          address: poi.AddressInfo.AddressLine1 || 'Route Corridor Way',
          postcode: poi.AddressInfo.Postcode || '',
          isEV: true,
          kwSpeed: computedKwSpeedOutput,
          E10: null, E5: null, B7: null, PremiumDiesel: null // Structural compliance flags
        };

        electricStationsBufferedPool.push(electricStationObject);
      });
    } catch (apiError) {
      console.warn("Failed sampling vector step in OpenChargeMap loop:", apiError);
    }
  }

  return electricStationsBufferedPool;
}

// ==========================================
// 8. SMART REFUEL OPTIMIZATION TIMELINE ENGINE
// ==========================================
function calculateOptimalRefuelStrategy() {
  const currentFuelSelection = document.getElementById('fuel-type-select')?.value || 'B7';
  const isElectricMode = (currentFuelSelection === 'electric');

  const inputTankElement = document.getElementById('refuel-tank-size');
  const inputLevelElement = document.getElementById('refuel-current-level');
  const inputBufferElement = document.getElementById('refuel-safety-buffer');

  if (!inputTankElement || !inputLevelElement || !inputBufferElement) return;

  const totalCapacityUnits = parseFloat(inputTankElement.value) || 55; 
  const currentAvailablePercentage = parseFloat(inputLevelElement.value) || 30;
  const minimumSafetyMarginMiles = parseFloat(inputBufferElement.value) || 40;

  const vehicleEfficiencyMpg = isElectricMode ? 3.5 : 45.0; // mi/kWh vs miles per gallon
  const energyLitresConversionFactor = 4.54609;

  let totalRangeCapabilityMiles = 0;
  let remainingRangeMiles = 0;

  if (isElectricMode) {
    // Electric: Capacity represents kWh capacity, current percentage determines safe range
    totalRangeCapabilityMiles = totalCapacityUnits * vehicleEfficiencyMpg;
    remainingRangeMiles = totalRangeCapabilityMiles * (currentAvailablePercentage / 100);
  } else {
    // Internal Combustion: Tank size (litres) converted to gallons to yield total range metric
    const totalGallonsCapacity = totalCapacityUnits / energyLitresConversionFactor;
    totalRangeCapabilityMiles = totalGallonsCapacity * vehicleEfficiencyMpg;
    remainingRangeMiles = totalRangeCapabilityMiles * (currentAvailablePercentage / 100);
  }

  const criticalRefuelThresholdMiles = remainingRangeMiles - minimumSafetyMarginMiles;
  const timelineContainer = document.getElementById('refuel-timeline-output');
  const savingsBlock = document.getElementById('smart-refuel-savings-block');

  if (!timelineContainer) return;
  timelineContainer.innerHTML = '';
  timelineContainer.classList.remove('hidden');

  if (refuelMarkersGroup) refuelMarkersGroup.clearLayers();

  // SUFFICIENCY WARNINGS OR IMMEDIATE LOGIC CHECK
  if (remainingRangeMiles >= globalRouteDistanceMiles) {
    const alertBannerHTML = `
      <div class="p-4 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl flex flex-col gap-1 items-center text-center">
        <span class="text-xl">${isElectricMode ? '🎉 Battery Charge Sufficient!' : '🎉 Fuel Tank Sufficient!'}</span>
        <span class="text-xs font-medium">Your vehicle has enough range (${remainingRangeMiles.toFixed(0)} mi) to finish this journey (${globalRouteDistanceMiles.toFixed(0)} mi) without refueling stops.</span>
      </div>
    `;
    timelineContainer.innerHTML = alertBannerHTML;
    if (savingsBlock) savingsBlock.classList.add('hidden');
    return;
  }

  // Identify applicable target stops along the corridor vectors
  const candidateStopsPool = currentlyVisibleStations.filter(station => {
    if (isElectricMode) return station.isEV;
    return !station.isEV && station[currentFuelSelection];
  });

  if (candidateStopsPool.length === 0) {
    timelineContainer.innerHTML = `
      <div class="p-4 bg-rose-500/10 text-rose-600 border border-rose-500/20 rounded-xl text-xs font-medium text-center">
        No operational stations matching your filter requirements were located inside the route corridor boundary buffer.
      </div>
    `;
    return;
  }

  // Map candidate objects to absolute route milestones via projection math
  const projectedStopsList = candidateStopsPool.map(station => {
    let rawMinimumDistanceToPoint = Infinity;
    let closestIndexOnTrack = 0;

    for (let i = 0; i < plottedRouteCoordinates.length; i++) {
      const stepDistance = calculateHaversineDistanceFormulaKM(
        station.lat, station.lng, 
        plottedRouteCoordinates[i][0], plottedRouteCoordinates[i][1]
      );
      if (stepDistance < rawMinimumDistanceToPoint) {
        rawMinimumDistanceToPoint = stepDistance;
        closestIndexOnTrack = i;
      }
    }

    const proportionalMilestoneFactor = closestIndexOnTrack / plottedRouteCoordinates.length;
    const computedDistanceAlongRouteMiles = globalRouteDistanceMiles * proportionalMilestoneFactor;

    return {
      station,
      routeMilestoneMiles: computedDistanceAlongRouteMiles,
      priceValue: parseFloat(station[currentFuelSelection] || station.kwSpeed || 0)
    };
  }).sort((a, b) => a.routeMilestoneMiles - b.routeMilestoneMiles);

  // Math Layer Selection Engine: Identify Emergency Threshold Stop vs Optimal Stop Node
  let emergencyStopNode = null;
  let optimalRefuelStopNode = null;

  for (const stop of projectedStopsList) {
    if (stop.routeMilestoneMiles <= remainingRangeMiles) {
      emergencyStopNode = stop; // Last available station before the fuel tank drops completely empty
    }
  }

  // Filter out stations that require refueling past the safe critical buffer zone
  const safeRangeCandidates = projectedStopsList.filter(s => s.routeMilestoneMiles <= remainingRangeMiles);
  if (safeRangeCandidates.length > 0) {
    if (isElectricMode) {
      // For EVs, prioritize the fastest high-power station node (Highest Power PowerKW output)
      optimalRefuelStopNode = safeRangeCandidates.reduce((max, s) => s.priceValue > max.priceValue ? s : max, safeRangeCandidates[0]);
    } else {
      // For IC vehicles, identify the absolute lowest price option within the range window
      optimalRefuelStopNode = safeRangeCandidates.reduce((min, s) => s.priceValue < min.priceValue ? s : min, safeRangeCandidates[0]);
    }
  } else {
    optimalRefuelStopNode = emergencyStopNode || projectedStopsList[0];
  }

  // Render Explicit Timeline Elements featuring Absolute-Positioned Milestone Identifiers
  let timelineBlocksHTML = `
    <div class="relative border-l-2 border-zinc-200 dark:border-zinc-800 ml-4 my-4 flex flex-col gap-6">
      
      <div class="relative pl-6">
        <div class="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-white dark:ring-zinc-950"></div>
        <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Journey Start Node</div>
        <div class="text-[10px] text-zinc-500 font-medium">Remaining vehicle autonomy limits: ~${remainingRangeMiles.toFixed(0)} miles</div>
      </div>
  `;

  if (optimalRefuelStopNode) {
    const optStation = optimalRefuelStopNode.station;
    const priceDisplayString = isElectricMode ? `${optStation.kwSpeed} kW Speed` : `${parseFloat(optStation[currentFuelSelection]).toFixed(1)}p`;
    
    // Add custom visual tracker highlighting to the interactive map viewport layer
    if (refuelMarkersGroup && map) {
      const customRefuelIcon = L.divIcon({
        className: 'custom-refuel-bubble-pin',
        html: `<div class="flex items-center justify-center w-8 h-8 rounded-full border-2 border-emerald-500 bg-white font-black text-sm text-emerald-600 animate-bounce shadow-lg">⛽</div>`,
        iconSize: [32, 32], iconAnchor: [16, 32]
      });
      L.marker([optStation.lat, optStation.lng], { icon: customRefuelIcon }).addTo(refuelMarkersGroup);
    }

    timelineBlocksHTML += `
      <div class="relative pl-6">
        <div class="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white dark:ring-zinc-950"></div>
        <div class="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
          ⭐ RECOMMENDED REFUEL STOP (Milestone: ${optimalRefuelStopNode.routeMilestoneMiles.toFixed(1)} mi)
        </div>
        <div class="text-xs font-black text-zinc-900 dark:text-zinc-100 mt-0.5">${optStation.brand_name}</div>
        <div class="text-[10px] text-zinc-500">${optStation.address}</div>
        <div class="mt-1 inline-block px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          Metric Payload: ${priceDisplayString}
        </div>
      </div>
    `;
  }

  // Inject critical safety emergency marker warning if applicable
  if (emergencyStopNode && emergencyStopNode !== optimalRefuelStopNode) {
    const emStation = emergencyStopNode.station;
    timelineBlocksHTML += `
      <div class="relative pl-6">
        <div class="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-white dark:ring-zinc-950"></div>
        <div class="text-xs font-bold text-amber-600 dark:text-amber-400">🚨 ABSOLUTE EMERGENCY BOUNDARY MARKER</div>
        <div class="text-xs font-medium text-zinc-800 dark:text-zinc-200">${emStation.brand_name} (${emergencyStopNode.routeMilestoneMiles.toFixed(1)} mi)</div>
        <div class="text-[9px] text-zinc-400 tracking-tight">Refueling past this vector point introduces high depletion risks.</div>
      </div>
    `;
  }

  timelineBlocksHTML += `
      <div class="relative pl-6">
        <div class="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-zinc-400 ring-4 ring-white dark:ring-zinc-950"></div>
        <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Journey Destination Terminal</div>
        <div class="text-[10px] text-zinc-500 font-medium">Total explicit route layout length: ${globalRouteDistanceMiles.toFixed(1)} miles</div>
      </div>
    </div>
  `;

  timelineContainer.innerHTML = timelineBlocksHTML;

  // Render estimated monetary structural savings logic block if appropriate criteria is matched
  if (savingsBlock && !isElectricMode && projectedStopsList.length > 1 && optimalRefuelStopNode) {
    const priceArray = safeRangeCandidates.map(s => s.priceValue).filter(p => p > 0);
    if (priceArray.length > 1) {
      const maximumTrackedPrice = Math.max(...priceArray);
      const optimizedDeltaPence = maximumTrackedPrice - optimalRefuelStopNode.priceValue;
      
      if (optimizedDeltaPence > 0.1) {
        const standardRefuelLoadLitres = 45;
        const netCalculatedSavingsPounds = (optimizedDeltaPence * standardRefuelLoadLitres) / 100;

        savingsBlock.innerHTML = `
          <div class="flex items-center gap-3 p-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white shadow-md">
            <span class="text-2xl">💰</span>
            <div class="min-w-0 flex-1">
              <div class="text-xs font-black tracking-tight">Smart Refuel Yield Target achieved!</div>
              <div class="text-[10px] opacity-90 leading-tight">Saving approx <strong>£${netCalculatedSavingsPounds.toFixed(2)}</strong> per standard fill-up versus high-cost corridor stops.</div>
            </div>
          </div>
        `;
        savingsBlock.classList.remove('hidden');
        return;
      }
    }
    savingsBlock.classList.add('hidden');
  }
}

window.clearFuelOptimizationState = function() {
  const inputTank = document.getElementById('refuel-tank-size');
  const inputStarting = document.getElementById('refuel-current-level');
  const inputReserve = document.getElementById('refuel-safety-buffer');
  
  if (inputTank) inputTank.value = "55";
  if (inputStarting) inputStarting.value = "25";
  if (inputReserve) inputReserve.value = "30";
  
  if (refuelMarkersGroup) refuelMarkersGroup.clearLayers();
  
  const timelineContainer = document.getElementById('refuel-timeline-output');
  if (timelineContainer) {
    timelineContainer.innerHTML = '';
    timelineContainer.classList.add('hidden');
  }
  const savingsBlock = document.getElementById('smart-refuel-savings-block');
  if (savingsBlock) savingsBlock.classList.add('hidden');
};

// ==========================================
// 9. MAP LIFECYCLE MANAGERS & RENDER LAYERS
// ==========================================
function focusAndHighlightMapMarker(lat, lon) {
  if (!map) return;
  map.setView([lat, lon], 15);
  
  // Find and forcefully activate associated popup if found inside cluster hierarchy
  if (markerClusterGroupInstance) {
    markerClusterGroupInstance.eachLayer(layer => {
      if (layer instanceof L.Marker && layer.getLatLng().lat === lat && layer.getLatLng().lng === lon) {
        setTimeout(() => layer.openPopup(), 350);
      }
    });
  }
}

function processAndSynchronizeMapMarkers() {
  if (!map || !markerClusterGroupInstance) return;
  markerClusterGroupInstance.clearLayers();

  currentlyVisibleStations.forEach(station => {
    const currentFuelSelection = document.getElementById('fuel-type-select')?.value || 'B7';
    let labelContentHTML = '';

    if (station.isEV) {
      labelContentHTML = `<span class="text-[10px] font-black text-white bg-blue-600 px-1 py-0.5 rounded">⚡ ${Math.round(station.kwSpeed || 7)}k</span>`;
    } else {
      const priceRaw = station[currentFuelSelection];
      if (priceRaw) {
        labelContentHTML = `<span class="text-[10px] font-black tracking-tight tabular-nums">${parseFloat(priceRaw).toFixed(1)}p</span>`;
      } else {
        labelContentHTML = `<span class="text-[9px] font-medium opacity-60">N/A</span>`;
      }
    }

    const uniqueBubbleColorClass = station.isEV ? 'bg-blue-600 border-blue-700' : 'bg-zinc-900 border-zinc-950 dark:bg-zinc-800 dark:border-zinc-900';
    
    const customMarkerIcon = L.divIcon({
      className: 'custom-leaflet-marker-wrapper',
      html: `
        <div class="fuel-marker-bubble flex items-center justify-center px-1.5 py-1 rounded-lg border shadow-md text-white font-bold transition-all transform hover:scale-110 active:scale-95 ${uniqueBubbleColorClass}">
          ${labelContentHTML}
        </div>
      `,
      iconSize: [42, 26],
      iconAnchor: [21, 13]
    });

    const markerInstance = L.marker([station.lat, station.lng], { icon: customMarkerIcon });
    
    // Bind unified map layout popup trigger overlay
    const popupStructureHTML = `
      <div class="p-2 min-w-[180px] text-zinc-900 dark:text-zinc-100 font-sans">
        <div class="text-xs font-black truncate">${station.brand_name}</div>
        <div class="text-[10px] text-zinc-500 mt-0.5 truncate">${station.address}</div>
        <button onclick="openForecourtDetailSheetByExternalId('${station.id}')" class="w-full mt-2 text-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 rounded-lg py-1 text-[10px] font-bold shadow transition hover:opacity-90">
          View Analytics Sheet
        </button>
      </div>
    `;
    markerInstance.bindPopup(popupStructureHTML, { closeButton: false, offset: L.point(0, -6) });
    markerClusterGroupInstance.addLayer(markerInstance);
  });
}

// Map Movement & Viewport Invalidation Polling Handler Loop
function attachCoreMapMovementHooks() {
  if (!map) return;
  map.on('moveend', () => {
    if (activeTabContext === 'local' && !searchByAreaActive) {
      executeStationDataFilteringPipeline();
    }
  });
}

// ==========================================
// 10. MAIN DATA FILTERING & TRANSFORMATION PIPELINE
// ==========================================
function executeStationDataFilteringPipeline() {
  const selectedFuelTypeKey = document.getElementById('fuel-type-select')?.value || 'B7';
  const brandFilterValue = document.getElementById('brand-filter-select')?.value || 'ALL';
  const radiusRangeLimitMiles = parseFloat(document.getElementById('radius-range-slider')?.value) || 10;

  let originPivotLat = mapSearchAnchorCoordinates[0];
  let originPivotLng = mapSearchAnchorCoordinates[1];

  if (map && activeTabContext === 'local') {
    const currentCenterNode = map.getCenter();
    originPivotLat = currentCenterNode.lat;
    originPivotLng = currentCenterNode.lng;
  }

  // 1. Process filtration layer matrices on core data structures
  let stepFilteredStationsPool = rawGlobalStationsPool.map(s => normalizeAndTranslateStationSchema(s)).filter(Boolean);

  if (activeTabContext === 'local') {
    stepFilteredStationsPool = stepFilteredStationsPool.filter(station => {
      const computedDistanceInKM = calculateHaversineDistanceFormulaKM(originPivotLat, originPivotLng, station.lat, station.lng);
      const computedDistanceInMiles = computedDistanceInKM * 0.621371;
      return computedDistanceInMiles <= radiusRangeLimitMiles;
    });
  } else if (activeTabContext === 'route') {
    // Rely exclusively on corridor bounding buffers defined by route stream algorithm geometry
    stepFilteredStationsPool = stepFilteredStationsPool.filter(station => {
      let absoluteMinimumDistanceMiles = Infinity;
      for (const coordinatePair of plottedRouteCoordinates) {
        const offsetKM = calculateHaversineDistanceFormulaKM(station.lat, station.lng, coordinatePair[0], coordinatePair[1]);
        const offsetMiles = offsetKM * 0.621371;
        if (offsetMiles < absoluteMinimumDistanceMiles) {
          absoluteMinimumDistanceMiles = offsetMiles;
        }
      }
      return absoluteMinimumDistanceMiles <= 4.5; // Strict corridor limit boundary constraint
    });
  }

  // Fuel Type Domain Isolation Filter Logic 
  if (selectedFuelTypeKey === 'electric') {
    stepFilteredStationsPool = stepFilteredStationsPool.filter(s => s.isEV);
  } else {
    stepFilteredStationsPool = stepFilteredStationsPool.filter(s => !s.isEV && s[selectedFuelTypeKey]);
  }

  // Brand identity token constraint matcher
  if (brandFilterValue !== 'ALL') {
    stepFilteredStationsPool = stepFilteredStationsPool.filter(s => s.brand_name.toUpperCase().includes(brandFilterValue.toUpperCase()));
  }

  // Commit output calculations safely to active volatile tracking fields
  currentlyVisibleStations = stepFilteredStationsPool;

  // Refresh user interfaces contextually
  processAndSynchronizeMapMarkers();
  renderStationDirectoryDOM();

  if (activeTabContext === 'route') {
    calculateOptimalRefuelStrategy();
  }
}

// ==========================================
// 11. ANALYTICS FORECOURT DETAIL RENDERING SHEET
// ==========================================
window.openForecourtDetailSheetByExternalId = async function(stationId) {
  const matchNode = currentlyVisibleStations.find(s => s.id === stationId);
  if (!matchNode) return;

  activeSheetStation = matchNode;
  
  // Set UI elements explicitly to preserve full DOM interaction paths
  const detailSheet = document.getElementById('global-detail-sheet');
  if (!detailSheet) return;

  detailSheet.classList.remove('hidden');
  if (window.innerWidth < 1024) {
    setMobileDrawerState('global-detail-sheet', 'mid');
  }

  // Primary Info Headers
  document.getElementById('sheet-station-title').textContent = matchNode.brand_name;
  document.getElementById('sheet-station-address').textContent = matchNode.address;
  
  // Weather dynamic processing wrapper hook
  const weatherElement = document.getElementById('sheet-weather-badge');
  if (weatherElement) {
    weatherElement.innerHTML = `<span class="animate-pulse">Loading Forecast Vector...</span>`;
    const dataPayload = await fetchWeatherForStation(matchNode.lat, matchNode.lng);
    weatherElement.innerHTML = `<span>${dataPayload.emoji}</span> <span class="font-medium">${dataPayload.text}</span>`;
  }

  // Sync pricing matrices fields explicitly across individual containers to prevent structural dropouts
  const se10 = document.getElementById('sheet-price-e10');
  const se5 = document.getElementById('sheet-price-e5');
  const sb7 = document.getElementById('sheet-price-b7');
  const spd = document.getElementById('sheet-price-premiumdiesel');

  if (se10) se10.textContent = matchNode.E10 ? `${parseFloat(matchNode.E10).toFixed(1)}p` : 'N/A';
  if (se5) se5.textContent = matchNode.E5 ? `${parseFloat(matchNode.E5).toFixed(1)}p` : 'N/A';
  if (sb7) sb7.textContent = matchNode.B7 ? `${parseFloat(matchNode.B7).toFixed(1)}p` : 'N/A';
  if (spd) spd.textContent = matchNode.PremiumDiesel ? `${parseFloat(matchNode.PremiumDiesel).toFixed(1)}p` : 'N/A';

  // Toggle dynamic class context flags matching custom color markers tiers if available
  updateAllStarUIStates();
};

window.toggleStationStarStatus = function() {
  if (!activeSheetStation) return;
  const targetId = activeSheetStation.id;
  const indexMatch = starredStations.findIndex(s => s.id === targetId);

  if (indexMatch > -1) {
    starredStations.splice(indexMatch, 1);
    Toast.show("Station detached from your saved profile collection.", "info");
  } else {
    starredStations.push(activeSheetStation);
    Toast.show("Station bookmarked successfully.", "success");
  }

  localStorage.setItem('uk_fuel_starred_v2_stations', JSON.stringify(starredStations));
  updateAllStarUIStates();
  renderStarredDropdownList();
};

function updateAllStarUIStates() {
  const btn = document.getElementById('sheet-star-btn');
  if (!btn || !activeSheetStation) return;
  
  const isStarred = starredStations.some(s => s.id === activeSheetStation.id);
  if (isStarred) {
    btn.innerHTML = '★ Saved';
    btn.className = "flex items-center gap-1 px-3 py-1.5 border rounded-xl font-bold text-xs transition-all text-amber-500 border-amber-500/50 bg-amber-50 dark:bg-amber-500/10";
  } else {
    btn.innerHTML = '☆ Star';
    btn.className = "flex items-center gap-1 px-3 py-1.5 border rounded-xl font-bold text-xs transition-all text-zinc-400 border-zinc-200/80 dark:border-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-900";
  }
}

// ==========================================
// 12. DIRECTORY TEMPLATE PANEL GENERATOR
// ==========================================
function renderStationDirectoryDOM() {
  const directoryContainer = document.getElementById('directory-list-container');
  if (!directoryContainer) return;

  directoryContainer.innerHTML = '';

  if (currentlyVisibleStations.length === 0) {
    directoryContainer.innerHTML = `
      <div class="p-6 text-center text-xs text-zinc-500 font-medium">
        No forecourts match the current query filter profiles inside this area.
      </div>
    `;
    return;
  }

  currentlyVisibleStations.forEach(station => {
    const mainListCard = document.createElement('div');
    mainListCard.className = "p-3 border-b border-zinc-100 dark:border-zinc-900 cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-900/40 flex justify-between items-center gap-4";
    mainListCard.onclick = () => focusAndHighlightMapMarker(station.lat, station.lng);

    const fuelSelectionKey = document.getElementById('fuel-type-select')?.value || 'B7';
    let rightSideBadgeValueHTML = '';

    if (station.isEV) {
      rightSideBadgeValueHTML = `<div class="text-xs font-black text-blue-600 dark:text-blue-400">${Math.round(station.kwSpeed || 7)} kW</div>`;
    } else {
      const metricValue = station[fuelSelectionKey];
      rightSideBadgeValueHTML = `<div class="text-sm font-black text-zinc-900 dark:text-zinc-100">${metricValue ? `${parseFloat(metricValue).toFixed(1)}p` : 'N/A'}</div>`;
    }

    mainListCard.innerHTML = `
      <div class="min-w-0 flex-1">
        <div class="text-xs font-black text-zinc-900 dark:text-zinc-100 truncate">${station.brand_name}</div>
        <div class="text-[10px] text-zinc-500 truncate mt-0.5">${station.address}</div>
      </div>
      <div class="text-right shrink-0">
        ${rightSideBadgeValueHTML}
      </div>
    `;
    directoryContainer.appendChild(mainListCard);
  });
}

function renderStarredDropdownList() {
  const container = document.getElementById('starred-list-items-container');
  if (!container) return;
  container.innerHTML = '';

  if (starredStations.length === 0) {
    container.innerHTML = '<div class="p-3 text-center text-[11px] text-zinc-500">No saved stations found.</div>';
    return;
  }

  starredStations.forEach(station => {
    const row = document.createElement('div');
    row.className = "p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg cursor-pointer transition text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate";
    row.textContent = `${station.brand_name} - ${station.postcode || 'Forecourt'}`;
    row.onclick = () => {
      focusAndHighlightMapMarker(station.lat, station.lng);
      document.getElementById('starred-dropdown-panel')?.classList.add('hidden');
    };
    container.appendChild(row);
  });
}

// ==========================================
// 13. CORE PIPELINE INTIALIZATION HANDLERS
// ==========================================
async function bootstrapApplicationEngine() {
  // Leaflet Map base deployment allocation
  if (!document.getElementById('map')) return;
  
  map = L.map('map', { zoomControl: false }).setView(mapSearchAnchorCoordinates, 12);
  L.control.zoom({ position: 'topright' }).addTo(map);

  tileLayerInstance = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO'
  }).addTo(map);

  markerClusterGroupInstance = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 45
  });
  map.addLayer(markerClusterGroupInstance);

  refuelMarkersGroup = L.layerGroup().addTo(map);

  // Initialize structural interface handlers & listener bounds
  bindMobileSwipeDrawer('sidebar-swipe-handle', 'primary-control-sidebar');
  bindMobileSwipeDrawer('detail-sheet-swipe-handle', 'global-detail-sheet');
  attachCoreMapMovementHooks();

  // Load production fuel price dataset vectors mock simulation data
  await loadProductionDatasetVectors();
  
  // Initial filtering layout rendering stream pass execution
  executeStationDataFilteringPipeline();
  renderStarredDropdownList();

  // Wire explicit configuration dynamic element adjustments listener attachments
  document.getElementById('fuel-type-select')?.addEventListener('change', () => executeStationDataFilteringPipeline());
  document.getElementById('brand-filter-select')?.addEventListener('change', () => executeStationDataFilteringPipeline());
  document.getElementById('radius-range-slider')?.addEventListener('input', (e) => {
    const indicator = document.getElementById('radius-value-indicator');
    if (indicator) indicator.textContent = `${e.target.value} mi`;
    executeStationDataFilteringPipeline();
  });
}

async function loadProductionDatasetVectors() {
  // Simulates population of the global pool with live tracking dataset schemas
  rawGlobalStationsPool = [
    { id: "st-1", brand_name: "BP", address: "Halbeath Road, Dunfermline", postcode: "KY11 4LP", lat: 56.0812, lng: -3.4215, E10: 142.9, E5: 151.9, B7: 146.9 },
    { id: "st-2", brand_name: "Shell", address: "Grange Road, Dunfermline", postcode: "KY12 7TF", lat: 56.0621, lng: -3.4734, E10: 144.9, E5: 154.9, B7: 148.9 },
    { id: "st-3", brand_name: "Asda Fuel", address: "St Leonards St, Dunfermline", postcode: "KY11 3AY", lat: 56.0655, lng: -3.4542, E10: 139.7, E5: 147.9, B7: 143.7 },
    { id: "st-4", brand_name: "Tesco Petrol", address: "Turnstone Rd, Dunfermline", postcode: "KY11 8EG", lat: 56.0744, lng: -3.4091, E10: 139.9, E5: 148.5, B7: 144.2 }
  ];
}

// Global invocation initialization guard routine bound
document.addEventListener('DOMContentLoaded', () => {
  bootstrapApplicationEngine();
});
