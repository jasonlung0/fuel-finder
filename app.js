// GLOBAL CONFIGURATIONS & API KEYS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

// FIXED: Initialize window bucket immediately. DO NOT redeclare map locally using 'let map' 
// if uiapp.js defines it top-level. Instead, assign directly to window scope dynamically.
window.rawGlobalStationsPool = window.rawGlobalStationsPool || [];

const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0' }
});

// Lazily assign tilesets on demand to avoid initialization sequence blocks
const themes = {
    light: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
    dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CartoDB' }),
    satellite: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = null;

let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = null; // initialized safely once map exists
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = { lat: 56.0716, lon: -3.4523 }; 
let searchByAreaActive = false;

// Helper to access the unified global map without closure scope isolation
function getActiveMap() {
    return window.map || (typeof map !== 'undefined' ? map : null);
}

// Safely configure overlay groups once Leaflet finishes initial boot
function enforceMarkerGroupContext() {
    const targetMap = getActiveMap();
    if (targetMap && !stationMarkers) {
        stationMarkers = L.layerGroup().addTo(targetMap);
    }
    return stationMarkers;
}

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggleIcon');
    const targetMap = getActiveMap();
    if (!sidebar || !icon) return;
    
    sidebar.classList.toggle('collapsed');
    icon.innerText = sidebar.classList.contains('collapsed') ? "→" : "←";
    
    if (targetMap) {
        setTimeout(() => { targetMap.invalidateSize(); }, 360);
    }
};

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
    searchByAreaActive = false;
    const targetMap = getActiveMap();
    
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.getElementById('local-tab').classList.add('active');
        const localBtn = document.querySelector("button[onclick*='local-tab']");
        if (localBtn) localBtn.classList.add('active');
        if (tabRadius) tabRadius.classList.add('hidden');
        if (tabCost) tabCost.classList.add('hidden');
        if (routeLayer && targetMap) targetMap.removeLayer(routeLayer);
        filterFuelStationsLocalMode();
    } else {
        currentMode = 'route';
        document.getElementById('route-tab').classList.add('active');
        const routeBtn = document.querySelector("button[onclick*='route-tab']");
        if (routeBtn) routeBtn.classList.add('active');
        if (tabRadius) tabRadius.classList.remove('hidden');
        if (lastSavedRouteData) {
            if (routeLayer && targetMap && !targetMap.hasLayer(routeLayer)) routeLayer.addTo(targetMap);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            const markers = enforceMarkerGroupContext();
            if (markers) markers.clearLayers();
            const container = document.getElementById('topStationsContainer');
            if (container) container.classList.add('hidden');
        }
    }
};

window.changeMapTheme = function(themeName) {
    const targetMap = getActiveMap();
    if (!targetMap) return;
    if (activeTheme) targetMap.removeLayer(activeTheme);
    activeTheme = themes[themeName] ? themes[themeName]() : themes.light();
    activeTheme.addTo(targetMap);
};

window.updateRadiusLabel = function(val) {
    const el = document.getElementById('radiusVal');
    if (el) el.innerText = val;
    if (lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
};

window.updateLocalRadiusLabel = function(val) {
    searchByAreaActive = false;
    const el = document.getElementById('localRadiusVal');
    if (el) el.innerText = val;
    filterFuelStationsLocalMode();
};

window.searchThisArea = function() {
    const targetMap = getActiveMap();
    if (!targetMap) return;
    searchByAreaActive = true;
    const mapCenter = targetMap.getCenter();
    const status = document.getElementById('status');
    if (status) status.innerText = "Scanning visible viewport...";
    userLocation = { lat: mapCenter.lat, lon: mapCenter.lng };
    filterFuelStationsLocalMode();
};

// =========================================================================
// FIXED DATATYPE AND COLUMN PARSERS
// =========================================================================

// Fixed coordinate lookup to match the clean flat payload generated by your Worker scraper
function getCoordinates(station) {
    const lat = parseFloat(station.latitude || station.lat);
    const lon = parseFloat(station.longitude || station.lng);
    
    if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lon };
    }
    return null;
}

