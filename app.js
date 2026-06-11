// GLOBAL CONFIGURATIONS & API KEYS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3TTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';
const TOMTOM_API_KEY = 'JY2i0gGmgtYakfiO1T3XOobPhgkGpFC6';

// Initialize Leaflet Map Object Instance 
const map = L.map('map', { zoomControl: false }).setView([56.0716, -3.4523], 12); 
L.control.zoom({ position: 'topright' }).addTo(map);

const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap contributors' 
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
        attribution: '© OpenStreetMap, © CartoDB' 
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        attribution: 'Tiles © Esri' 
    })
};

// Default Theme Injection
themes.light.addTo(map);

// Global State Pools
let rawGlobalStationsPool = [];
let currentlyVisibleStations = [];
let starredStations = [];
let savedRoutes = [];
let userLocation = null;
let currentMode = 'local'; // 'local' or 'route'
let chosenFuelType = 'price_e10';
let mpgValue = 45;
let filterUnleadedOnly = false;
let lastSavedRouteData = null;
let searchByAreaActive = false;

// Layer Group Singletons
const markerClusterGroupInstance = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
});
map.addLayer(markerClusterGroupInstance);

let routePolylineLayer = null;

// Local Storage Hydration
try {
    const loadedStarred = localStorage.getItem('uk_fuel_starred_v2_stations');
    const loadedRoutes = localStorage.getItem('uk_fuel_saved_v2_routes');
    if (loadedStarred) starredStations = JSON.parse(loadedStarred);
    if (loadedRoutes) savedRoutes = JSON.parse(loadedRoutes);
} catch (e) {
    console.error("Local storage restoration interrupted:", e);
}

// Universal Station ID Resolver
function getStationId(station) {
    if (!station) return null;
    if (station.site_id) return String(station.site_id);
    if (station.id) return String(station.id);
    if (station.uuid) return String(station.uuid);
    return `${station.latitude || station.lat},${station.longitude || station.lng}`;
}

// Haversine Distance Formula (Miles Conversion)
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// High-Speed Price Metric Extractor
function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'e10').toLowerCase().replace(/[^a-z0-9]/g, '');
    let val = NaN;

    if (target.includes('e10')) {
        val = parseFloat(station.E10 || station.e10);
    } else if (target.includes('e5')) {
        val = parseFloat(station.E5 || station.e5);
    } else if (target.includes('b7p') || target.includes('premium')) {
        val = parseFloat(station.B7P || station.b7p);
    } else if (target.includes('diesel') || target.includes('b7')) {
        val = parseFloat(station.B7 || station.b7);
    }

    if (!isNaN(val) && val > 0) return val;
    return NaN;
}

function getCoordinates(station) {
  const lat = parseFloat(station.latitude || station.lat || station.Latitude);
  const lon = parseFloat(station.longitude || station.lon || station.lng || station.Longitude || station.Lng);
  
  if (!isNaN(lat) && !isNaN(lon)) {
    return { lat: lat, lon: lon };
  }
  return null;
}

// Pricing Tier Styling Assignment
function assignPricingTierColorStyles(price, fuelType) {
    if (!price || isNaN(price)) {
        return 'bg-zinc-50 border-zinc-200 text-zinc-400 dark:bg-zinc-900/50 dark:border-zinc-800';
    }
    
    // Compute stats from active visible set to dynamically match cheap/expensive thresholds
    const relevantPrices = currentlyVisibleStations
        .map(s => extractPriceByMetricType(s, fuelType))
        .filter(p => !isNaN(p));

    if (relevantPrices.length === 0) {
        return 'bg-zinc-50 border-zinc-200 text-zinc-700 dark:bg-zinc-900/50 dark:border-zinc-800 dark:text-zinc-300';
    }

    const minPrice = Math.min(...relevantPrices);
    const maxPrice = Math.max(...relevantPrices);
    const range = maxPrice - minPrice;

    if (range === 0) {
        return 'bg-zinc-50 border-zinc-200 text-zinc-700 dark:bg-zinc-900/50 dark:border-zinc-800';
    }

    const lowerThird = minPrice + (range / 3);
    const upperThird = maxPrice - (range / 3);

    if (price <= lowerThird) {
        return 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400';
    } else if (price >= upperThird) {
        return 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-400';
    }
    return 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400';
}

