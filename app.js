// GLOBAL CONFIGURATIONS & API KEYS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';

// POINT THIS DIRECTLY TO YOUR DEPLOYED CLOUDFLARE WORKER ROUTE PROXY URL:
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

// Initialize Leaflet Map Object Instance 
const map = L.map('map', { zoomControl: false }).setView([56.0716, -3.4523], 12); 
L.control.zoom({ position: 'topright' }).addTo(map);

// Define Geosearch Autocomplete Provider instance
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0' }
});

// Configure Map Tile Themes
const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

// Internal State Registers
let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = { lat: 56.0716, lon: -3.4523 }; 
let searchByAreaActive = false;

// ----------------------------------------------------
// UI EXPOSURES MOUNTED TO GLOBAL WINDOW NAMESPACE
// ----------------------------------------------------
window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const icon = document.getElementById('toggleIcon');
    if (!sidebar || !icon) return;
    
    sidebar.classList.toggle('collapsed');
    icon.innerText = sidebar.classList.contains('collapsed') ? "→" : "←";
    
    setTimeout(() => { map.invalidateSize(); }, 310);
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
    document.getElementById('input-' + index).value = '';
    document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none';
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

// ----------------------------------------------------
// AUTOCOMPLETE HANDLERS
// ----------------------------------------------------
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

// ----------------------------------------------------
// CORE API TELEMETRY LOADING
// ----------------------------------------------------
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
        return jsonPayload.stations || jsonPayload;
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

// ----------------------------------------------------
// SPATIAL AND PRICING CORE LOGIC MATRIX
// ----------------------------------------------------
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

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        station.brand = station.brand || "Independent";

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

        const icon = L.divIcon({
            className: 'price-badge-container',
            html: `<div style="background-color: ${color}; border: 1px solid white; color: white; font-weight: 600; padding: 2px 5px; border-radius: 6px; font-size: 10px; text-align:center; box-shadow: 0 1px 2px rgba(0,0,0,0.15);">${labelText}</div>`,
            iconSize: [46, 22]
        });

        L.marker([coords.lat, coords.lon], { icon: icon }).on('click', function() {
            displayiOSModalSheet(station, coords, e10Price, b7Price, e5Price);
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

// ----------------------------------------------------
// IOS MODAL SHEETS RENDERING ENGINE
// ----------------------------------------------------
function displayiOSModalSheet(station, coords, e10, b7, e5) {
    document.getElementById('sheetBrand').innerText = station.brand;
    const targetAddress = station.address || station.Address;
    document.getElementById('sheetAddress').innerText = targetAddress || `Forecourt Coordinates: [${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}]`;
    
    document.getElementById('sheetE10').innerText = (!isNaN(e10)) ? e10.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = (!isNaN(b7)) ? b7.toFixed(1) + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = (!isNaN(e5)) ? e5.toFixed(1) + 'p' : 'N/A';

    applyBoxPricingColor('boxE10', 'labelE10', 'sheetE10', e10);
    applyBoxPricingColor('boxB7', 'labelB7', 'sheetB7', b7);
    applyBoxPricingColor('boxE5', 'labelE5', 'sheetE5', e5);

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

// ----------------------------------------------------
// UTILITIES AND DATA EXTRAPOLATION
// ----------------------------------------------------
function getCoordinates(station) {
    let lat = null, lon = null;
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['lat', 'latitude'].includes(normalizedKey)) lat = parseFloat(station[key]);
        if (['lon', 'lng', 'longitude'].includes(normalizedKey)) lon = parseFloat(station[key]);
    }
    return (lat === null || lon === null || isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'price_e10').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let key in station) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (target.includes('e10') && normalizedKey.includes('e10')) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if (target.includes('e5') && normalizedKey.includes('e5')) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
        if ((target.includes('diesel') || target.includes('b7')) && (normalizedKey.includes('diesel') || normalizedKey.includes('b7'))) {
            const val = parseFloat(station[key]); if (!isNaN(val) && val > 0) return val;
        }
    }
    return NaN;
}

function getMarkerColor(p) { 
    if (!p || isNaN(p)) return '#94a3b8'; 
    if (p >= 130.0 && p <= 145.0) return '#10b981'; // Green (Cheap)
    if (p > 145.0 && p <= 152.0) return '#3b82f6';  // Blue (Average)
    return '#ef4444';                               // Red (Expensive)
}

// Lifecycle Bootstrapper Initializations
window.addEventListener('DOMContentLoaded', function() {
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
                filterFuelStationsLocalMode();
            },
            function() { filterFuelStationsLocalMode(); },
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