// Fixed pricing extractor logic to match flat keys and bypass case sensitivity crashes
function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'E10').toLowerCase();
    let val = NaN;

    if (target.includes('e10')) {
        val = parseFloat(station.E10 || station.price_e10 || station.e10);
    } else if (target.includes('e5')) {
        val = parseFloat(station.E5 || station.price_e5 || station.e5);
    } else if (target.includes('premium') || target.includes('b7p')) {
        val = parseFloat(station.B7P || station.PremiumDiesel || station.b7p);
    } else if (target.includes('diesel') || target.includes('b7')) {
        val = parseFloat(station.B7 || station.price_diesel || station.b7);
    }

    return (!isNaN(val) && val > 0) ? val : NaN;
}

// =========================================================================
// ASYNC REMOTE TELEMETRY LOGIC PIPELINE
// =========================================================================

// FIXED: Explicitly maps incoming proxy stream buffer straight to browser window memory scope
window.forceReloadRemotePipelineData = async function() {
    const status = document.getElementById('status');
    if (status) status.innerText = "Connecting to GOV.UK telemetry stream...";
    
    try {
        const response = await fetch(PROXY_WORKER_URL);
        if (!response.ok) throw new Error(`HTTP network error: Status ${response.status}`);
        
        const data = await response.json();
        
        // Save precisely to window target context so uiapp.js filtering can find it
        window.rawGlobalStationsPool = Array.isArray(data) ? data : (data.stations || data.data || []);
        
        console.log(`Telemetry synchronized. Saved ${window.rawGlobalStationsPool.length} stations to memory.`);
        if (status) status.innerText = `Live: ${window.rawGlobalStationsPool.length} fuel stations synchronized`;
        
        // Execute UI compilation pipeline now that data array has loaded
        if (typeof window.executeStationDataFilteringPipeline === 'function') {
            window.executeStationDataFilteringPipeline();
        } else if (currentMode === 'local') {
            filterFuelStationsLocalMode();
        }
    } catch (err) {
        console.error("Data pipeline processing failure:", err);
        if (status) status.innerText = "Offline Data Buffer Frame";
    }
};

async function filterFuelStationsLocalMode() {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        processAndRenderStations(stations, null);
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.innerText = "Telemetry lookup error.";
    }
}

async function filterFuelStationsRouteMode(routeData) {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        const selectedRadiusMiles = parseFloat(document.getElementById('bufferRadius').value || 2);
        const radiusInKm = selectedRadiusMiles * 1.60934;
        
        const corridor = turf.buffer(routeData.features[0], radiusInKm, {units: 'kilometers'});
        processAndRenderStations(stations, corridor);
    } catch (err) {
        console.error(err);
        if (statusEl) statusEl.innerText = "Telemetry lookup error.";
    }
}