// Browser-Native GZIP Decompression Hydrator
async function fetchLiveGovStationData() {
    try {
        const response = await fetch(PROXY_WORKER_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`Edge worker proxy returned execution error state: ${response.status}`);
        }

        // The browser automatically handles "Content-Encoding: gzip" decompression!
        const jsonPayload = await response.json();
        
        rawGlobalStationsPool = jsonPayload.data || jsonPayload.stations || jsonPayload;
        console.log(`Successfully populated global pool with ${rawGlobalStationsPool.length} stations.`);
        return rawGlobalStationsPool;

    } catch (error) {
        console.error("Worker extraction processing fault:", error);
        showNotificationToast("Failed to fetch live fuel stream data.", "error");
        return [];
    }
}

// Render Local Forecourt System Markers
function filterFuelStationsLocalMode() {
    currentMode = 'local';
    if (rawGlobalStationsPool.length === 0) return;

    const bounds = map.getBounds();
    const fuelBox = document.getElementById('fuelType');
    chosenFuelType = fuelBox ? fuelBox.value : 'price_e10';
    
    const unleadedFilterBox = document.getElementById('filterUnleaded');
    filterUnleadedOnly = unleadedFilterBox ? unleadedFilterBox.checked : false;

    // Filter by geographic visibility window
    currentlyVisibleStations = rawGlobalStationsPool.filter(station => {
        const coords = getCoordinates(station);
        if (!coords) return false;

        const insideBounds = bounds.contains([coords.lat, coords.lon]);
        if (!insideBounds) return false;

        if (filterUnleadedOnly) {
            const e10 = extractPriceByMetricType(station, 'price_e10');
            if (isNaN(e10)) return false;
        }

        const priceCheck = extractPriceByMetricType(station, chosenFuelType);
        return !isNaN(priceCheck);
    });

    renderStationsToClusterLayer();
}

// Core Rendering Engine
function renderStationsToClusterLayer() {
    markerClusterGroupInstance.clearLayers();

    currentlyVisibleStations.forEach(station => {
        const coords = getCoordinates(station);
        if (!coords) return;
        
        const price = extractPriceByMetricType(station, chosenFuelType);

        let colorClass = 'bg-zinc-500';
        const relevantPrices = currentlyVisibleStations.map(s => extractPriceByMetricType(s, chosenFuelType)).filter(p => !isNaN(p));
        if (relevantPrices.length > 0) {
            const min = Math.min(...relevantPrices);
            const max = Math.max(...relevantPrices);
            const range = max - min;
            if (range > 0) {
                if (price <= min + (range / 3)) colorClass = 'bg-fuel-green text-white font-bold';
                else if (price >= max - (range / 3)) colorClass = 'bg-fuel-red text-white font-bold';
                else colorClass = 'bg-fuel-blue text-white font-bold';
            } else {
                colorClass = 'bg-fuel-blue text-white font-bold';
            }
        }

        const customMarkerIcon = L.divIcon({
            className: 'leaflet-div-icon-reset',
            html: `<div class="fuel-marker-bubble ${colorClass} px-2 py-1 rounded-lg text-xs shadow-md border border-white/20 whitespace-nowrap font-black">
                    ${price.toFixed(1)}p
                   </div>`,
            iconSize: [45, 25],
            iconAnchor: [22, 12]
        });

        const markerInstance = L.marker([coords.lat, coords.lon], { icon: customMarkerIcon });
        
        markerInstance.on('click', () => {
            presentStationBottomSheet(station);
        });

        markerClusterGroupInstance.addLayer(markerInstance);
    });
}

