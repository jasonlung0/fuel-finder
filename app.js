// GLOBAL CONFIGURATIONS & API KEYS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

// Initialize Leaflet Map Object Instance 
const map = L.map('map', { zoomControl: false }).setView([56.0716, -3.4523], 12); 
L.control.zoom({ position: 'topright' }).addTo(map);

const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = { lat: 56.0716, lon: -3.4523 }; 
let searchByAreaActive = false;

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggleIcon');
    if (!sidebar || !icon) return;
    
    sidebar.classList.toggle('collapsed');
    icon.innerText = sidebar.classList.contains('collapsed') ? "→" : "←";
    
    setTimeout(() => { map.invalidateSize(); }, 360);
};

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
    searchByAreaActive = false;
    
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.getElementById('local-tab').classList.add('active');
        document.querySelector("button[onclick*='local-tab']").classList.add('active');
        if(tabRadius) tabRadius.classList.add('hidden');
        if(tabCost) tabCost.classList.add('hidden');
        if(routeLayer) map.removeLayer(routeLayer);
        filterFuelStationsLocalMode();
    } else {
        currentMode = 'route';
        document.getElementById('route-tab').classList.add('active');
        document.querySelector("button[onclick*='route-tab']").classList.add('active');
        if(tabRadius) tabRadius.classList.remove('hidden');
        if (lastSavedRouteData) {
            if (routeLayer && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            stationMarkers.clearLayers();
            const container = document.getElementById('topStationsContainer');
            if (container) container.classList.add('hidden');
        }
    }
};

window.changeMapTheme = function(themeName) {
    if (activeTheme) map.removeLayer(activeTheme);
    activeTheme = themes[themeName] || themes.light;
    activeTheme.addTo(map);
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
    searchByAreaActive = true;
    const mapCenter = map.getCenter();
    const status = document.getElementById('status');
    if (status) status.innerText = "Scanning visible viewport...";
    userLocation = { lat: mapCenter.lat, lon: mapCenter.lng };
    filterFuelStationsLocalMode();
};

window.addNewWaypointField = function(customLabel) {
    if (!customLabel) customLabel = "Stop";
    const container = document.getElementById('waypointContainer');
    if (!container) return;
    
    const index = waypointsList.length;
    const rowId = 'waypoint-row-' + index;
    waypointsList.push({ coordinates: null, rawText: "", id: rowId, label: customLabel });

    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'flex items-center gap-2 relative bg-white z-10 w-full transition-all p-1 border border-transparent rounded-md';
    row.setAttribute('draggable', 'true');

    const isCoreField = (customLabel === "Start" || customLabel === "Destination");

    row.innerHTML = `
        <span class="text-slate-400 text-sm font-semibold cursor-grab px-1 select-none handle">⋮⋮</span>
        <div class="relative flex-grow">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." autocomplete="off" class="w-full bg-white border border-slate-200 rounded-md py-1.5 px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-950">
            <span id="clear-${index}" onclick="clearWaypointField(${index})" class="absolute right-3 top-2 cursor-pointer text-slate-400 hover:text-slate-600 font-medium hidden text-xs">×</span>
            <div id="suggest-${index}" class="absolute top-[38px] left-0 w-full bg-white border border-slate-200 z-[99999] hidden max-h-[160px] overflow-y-auto rounded-md shadow-lg divide-y divide-slate-100"></div>
        </div>
        ${!isCoreField ? `<button onclick="removeWaypointField(${index}, '${rowId}')" class="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-slate-50 transition-colors shrink-0 text-sm">🗑️</button>` : `<div class="w-7 shrink-0"></div>`}`;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
    setupDragAndDropEvents(row);
};

