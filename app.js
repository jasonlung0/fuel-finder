// CRITICAL CONFIGURATIONS (FIXED: Plain text key format to prevent 403 Forbidden Errors)
const ORS_API_KEY = '5b3ce3597851110001cf6248fe175b2c71d049629e65ea16d7502d3d';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 5 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0 (Contact: jasonlung0@github)' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap contributors, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; 
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let userLocation = null;
let searchByAreaActive = false; // Tracks if user engaged the floating area scanning override trigger button

window.addEventListener('load', function() {
    map.invalidateSize();
    setupTabToggles();
    setupTab1Autocomplete();
    
    addNewWaypointField("Start");
    addNewWaypointField("Destination");

    // Pull current geolocation coordinate position state metrics
    if (navigator.geolocation) {
        document.getElementById('status').innerText = "Locating position...";
        navigator.geolocation.getCurrentPosition(
            function(position) {
                userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
                document.getElementById('status').innerText = "Centered on position.";
                map.setView([userLocation.lat, userLocation.lon], 12); 
                filterFuelStationsLocalMode();
            },
            function(error) {
                document.getElementById('status').innerText = "Position access denied. Showing overview.";
                filterFuelStationsLocalMode();
            },
            { timeout: 7000 }
        );
    } else {
        filterFuelStationsLocalMode();
    }
});

// Sync movement tracking triggers
map.on('moveend', function() {
    if (currentMode === 'local' && !searchByAreaActive) {
        filterFuelStationsLocalMode();
    }
});

// NEW FEATURE: Floating Search This Area control function action loop handler
function searchThisArea() {
    searchByAreaActive = true;
    const mapCenter = map.getCenter();
    document.getElementById('status').innerText = "Scanning visible viewport up to 50 miles...";
    
    // Temporarily substitute viewport anchor center to act as search origin tracking point
    userLocation = { lat: mapCenter.lat, lon: mapCenter.lng };
    filterFuelStationsLocalMode();
}

