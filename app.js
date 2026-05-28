// GLOBAL CONFIGURATIONS & API KEYS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';

// GOV.UK Fuel Finder OAuth 2.0 Credentials
const GOV_CLIENT_ID = 'cIbqCdZusjAdJaIfzF0kgcMxjr1EIZqR';
const GOV_CLIENT_SECRET = 'WUlusvwsxuM6ZZeT58rWETJsQsYQcfteQD4g4EwU4nxcHb6anSawYgET5BoTK6PU';
const GOV_AUTH_URL = 'https://auth.api.gov.uk/oauth2/token'; 
const GOV_STATIONS_API_URL = 'https://api.gov.uk/fuel-prices/v1/stations'; // Standard UK Fuel Finder Endpoint

// Cache register for the short-lived OAuth access token
let cachedAccessToken = null;
let tokenExpiryTime = null;

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
// GOV.UK OAUTH 2.0 AUTHENTICATION HANDSHAKE
// ----------------------------------------------------
async function getGovApiAccessToken() {
    // Check if token exists and is still valid (with a 30-second buffer safety margin)
    if (cachedAccessToken && tokenExpiryTime && Date.now() < (tokenExpiryTime - 30000)) {
        return cachedAccessToken;
    }

    try {
        // Standard Client Credentials Grant request payload
        const details = {
            'grant_type': 'client_credentials',
            'client_id': GOV_CLIENT_ID,
            'client_secret': GOV_CLIENT_SECRET,
            'scope': 'fuel-pricing'
        };

        const formBody = Object.keys(details)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(details[key]))
            .join('&');

        const response = await fetch(GOV_AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: formBody
        });

        if (!response.ok) {
            throw new Error(`Auth failed with status ${response.status}`);
        }

        const data = await response.json();
        cachedAccessToken = data.access_token;
        // Calculate expiry timestamp (expires_in is usually returned in seconds)
        tokenExpiryTime = Date.now() + (data.expires_in * 1000);
        
        return cachedAccessToken;
    } catch (error) {
        console.error("Authentication handshake fault:", error);
        document.getElementById('status').innerText = "Authentication Error.";
        return null;
    }
}

// ----------------------------------------------------
// EXPOSE COMPONENT HANDLERS EXPLICITLY ON WINDOW SPACE
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
            document.getElementById('topStationsContainer').classList.add('hidden');
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
    document.getElementById('status').innerText = "Scanning visible viewport...";
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

// DRAG AND DROP HANDLERS MECHANICS
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
        alert('Please fill out your points utilizing the autocomplete selections.'); 
        return; 
    }
    
    statusDiv.innerText = "Requesting multi-stop track traces...";
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
        statusDiv.innerText = "Routing fault. Check your endpoints.";
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

// Lifecycle Bootstrap
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
            function() {
                filterFuelStationsLocalMode();
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
// NEW PIPELINES: GOV API FETCH & DATA EXTRACTION
// ----------------------------------------------------
async function fetchLiveGovStationData() {
    const token = await getGovApiAccessToken();
    if (!token) {
        throw new Error("Unable to fetch data due to missing authentication token.");
    }

    const response = await fetch(GOV_STATIONS_API_URL, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`API returned error code: ${response.status}`);
    }

    const jsonPayload = await response.json();
    // The government standard schema wraps stations inside a parent property: { stations: [...] }
    return jsonPayload.stations || jsonPayload;
}

async function filterFuelStationsLocalMode() {
    document.getElementById('status').innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        processAndRenderStations(stations, null);
    } catch (err) {
        console.error(err);
        document.getElementById('status').innerText = "Telemetry lookup error.";
    }
}

async function filterFuelStationsRouteMode(routeData) {
    document.getElementById('status').innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        const selectedRadiusMiles = parseFloat(document.getElementById('bufferRadius').value || 2);
        const radiusInKm = selectedRadiusMiles * 1.60934;
        
        const corridor = turf.buffer(routeData.features[0], radiusInKm, {units: 'kilometers'});
        processAndRenderStations(stations, corridor);
    } catch (err) {
        console.error(err);
        document.getElementById('status').innerText = "Telemetry lookup error.";
    }
}

function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;
    const localRadiusLimit = parseFloat(document.getElementById('localRadiusSlider').value || 5);

    stationMarkers.clearLayers();
    let eligibleStations = [];
    currentlyFilteredStations = [];
    document.getElementById('topStationsList').innerHTML = '';
    let cheapestPriceFound = Infinity;

    const bounds = map.getBounds();

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        // Map standard API fields to app expectations safely
        station.brand = station.brand || "Independent";

        // Handle structural check for "Traditional Pumps Only" feature
        // If traditional check is enabled, check if station supports common standard fuels
        if (requiresUnleaded) {
            const hasE10 = extractPriceByMetricType(station, 'price_e10');
            if (isNaN(hasE10)) return; // Exclude hyper-specialized charging infrastructure/LPG stops
        }

        if (spatialBufferPolygon) {
            if (!turf.booleanPointInPolygon(turf.point([coords.lon, coords.lat]), spatialBufferPolygon)) return;
        } else {
            if (!bounds.contains([coords.lat, coords.lon])) return;
        }
        
        if (currentMode === 'local' && userLocation) {
            station.calculatedDistance = calculateDistanceInMiles(userLocation.lat, userLocation.lon, coords.lat, coords.lon);
            const activeRangeCap = searchBy