// Hydrate Bottom Sheet Overlay Details
function presentStationBottomSheet(station) {
    const titleElem = document.getElementById('sheet-title');
    const brandElem = document.getElementById('sheet-brand');
    const addrElem = document.getElementById('sheet-address');

    if (titleElem) titleElem.textContent = station.brand || "Independent Forecourt";
    if (brandElem) brandElem.textContent = `Network: ${station.brand || 'Unbranded'}`;
    if (addrElem) addrElem.textContent = station.site_address || station.address || "No Address Provided";

    // Update prices & wrapper cards dynamic color states
    const pE10 = extractPriceByMetricType(station, 'price_e10');
    const pE5 = extractPriceByMetricType(station, 'price_e5');
    const pB7 = extractPriceByMetricType(station, 'price_b7');
    const pB7P = extractPriceByMetricType(station, 'price_premium_diesel');

    const ce10 = document.getElementById('card-wrap-e10'); if(ce10) ce10.className = `border p-2 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(pE10, 'price_e10')}`;
    const ce5 = document.getElementById('card-wrap-e5'); if(ce5) ce5.className = `border p-2 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(pE5, 'price_e5')}`;
    const cb7 = document.getElementById('card-wrap-b7'); if(cb7) cb7.className = `border p-2 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(pB7, 'price_b7')}`;
    const cpd = document.getElementById('card-wrap-premiumdiesel'); if(cpd) cpd.className = `border p-2 rounded-xl text-center transition-all duration-200 ${assignPricingTierColorStyles(pB7P, 'price_premium_diesel')}`;

    const se10 = document.getElementById('sheet-price-e10'); if(se10) se10.textContent = !isNaN(pE10) ? `${pE10.toFixed(1)}p` : 'N/A';
    const se5 = document.getElementById('sheet-price-e5'); if(se5) se5.textContent = !isNaN(pE5) ? `${pE5.toFixed(1)}p` : 'N/A';
    const sb7 = document.getElementById('sheet-price-b7'); if(sb7) sb7.textContent = !isNaN(pB7) ? `${pB7.toFixed(1)}p` : 'N/A';
    const spd = document.getElementById('sheet-price-premiumdiesel'); if(spd) spd.textContent = !isNaN(pB7P) ? `${pB7P.toFixed(1)}p` : 'N/A';

    // Show slide up wrapper element
    const container = document.getElementById('station-bottom-sheet');
    if (container) {
        container.classList.remove('translate-y-full');
        container.classList.add('translate-y-0');
    }
}

// Proximity Route Interpolation Engine
async function requestAdvancedPolylineRoute(startPointStr, endPointStr) {
    try {
        showNotificationToast("Calculating route vector traces...", "info");
        
        const startGeo = await searchProvider.search({ query: startPointStr });
        const endGeo = await searchProvider.search({ query: endPointStr });

        if (!startGeo || startGeo.length === 0 || !endGeo || endGeo.length === 0) {
            throw new Error("Could not resolve tracking anchors for addresses.");
        }

        const lon1 = startGeo[0].x; const lat1 = startGeo[0].y;
        const lon2 = endGeo[0].x; const lat2 = endGeo[0].y;

        const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${lon1},${lat1}&end=${lon2},${lat2}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Routing engine returned code block error.");

        const data = await response.json();
        lastSavedRouteData = data.features[0].geometry.coordinates; // Arrays of [lon, lat]
        
        plotRoutePolylineOnMap(lastSavedRouteData);
        filterFuelStationsRouteMode(lastSavedRouteData);
    } catch (e) {
        console.error("Routing loop failure:", e);
        showNotificationToast("Failed to compile route path coordinates.", "error");
    }
}