// Vector Engine: High-fidelity inline SVGs for major UK filling station brands
function getBrandLogoVector(brandName) {
    if (!brandName) return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#64748b"/></svg>`;
    const name = brandName.toLowerCase();
    
    if (name.includes("bp")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#00A651"/><path d="M50 5 L55 35 L85 30 L63 50 L85 70 L55 65 L50 95 L45 65 L15 70 L37 50 L15 30 L45 35 Z" fill="#FFF200"/></svg>`;
    }
    if (name.includes("shell")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M50 5 C20 5 10 35 10 65 C10 85 30 95 50 95 C70 95 90 85 90 65 C90 35 80 5 50 5 Z" fill="#FFD500" stroke="#FF0000" stroke-width="6"/><path d="M25 65 L35 90 M50 60 L50 90 M75 65 L65 90" stroke="#FF0000" stroke-width="5"/></svg>`;
    }
    if (name.includes("esso")) {
        return `<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><ellipse cx="50" cy="25" rx="46" ry="22" fill="#E21B23" stroke="#0033A0" stroke-width="3"/><text x="50" y="33" font-family="Arial, sans-serif" font-weight="900" font-size="24" fill="#FFFFFF" text-anchor="middle">Esso</text></svg>`;
    }
    if (name.includes("texaco")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="#E21B23"/><polygon points="50,15 60,40 88,40 65,58 75,85 50,68 25,85 35,58 12,40 40,40" fill="#FFFFFF"/><text x="50" y="58" font-family="sans-serif" font-weight="900" font-size="20" fill="#000" text-anchor="middle">T</text></svg>`;
    }
    if (name.includes("jet")) {
        return `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="60" rx="8" fill="#FFD500"/><ellipse cx="50" cy="30" rx="42" ry="22" fill="#0033A0"/><text x="50" y="38" font-family="Impact, Arial" font-weight="900" font-size="24" fill="#FFD500" text-anchor="middle">JET</text></svg>`;
    }
    if (name.includes("gulf")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="#0033A0"/><circle cx="50" cy="50" r="34" fill="#FF6600"/><ellipse cx="50" cy="50" rx="30" ry="18" fill="#FFFFFF"/><text x="50" y="56" font-family="sans-serif" font-weight="900" font-size="18" fill="#0033A0" text-anchor="middle">Gulf</text></svg>`;
    }
    if (name.includes("tesco")) {
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="40" fill="#FFFFFF"/><text x="50" y="26" font-family="Helvetica, Arial" font-weight="900" font-size="22" fill="#EE1C2E" text-anchor="middle">TESCO</text><rect x="10" y="32" width="80" height="4" fill="#00539B"/></svg>`;
    }
    if (name.includes("asda")) {
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="40" rx="6" fill="#78BE20"/><text x="50" y="28" font-family="sans-serif" font-weight="900" font-size="22" fill="#FFFFFF" text-anchor="middle">ASDA</text></svg>`;
    }
    if (name.includes("morrison")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="#004A32"/><circle cx="50" cy="40" r="12" fill="#FFC72C"/><path d="M40 65 L50 45 L60 65 Z" fill="#FFC72C"/></svg>`;
    }
    if (name.includes("sainsbury")) {
        return `<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><text x="50" y="28" font-family="sans-serif" font-weight="900" font-size="16" fill="#E06100" text-anchor="middle">Sainsbury's</text></svg>`;
    }
    if (name.includes("applegreen")) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="#005A36"/><path d="M30 50 Q50 20 70 50 Q50 80 30 50 Z" fill="#81B622"/></svg>`;
    }

    // Default Fallback Fuel Icon Container
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 12h-2v-2h2v2zm-2-4h2V6h-2v2zm3-5H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V12h2c1.66 0 3-1.34 3-3V7c0-2.21-1.79-4-4-4zm-4 15H4V5h10v13zm4-7c-.55 0-1-.45-1-1V7c0-.55.45-1 1-1s1 .45 1 1v3c0 .55-.45 1-1 1z" fill="#475569"/></svg>`;
}

