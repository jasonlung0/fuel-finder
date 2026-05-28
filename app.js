// APP.JS - Full Implementation File

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';

// POINT THIS DIRECTLY TO YOUR DEPLOYED CLOUDFLARE WORKER ROUTE PROXY URL:
const PROXY_WORKER_URL = 'https://fuel-api-proxy.jasonlung0.workers.dev';

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
let userLocation = { lat: 56.0716, lon: -3.4523 }; 
let searchByAreaActive = false;

// Debouncer utility definition
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// Distance Calculation logic
function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of Earth in Miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper coordinate parser
function getCoordinates(station) {
    if (station.location && station.location.latitude && station.location.longitude) {
        return { lat: parseFloat(station.location.latitude), lon: parseFloat(station.location.longitude) };
    }
    if (station.latitude && station.longitude) {
        return { lat: parseFloat(station.latitude), lon: parseFloat(station.longitude) };
    }
    return null;
}

// ----------------------------------------------------
// UI SIDEBAR WINDOW EXPOSURES
// ----------------------------------------------------
window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
    searchByAreaActive = false;
    
    const tabRadius = document.getElementById('bufferRadiusContainer');
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.getElementById('local-tab').classList.add('active');
        if(tabRadius) tabRadius.classList.add('hidden');
        if(routeLayer) map.removeLayer(routeLayer);
        filterFuelStationsLocalMode();
    } else {
        currentMode = 'route';
        document.getElementById('route-tab').classList.add('active');
        if(tabRadius) tabRadius.classList.remove('hidden');
        if (lastSavedRouteData) {
            if (routeLayer && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            stationMarkers.clearLayers();
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
    row.className = 'flex items-center gap-2 bg-white w-full p-1 border rounded-md';

    row.innerHTML = `
        <div class="relative flex-grow">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." autocomplete="off" class="w-full bg-white border rounded-md py-1.5 px-3 text-sm">
            <div id="suggest-${index}" class="absolute top-[38px] left-0 w-full bg-white border hidden max-h-[160px] overflow-y-auto rounded-md shadow-lg z-[9999]"></div>
        </div>
    `;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
};

function setupDynamicAutocomplete(index, rowElement) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.className = 'p-2 cursor-pointer text-xs hover:bg-slate-100';
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

window.calculateJourney = async function() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList.filter(wp => wp && wp.coordinates).map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please pick your travel routes points first.'); 
        return; 
    }
    
    statusDiv.innerText = "Generating multi-stop path markers...";
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
        if (!response.ok) throw new Error("Route calculation down.");
        const routeData = await response.json();
        lastSavedRouteData = routeData;
        
        routeLayer = L.geoJSON(routeData, { style: { color: '#0f172a', weight: 5 } }).addTo(map);
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); 
        statusDiv.innerText = "Routing route system unavailable.";
    }
};

// ----------------------------------------------------
// TELEMETRY EXTRACTOR DATA HANDLERS
// ----------------------------------------------------
async function fetchLiveGovStationData() {
    // Calls out straight to your custom unified Cloudflare backend service proxy pipeline
    const response = await fetch(PROXY_WORKER_URL);
    if (!response.ok) {
        throw new Error(`Proxy error code trace returned: ${response.status}`);
    }
    const jsonPayload = await response.json();
    return jsonPayload.stations || jsonPayload;
}

async function filterFuelStationsLocalMode() {
    const statusDiv = document.getElementById('status');
    if (statusDiv) statusDiv.innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        processAndRenderStations(stations, null);
    } catch (err) {
        console.error(err);
        if (statusDiv) statusDiv.innerText = "Telemetry lookup error.";
    }
}

async function filterFuelStationsRouteMode(routeData) {
    const statusDiv = document.getElementById('status');
    if (statusDiv) statusDiv.innerText = "Streaming live GOV API telemetry...";
    try {
        const stations = await fetchLiveGovStationData();
        const selectedRadiusMiles = parseFloat(document.getElementById('bufferRadius')?.value || 2);
        const radiusInKm = selectedRadiusMiles * 1.60934;
        
        const corridor = turf.buffer(routeData.features[0], radiusInKm, {units: 'kilometers'});
        processAndRenderStations(stations, corridor);
    } catch (err) {
        console.error(err);
        if (statusDiv) statusDiv.innerText = "Telemetry lookup error.";
    }
}

function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    stationMarkers.clearLayers();
    
    let renderedCount = 0;
    const bounds = map.getBounds();

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        if (spatialBufferPolygon) {
            const pt = turf.point([coords.lon, coords.lat]);
            if (!turf.booleanPointInPolygon(pt, spatialBufferPolygon)) return;
        } else {
            if (!bounds.contains([coords.lat, coords.lon])) return;
        }

        // Render station node marker to Leaflet view
        const marker = L.circleMarker([coords.lat, coords.lon], {
            radius: 8,
            fillColor: '#e11d48',
            color: '#fff',
            weight: 2,
            fillOpacity: 0.9
        });
        
        marker.bindPopup(`<b>${station.brand || 'Station'}</b><br>${station.site_name || 'Retail site'}`);
        stationMarkers.addLayer(marker);
        renderedCount++;
    });

    if (statusDiv) statusDiv.innerText = `Active Stations Located: ${renderedCount}`;
}

// Lifecycle Bootstrapper
window.addEventListener('DOMContentLoaded', function() {
    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    
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