window.clearWaypointField = function(index) {
    const inputEl = document.getElementById('input-' + index);
    if (inputEl) inputEl.value = '';
    
    const suggestEl = document.getElementById('suggest-' + index);
    if (suggestEl) suggestEl.style.display = 'none';
    
    const clearEl = document.getElementById('clear-' + index);
    if (clearEl) clearEl.style.display = 'none';
    
    if(waypointsList[index]) {
        waypointsList[index].coordinates = null;
        waypointsList[index].rawText = "";
    }
};

window.removeWaypointField = function(index, rowId) { 
    const el = document.getElementById(rowId);
    if(el) el.remove(); 
    waypointsList = waypointsList.filter(wp => wp && wp.id !== rowId);
    if(lastSavedRouteData) window.calculateJourney(); 
};

function setupDragAndDropEvents(row) {
    row.addEventListener('dragstart', (e) => {
        row.classList.add('dragging');
        e.dataTransfer.setData('text/plain', row.id);
    });

    row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll('#waypointContainer > div').forEach(el => el.classList.remove('drag-over'));
        rebuildWaypointsOrderFromDOM();
    });

    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        const draggedEl = document.getElementById(draggedId);
        const container = document.getElementById('waypointContainer');
        
        if (draggedEl && draggedEl !== row) {
            const allElements = [...container.querySelectorAll('#waypointContainer > div')];
            const draggedIndex = allElements.indexOf(draggedEl);
            const targetIndex = allElements.indexOf(row);
            
            if (draggedIndex < targetIndex) {
                row.after(draggedEl);
            } else {
                row.before(draggedEl);
            }
        }
    });
}

function rebuildWaypointsOrderFromDOM() {
    const container = document.getElementById('waypointContainer');
    const rows = [...container.querySelectorAll('#waypointContainer > div')];
    
    let newWaypoints = [];
    rows.forEach((row) => {
        const found = waypointsList.find(wp => wp && wp.id === row.id);
        if (found) newWaypoints.push(found);
    });
    waypointsList = newWaypoints;
}

window.calculateJourney = async function() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList.filter(wp => wp && wp.coordinates).map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please map your coordinates points first using autocomplete suggestions.'); 
        return; 
    }
    
    if (statusDiv) statusDiv.innerText = "Requesting multi-stop track traces...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: { 
                'Accept': 'application/geo+json', 
                'Content-Type': 'application/json', 
                'Authorization': ORS_API_KEY 
            },
            body: JSON.stringify({ "coordinates": validCoords })
        });
        if (!response.ok) throw new Error(await response.text());
        const routeData = await response.json();
        lastSavedRouteData = routeData;
        
        routeLayer = L.geoJSON(routeData, { style: { color: '#0f172a', weight: 5, opacity: 0.85 } }).addTo(map);
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); 
        if (statusDiv) statusDiv.innerText = "Routing fault. Check your endpoints.";
    }
};

window.handleBackdropClick = function(event) { 
    if (event.target.id === 'iosModalBackdrop') closeiOSModalSheet(); 
};

window.closeiOSModalSheet = function() {
    const backdrop = document.getElementById('iosModalBackdrop');
    const sheet = document.getElementById('stationDetailSheet');
    if(!backdrop || !sheet) return;
    backdrop.style.opacity = '0'; 
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { backdrop.style.display = 'none'; }, 250);
};

function setupDynamicAutocomplete(index, rowElement) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('focus', () => { rowElement.classList.add('z-[999]'); });
    input.addEventListener('blur', () => { setTimeout(() => { rowElement.classList.remove('z-[999]'); }, 300); });

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (clearBtn) clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        
        const foundIndex = waypointsList.findIndex(wp => wp && wp.id === rowElement.id);
        if (foundIndex !== -1) waypointsList[foundIndex].rawText = query;

        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.className = 'p-2 px-3 cursor-pointer text-xs hover:bg-slate-50 text-slate-700 font-medium transition-colors';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; 
                    suggestionsDiv.style.display = 'none';
                    const fIdx = waypointsList.findIndex(wp => wp && wp.id === rowElement.id);
                    if (fIdx !== -1) waypointsList[fIdx].coordinates = [item.x, item.y]; 
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