function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;
    const localRadiusLimit = parseFloat(document.getElementById('localRadiusSlider').value || 5);

    stationMarkers.clearLayers();
    let eligibleStations = [];
    currentlyFilteredStations = [];
    
    const listEl = document.getElementById('topStationsList');
    if (listEl) listEl.innerHTML = '';
    
    let cheapestPriceFound = Infinity;
    const bounds = map.getBounds();

    if (!Array.isArray(stationsArray)) {
        console.error("Data received is not an iterable array:", stationsArray);
        if (statusDiv) statusDiv.innerText = "Telemetry array parse error.";
        return;
    }

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        station.brand = station['forecourts.brand_name'] || station.brand || "Independent";
        station.address = station['forecourts.address_line_1'] || station['forecourts.location.address_line_1'] || station.address || station.Address || "";

        if (requiresUnleaded) {
            const hasE10 = extractPriceByMetricType(station, 'price_e10');
            if (isNaN(hasE10)) return; 
        }

        if (spatialBufferPolygon) {
            if (!turf.booleanPointInPolygon(turf.point([coords.lon, coords.lat]), spatialBufferPolygon)) return;
        } else {
            // FIX: If bounds are not fully initialized, skip the strict bounds filter so markers actually paint on initial load
            if (bounds && bounds.isValid() && !bounds.contains([coords.lat, coords.lon])) return;
        }
        
        if (currentMode === 'local' && userLocation) {
            station.calculatedDistance = calculateDistanceInMiles(userLocation.lat, userLocation.lon, coords.lat, coords.lon);
            const activeRangeCap = searchByAreaActive ? 50 : localRadiusLimit;
            if (station.calculatedDistance > activeRangeCap) return;
        }
        eligibleStations.push(station);
    });

    const slicedStationsList = eligibleStations.slice(0, 150);

    slicedStationsList.forEach(function(station) {
        const coords = getCoordinates(station);
        const e10Price = extractPriceByMetricType(station, 'price_e10');
        const b7Price = extractPriceByMetricType(station, 'price_diesel'); 
        const e5Price = extractPriceByMetricType(station, 'price_e5');
        const b7pPrice = extractPriceByMetricType(station, 'price_premium_diesel');

        const currentSelectedPrice = extractPriceByMetricType(station, chosenFuelType);
        if (!isNaN(currentSelectedPrice)) {
            station.currentFilterPrice = currentSelectedPrice;
            if (currentSelectedPrice < cheapestPriceFound) cheapestPriceFound = currentSelectedPrice;
        } else {
            station.currentFilterPrice = Infinity;
        }

        currentlyFilteredStations.push(station);

        const badgeValue = !isNaN(currentSelectedPrice) ? currentSelectedPrice : e10Price;
        const labelText = (!isNaN(badgeValue)) ? badgeValue.toFixed(1) + 'p' : 'N/A';
        
        const color = getMarkerColor(badgeValue);
        const vectorLogo = getBrandLogoVector(station.brand);

        // Single-line layout generation using structural flex wrappers
        const icon = L.divIcon({
            className: 'custom-leaflet-pill-marker',
            html: `
                <div class="inline-fuel-badge" style="background-color: ${color};">
                    <div class="marker-logo-container">
                        ${vectorLogo}
                    </div>
                    <span>${labelText}</span>
                </div>
            `,
            iconSize: [92, 28],
            iconAnchor: [46, 14]
        });

        L.marker([coords.lat, coords.lon], { icon: icon }).on('click', function() {
            displayiOSModalSheet(station, coords, e10Price, b7Price, e5Price, b7pPrice);
        }).addTo(stationMarkers);
    });

    if (statusDiv) statusDiv.innerText = `Forecourts displayed: ${slicedStationsList.length} rows.`;

    if (currentlyFilteredStations.length > 0) {
        const sortedList = [...currentlyFilteredStations].filter(s => s.currentFilterPrice !== Infinity).sort((a,b) => a.currentFilterPrice - b.currentFilterPrice);
        sortedList.slice(0, 3).forEach(function(stn) {
            const c = getCoordinates(stn);
            const distanceString = (stn.calculatedDistance !== undefined) ? ` (${stn.calculatedDistance.toFixed(1)} mi)` : '';
            const li = document.createElement('li'); 
            li.className = "cursor-pointer py-1.5 border-b border-slate-100 last:border-none hover:bg-slate-50 transition-colors rounded text-xs px-2 flex justify-between items-center text-slate-700";
            li.innerHTML = `<span class="font-medium">${stn.brand}${distanceString}</span> <span class="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">${stn.currentFilterPrice.toFixed(1)}p</span>`;
            li.onclick = () => { map.flyTo([c.lat, c.lon], 14); };
            
            if (listEl) listEl.appendChild(li);
        });
        
        const topContainer = document.getElementById('topStationsContainer');
        if (topContainer) {
            if(sortedList.length > 0) topContainer.classList.remove('hidden');
            else topContainer.classList.add('hidden');
        }

        if (currentMode === 'route' && lastSavedRouteData) {
            const miles = lastSavedRouteData.features[0].properties.summary.distance / 1609.34;
            const cost = ((miles / (parseFloat(document.getElementById('mpg').value) || 45)) * 4.54609) * (cheapestPriceFound / 100);
            
            const sumDist = document.getElementById('summaryDistance');
            const sumCost = document.getElementById('summaryCost');
            if (sumDist) sumDist.innerText = miles.toFixed(1);
            if (sumCost) sumCost.innerText = '£' + (isFinite(cost) && cheapestPriceFound !== Infinity ? cost.toFixed(2) : '0.00');
            
            const costSumCont = document.getElementById('costSummary');
            if (costSumCont) costSumCont.classList.remove('hidden');
        }
    }
}

function displayiOSModalSheet(station, coords, e10, b7, e5, b7p) {
    document.getElementById('sheetBrand').innerText = station.brand;
    const targetAddress = station.address || station.Address;
    document.getElementById('sheetAddress').innerText = targetAddress || `Forecourt Coordinates: [${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}]`;
    
    document.getElementById('sheetE10').innerText = (!isNaN(e10)) ? e10.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = (!isNaN(b7)) ? b7.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = (!isNaN(e5)) ? e5.toFixed(1) + 'p' : 'N/A';

    applyBoxPricingColor('boxE10', 'labelE10', 'sheetE10', e10);
    applyBoxPricingColor('boxB7', 'labelB7', 'sheetB7', b7);
    applyBoxPricingColor('boxE5', 'labelE5', 'sheetE5', e5);

    const premiumEl = document.getElementById('sheetB7P');
    if (premiumEl) {
        premiumEl.innerText = (!isNaN(b7p)) ? b7p.toFixed(1) + 'p' : 'N/A';
        applyBoxPricingColor('boxB7P', 'labelB7P', 'sheetB7P', b7p);
    }

    const backdrop = document.getElementById('iosModalBackdrop');
    const sheet = document.getElementById('stationDetailSheet');
    if(!backdrop || !sheet) return;
    backdrop.style.display = 'flex';
    setTimeout(() => { backdrop.style.opacity = '1'; sheet.style.transform = 'translateY(0)'; }, 10);
}