function plotRoutePolylineOnMap(coordinatesArray) {
    if (routePolylineLayer) map.removeLayer(routePolylineLayer);

    const latLngs = coordinatesArray.map(pt => [pt[1], pt[0]]);
    routePolylineLayer = L.polyline(latLngs, { color: '#3b82f6', weight: 5, opacity: 0.85 });
    routePolylineLayer.addTo(map);
    map.fitBounds(routePolylineLayer.getBounds(), { padding: [30, 30] });
}

// Filter the full global set down to stations near the polyline path
function filterFuelStationsRouteMode(routeCoords) {
    currentMode = 'route';
    const maxDetourDistanceMiles = 2.0;

    const fuelBox = document.getElementById('fuelType');
    chosenFuelType = fuelBox ? fuelBox.value : 'price_e10';

    const mpgInput = document.getElementById('mpg');
    mpgValue = mpgInput ? parseFloat(mpgInput.value) || 45 : 45;

    currentlyVisibleStations = rawGlobalStationsPool.filter(station => {
        const coords = getCoordinates(station);
        if (!coords) return false;

        const priceCheck = extractPriceByMetricType(station, chosenFuelType);
        if (isNaN(priceCheck)) return false;

        // Proximity optimization checks
        for (let i = 0; i < routeCoords.length; i += 3) { 
            const dist = calculateHaversineDistance(coords.lat, coords.lon, routeCoords[i][1], routeCoords[i][0]);
            if (dist <= maxDetourDistanceMiles) return true;
        }
        return false;
    });

    renderStationsToClusterLayer();
    showNotificationToast(`Discovered ${currentlyVisibleStations.length} optimal stops along journey.`, "success");
}

// Toast Notification Pipeline
function showNotificationToast(msg, level = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast bg-white/90 dark:bg-zinc-950/90 text-zinc-900 dark:text-zinc-50 border shadow-xl p-3 rounded-xl flex items-center gap-2 transform transition-all duration-300 translate-y-[-20px] opacity-0`;
    
    let indicator = "ℹ️";
    if (level === 'success') indicator = "✅";
    if (level === 'error') indicator = "🚨";

    toast.innerHTML = `<span>${indicator}</span><span class="text-xs font-bold">${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-[-20px]', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    }, 50);

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-20px]');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Event Hooks & Dynamic Lifecycle Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Fire up async streams
    await fetchLiveGovStationData();

    document.getElementById('fuelType')?.addEventListener('change', () => refreshActiveDataView());
    document.getElementById('mpg')?.addEventListener('input', () => refreshActiveDataView());
    document.getElementById('filterUnleaded')?.addEventListener('change', () => refreshActiveDataView());

    // Setup dynamic dismiss listener for the UI bottom panel
    document.addEventListener('click', (e) => {
        const sheet = document.getElementById('station-bottom-sheet');
        if (sheet && !sheet.contains(e.target) && !e.target.closest('.leaflet-marker-icon') && !e.target.closest('.fuel-marker-bubble')) {
            sheet.classList.remove('translate-y-0');
            sheet.classList.add('translate-y-full');
        }
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
                map.setView([userLocation.lat, userLocation.lon], 12); 
                setTimeout(() => { filterFuelStationsLocalMode(); }, 200);
            },
            function() { 
                setTimeout(() => { filterFuelStationsLocalMode(); }, 200); 
            },
            { timeout: 5000 }
        );
    } else {
        filterFuelStationsLocalMode();
    }
});

map.on('moveend', function() {
    if (currentMode === 'local' && !searchByAreaActive) {
        filterFuelStationsLocalMode();
    }
});

function refreshActiveDataView() {
    if (currentMode === 'local') filterFuelStationsLocalMode();
    else if (currentMode === 'route' && lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

function debounce(func, delay) { 
    let timeout; 
    return function(...args) { 
        clearTimeout(timeout); 
        timeout = setTimeout(() => func.apply(this, args), delay); 
    }; 
}