function setupTabToggles() {
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    window.switchTab = function(tabId) {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        searchByAreaActive = false; // Reset overrides
        
        if (tabId === 'local-tab') {
            currentMode = 'local';
            document.getElementById('local-tab').classList.add('active');
            document.querySelector("button[onclick*='local-tab']").classList.add('active');
            if(tabRadius) tabRadius.style.display = 'none';
            if(tabCost) tabCost.style.display = 'none';
            if(routeLayer) map.removeLayer(routeLayer);
            filterFuelStationsLocalMode();
        } else {
            currentMode = 'route';
            document.getElementById('route-tab').classList.add('active');
            document.querySelector("button[onclick*='route-tab']").classList.add('active');
            if(tabRadius) tabRadius.style.display = 'block';
            if (lastSavedRouteData) {
                if (routeLayer && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
                filterFuelStationsRouteMode(lastSavedRouteData);
            } else {
                stationMarkers.clearLayers();
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    };
}

function changeMapTheme(themeName) {
    map.removeLayer(activeTheme);
    activeTheme = themes[themeName];
    activeTheme.addTo(map);
}

function updateRadiusLabel(val) {
    document.getElementById('radiusVal').innerText = val;
    if (lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

function updateLocalRadiusLabel(val) {
    searchByAreaActive = false; // Re-anchor back onto true geographic ranges
    document.getElementById('localRadiusVal').innerText = val;
    filterFuelStationsLocalMode();
}

document.getElementById('fuelType').addEventListener('change', () => refreshActiveDataView());
document.getElementById('mpg').addEventListener('input', () => refreshActiveDataView());
document.getElementById('filterUnleaded').addEventListener('change', () => refreshActiveDataView());

function refreshActiveDataView() {
    if (currentMode === 'local') filterFuelStationsLocalMode();
    else if (currentMode === 'route' && lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

function getCoordinates(station) {
    // Scan for all standard coordinate variations flexibly
    const latKeys = ['lat', 'latitude', 'Latitude', 'LAT', 'j', 'J'];
    const lonKeys = ['lon', 'lng', 'longitude', 'Longitude', 'LON', 'k', 'K'];
    let lat = null, lon = null;
    for (let key of latKeys) { if (station[key] !== undefined && station[key] !== null) { lat = parseFloat(station[key]); break; } }
    for (let key of lonKeys) { if (station[key] !== undefined && station[key] !== null) { lon = parseFloat(station[key]); break; } }
    return (isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

// FIXED PRICING PARSING LAYER: Directly maps onto your actual Sheet column header definitions
function extractPriceByMetricType(station, fuelType) {
    const target = (fuelType || 'e10').toLowerCase();
    let possibleKeys = [];
    
    if (target === 'e10') possibleKeys = ['price_e10', 'e10', 'E10'];
    else if (target === 'e5') possibleKeys = ['price_e5', 'e5', 'E5'];
    else if (target === 'diesel') possibleKeys = ['price_diesel', 'b7', 'B7', 'diesel'];

    for (let key of possibleKeys) {
        if (station[key] !== undefined && station[key] !== null && station[key] !== '') {
            let val = parseFloat(station[key]);
            if (!isNaN(val) && val > 0) return val;
        }
    }
    return NaN;
}

function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function addNewWaypointField(customLabel) {
    if (!customLabel) customLabel = "Stop";
    var container = document.getElementById('waypointContainer');
    var index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    var rowId = 'waypoint-row-' + index;
    var row = document.createElement('div');
    row.id = rowId; row.className = 'draggable-waypoint-row';
    row.setAttribute('data-index', index); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '5px'; row.style.position = 'relative'; row.style.background = '#ffffff'; row.style.zIndex = '10';

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

    row.innerHTML = `
        <span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none;">⋮⋮</span>
        <div style="position: relative; flex-grow: 1;">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." style="width: 100%;" autocomplete="off">
            <span id="clear-${index}" onclick="clearWaypointField(${index})" style="position: absolute; right: 10px; top: 10px; cursor: pointer; color: #70757a; font-weight: bold; display: none;">×</span>
            <div id="suggest-${index}" class="suggestions-box" style="position: absolute; top: 40px; left: 0; width: 100%; background: white; border: 1px solid #dadce0; z-index: 99999; display: none; max-height: 180px; overflow-y: auto;"></div>
        </div>
        ${!isCoreField ? `<button onclick="removeWaypointField(${index}, '${rowId}')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; padding:0 5px; width:auto;">🗑️</button>` : `<div style="width:28px;"></div>`}`;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
}

function setupDynamicAutocomplete(index, rowElement) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('focus', () => { rowElement.style.zIndex = '999'; });
    input.addEventListener('blur', () => { setTimeout(() => { rowElement.style.zIndex = '10'; }, 300); });

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (clearBtn) clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        waypointsList[index].rawText = query;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4'; row.style.color = '#333';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; suggestionsDiv.style.display = 'none';
                    waypointsList[index].coordinates = [item.x, item.y]; 
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
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4';
                row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label; suggestionsDiv.style.display = 'none';
                    searchByAreaActive = false; // Restore slider metric mapping tracker
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

// FIXED ROUTE SYSTEM CALCULATOR: Connects multi-stop points along the pathway corridor
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    
    const validCoords = waypointsList
        .filter(wp => wp && wp.coordinates)
        .map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please fill out your Start and Destination points utilizing the selection items from the drop-list autocomplete popups.'); 
        return; 
    }
    
    statusDiv.innerText = "Requesting multi-stop track traces...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
            method: 'POST',
            headers: { 'Accept': 'application/json, geo+json', 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
            body: JSON.stringify({ "coordinates": validCoords })
        });
        
        if (!response.ok) throw new Error(await response.text());
        const routeData = await response.json();
        lastSavedRouteData = routeData;
        
        // Render a thick high-visibility colored route tracking line on the canvas
        routeLayer = L.geoJSON(routeData, { 
            style: { color: '#1a73e8', weight: 6, opacity: 0.85 } 
        }).addTo(map);
        
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); 
        statusDiv.innerText = "Routing authentication fault. Check OpenRouteService panel logs.";
    }
}

// FIXED STREAMING ENGINE: Drops broken &tq queries and handles full local parsing matching map viewframes
function filterFuelStationsLocalMode() {
    Papa.parse(GOOGLE_SHEET_BASE_URL, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) { processAndRenderStations(results.data, null); }
    });
}

function filterFuelStationsRouteMode(routeData) {
    Papa.parse(GOOGLE_SHEET_BASE_URL, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
            const corridor = turf.buffer(routeData.features[0], selectedRadius, {units: 'kilometers'});
            processAndRenderStations(results.data, corridor);
        }
    });
}

function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;
    const localRadiusLimit = parseFloat(document.getElementById('localRadiusSlider').value);

    stationMarkers.clearLayers();
    let eligibleStations = [];
    currentlyFilteredStations = [];
    document.getElementById('topStationsList').innerHTML = '';
    let cheapestPriceFound = Infinity;

    const bounds = map.getBounds();

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        // Ensure fallback checking for common data keys
        const brandName = station.brand || station.Brand || "Independent";
        station.brand = brandName;

        const isTraditional = (station.has_unleaded === true || station.has_unleaded === "TRUE" || station.has_unleaded === 1 || station.has_unleaded === "true");
        if (requiresUnleaded && !isTraditional) return;

        // Tab 2: Corridor check logic bounds
        if (spatialBufferPolygon) {
            if (!turf.booleanPointInPolygon(turf.point([coords.lon, coords.lat]), spatialBufferPolygon)) return;
        } 
        // Tab 1: Viewport map bounding window checks
        else {
            if (!bounds