function applyBoxPricingColor(boxId, labelId, textId, price) {
    const boxEl = document.getElementById(boxId);
    const labelEl = document.getElementById(labelId);
    const textEl = document.getElementById(textId);
    if (!boxEl || !labelEl || !textEl) return;

    if (!price || isNaN(price)) {
        boxEl.style.backgroundColor = '#f8fafc';
        boxEl.style.borderColor = '#e2e8f0';
        labelEl.style.color = '#94a3b8';
        textEl.style.color = '#0f172a';
        return;
    }

    const targetColor = getMarkerColor(price);

    if (targetColor === '#10b981') { 
        boxEl.style.backgroundColor = '#f0fdf4';
        boxEl.style.borderColor = '#bbf7d0';
        labelEl.style.color = '#16a34a';
        textEl.style.color = '#14532d';
    } else if (targetColor === '#3b82f6') { 
        boxEl.style.backgroundColor = '#eff6ff';
        boxEl.style.borderColor = '#bfdbfe';
        labelEl.style.color = '#2563eb';
        textEl.style.color = '#1e3a8a';
    } else { 
        boxEl.style.backgroundColor = '#fef2f2';
        boxEl.style.borderColor = '#fecaca';
        labelEl.style.color = '#dc2626';
        textEl.style.color = '#7f1d1d';
    }
}

// Fix coordinate lookups to read flat attributes sent by your Worker scraper
function getCoordinates(station) {
    const lat = parseFloat(station.latitude || station.lat);
    const lon = parseFloat(station.longitude || station.lng);
    
    if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lon };
    }
    return null;
}

// Fix pricing extraction to prevent case-sensitive mismatches
function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'price_e10').toLowerCase();
    let val = NaN;

    if (target.includes('e10')) {
        val = parseFloat(station.E10 || station.price_e10 || station.e10);
    } else if (target.includes('e5')) {
        val = parseFloat(station.E5 || station.price_e5 || station.e5);
    } else if (target.includes('premium') || target.includes('b7p')) {
        val = parseFloat(station.B7P || station.PremiumDiesel || station.b7p);
    } else if (target.includes('diesel') || target.includes('b7')) {
        val = parseFloat(station.B7 || station.price_diesel || station.b7);
    }

    return (!isNaN(val) && val > 0) ? val : NaN;
}


function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295; 
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p)/2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
    return 7918 * Math.asin(Math.sqrt(a)); 
}

// Custom range specifications: 150.9 - 156.8 Green | 156.9 - 162.8 Blue | 162.9+ Red
function getMarkerColor(p) { 
    if (!p || isNaN(p)) return '#94a3b8'; 
    if (p <= 156.8) return '#10b981';                
    if (p >= 156.9 && p <= 162.8) return '#3b82f6'; 
    return '#ef4444';                               
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Safely capture the map instance initialized by uiapp.js
    map = window.map;

    // 2. Add zoom controls to the shared map instance
    if (map) {
        L.control.zoom({ position: 'topright' }).addTo(map);
    }

    // 3. Mobile Layout Setup: Collapse menu by default on smaller mobile displays
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        const icon = document.getElementById('toggleIcon');
        if (icon) icon.innerText = "→";
    }

    // 4. Initialize waypoints and autocomplete
    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    setupTab1Autocomplete();

    // 5. Attach Event Listeners
    // Added optional chaining (?.) just to be safe in case a DOM element is missing
    document.getElementById('fuelType')?.addEventListener('change', () => refreshActiveDataView());
    document.getElementById('mpg')?.addEventListener('input', () => refreshActiveDataView());
    document.getElementById('filterUnleaded')?.addEventListener('change', () => refreshActiveDataView());

    // 6. Geolocation & Initial Data Fetch
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
                // Safely check for map before setting view
                if (map) map.setView([userLocation.lat, userLocation.lon], 12); 
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

function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