function setupTab1Autocomplete() {
    const input = document.getElementById('localSearchInput');
    const suggestionsDiv = document.getElementById('localSuggestions');
    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.forEach(function(item) {
                const row = document.createElement('div');
                row.className = 'p-2 px-3 cursor-pointer text-xs hover:bg-slate-50 text-slate-700 font-medium transition-colors';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; 
                    suggestionsDiv.style.display = 'none';
                    searchByAreaActive = false;
                    userLocation = { lat: item.y, lon: item.x };
                    map.setView([item.y, item.x], 13);
                    filterFuelStationsLocalMode();
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

async function fetchLiveGovStationData() {
    try {
        const response = await fetch(PROXY_WORKER_URL, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`Edge worker proxy returned execution error state: ${response.status}`);
        }
        const jsonPayload = await response.json();
        return jsonPayload.data || jsonPayload.stations || jsonPayload;
    } catch (error) {
        console.error("Worker extraction processing fault:", error);
        throw error;
    }
}

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
            if (!bounds.contains([coords.lat, coords.lon])) return;
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

function getCoordinates(station) {
    if (station['forecourts.location.latitude'] && station['forecourts.location.longitude']) {
        const lat = parseFloat(station['forecourts.location.latitude']);
        const lon = parseFloat(station['forecourts.location.longitude']);
        if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }

    let lat = null, lon = null;
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['lat', 'latitude'].includes(normalizedKey)) lat = parseFloat(station[key]);
        if (['lon', 'lng', 'longitude'].includes(normalizedKey)) lon = parseFloat(station[key]);
    }
    return (lat === null || lon === null || isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'price_e10').toLowerCase();
    
    if (target.includes('e10') && station['forecourts.fuel_price.E10']) {
        const val = parseFloat(station['forecourts.fuel_price.E10']);
        if (!isNaN(val) && val > 0) return val;
    }
    if (target.includes('e5') && station['forecourts.fuel_price.E5']) {
        const val = parseFloat(station['forecourts.fuel_price.E5']);
        if (!isNaN(val) && val > 0) return val;
    }
    if ((target.includes('premium') || target.includes('b7p')) && station['forecourts.fuel_price.B7P']) {
        const val = parseFloat(station['forecourts.fuel_price.B7P']);
        if (!isNaN(val) && val > 0) return val;
    }
    if ((target.includes('diesel') || target.includes('b7')) && !target.includes('b7p') && !target.includes('premium') && station['forecourts.fuel_price.B7']) {
        const val = parseFloat(station['forecourts.fuel_price.B7']);
        if (!isNaN(val) && val > 0) return val;
    }

    const targetNorm = target.replace(/[^a-z0-9]/g, '');
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (targetNorm.includes('e10') && normalizedKey.includes('e10')) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if (targetNorm.includes('e5') && normalizedKey.includes('e5')) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if ((targetNorm.includes('b7p') || targetNorm.includes('premium')) && (normalizedKey.includes('b7p') || normalizedKey.includes('premium'))) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if ((targetNorm.includes('diesel') || targetNorm.includes('b7')) && (normalizedKey.includes('diesel') || normalizedKey.includes('b7')) && !normalizedKey.includes('b7p') && !normalizedKey.includes('premium')) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
    }
    return NaN;
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

window.addEventListener('DOMContentLoaded', function() {
    // Mobile Layout Setup: Collapse menu by default on smaller mobile displays
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
        const icon = document.getElementById('toggleIcon');
        if (icon) icon.innerText = "→";
    }

    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    setupTab1Autocomplete();

    document.getElementById('fuelType').addEventListener('change', () => refreshActiveDataView());
    document.getElementById('mpg').addEventListener('input', () => refreshActiveDataView());
    document.getElementById('filterUnleaded').addEventListener('change', () => refreshActiveDataView());

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

function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
