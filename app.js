// CRITICAL CREDENTIAL CONFIGURATIONS
// NOTE: If you still receive a 403 error after applying this code, generate a new key at https://openrouteservice.org
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3TTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
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
let draggedElement = null;

window.addEventListener('load', function() {
    map.invalidateSize();
    
    // Automatically bind layout toggle listeners to the HTML elements directly
    setupTabToggles();
    setupTab1Autocomplete();
    
    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    document.getElementById('status').innerText = 'Ready - Search a route to scan fuel';
});

// Watch map viewport adjustments to refresh local node selections dynamically
map.on('moveend', function() {
    if (currentMode === 'local') {
        filterFuelStationsLocalMode();
    }
});

function setupTabToggles() {
    const tabRadius = document.getElementById('bufferRadiusContainer');
    const tabCost = document.getElementById('costSummary');
    
    // Find tab elements if they exist or attach dynamically via a global interface handler
    window.switchTab = function(tabId) {
        document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
        
        if (tabId === 'local-tab') {
            currentMode = 'local';
            if(tabRadius) tabRadius.style.display = 'none';
            if(tabCost) tabCost.style.display = 'none';
            if(routeLayer) map.removeLayer(routeLayer);
            filterFuelStationsLocalMode();
        } else {
            currentMode = 'route';
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

// Add Listeners to Controls for Realtime Recalculations
document.getElementById('fuelType').addEventListener('change', () => refreshActiveDataView());
document.getElementById('mpg').addEventListener('input', () => refreshActiveDataView());
document.getElementById('filterEV').addEventListener('change', () => refreshActiveDataView());
document.getElementById('filterUnleaded').addEventListener('change', () => refreshActiveDataView());

function refreshActiveDataView() {
    if (currentMode === 'local') filterFuelStationsLocalMode();
    else if (currentMode === 'route' && lastSavedRouteData) filterFuelStationsRouteMode(lastSavedRouteData);
}

// Safe multi-column key normalizer mapping strategy
function getCoordinates(station) {
    const latKeys = ['lat', 'latitude', 'Latitude', 'LAT', 'J'];
    const lonKeys = ['lon', 'lng', 'longitude', 'Longitude', 'LON', 'K'];
    
    let lat = null, lon = null;
    for (let key of latKeys) { if (station[key] !== undefined && station[key] !== null) { lat = parseFloat(station[key]); break; } }
    for (let key of lonKeys) { if (station[key] !== undefined && station[key] !== null) { lon = parseFloat(station[key]); break; } }
    
    return (isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

// Dynamic Input Row Generation Engine Engine
function addNewWaypointField(customLabel) {
    if (!customLabel) customLabel = "Stop";
    var container = document.getElementById('waypointContainer');
    var index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    var rowId = 'waypoint-row-' + index;
    var row = document.createElement('div');
    row.id = rowId;
    row.className = 'draggable-waypoint-row';
    row.setAttribute('data-index', index);
    row.setAttribute('draggable', 'true');
    row.style.display = 'flex'; 
    row.style.alignItems = 'center'; 
    row.style.gap = '5px'; 
    row.style.position = 'relative';
    row.style.background = '#ffffff';
    row.style.zIndex = '10'; // Default flat resting layer priority

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

    row.innerHTML = `
        <span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none; cursor: grab;">⋮⋮</span>
        <div style="position: relative; flex-grow: 1;">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." style="width: 100%;" autocomplete="off">
            <span id="clear-${index}" onclick="clearWaypointField(${index})" style="position: absolute; right: 10px; top: 10px; cursor: pointer; color: #70757a; font-weight: bold; display: none;">×</span>
            <div id="suggest-${index}" class="suggestions-box" style="position: absolute; top: 40px; left: 0; width: 100%; background: white; border: 1px solid #dadce0; z-index: 99999; display: none; max-height: 180px; overflow-y: auto; border-radius: 0 0 4px 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"></div>
        </div>
        ${!isCoreField ? `<button onclick="removeWaypointField(${index}, '${rowId}')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; padding:0 5px; width:auto;">🗑️</button>` : `<div style="width:28px;"></div>`}`;

    container.appendChild(row);
    setupDynamicAutocomplete(index, row);
    addDragAndDropListeners(row);
}

function setupDynamicAutocomplete(index, rowElement) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);

    if (!input || !suggestionsDiv) return;

    // FIX: Elevate the current row container's z-index hierarchy above its siblings when focused
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
                row.onmouseover = () => row.style.background = '#f1f3f4';
                row.onmouseout = () => row.style.background = 'white';
                
                row.onclick = function() {
                    input.value = item.label;
                    suggestionsDiv.style.display = 'none';
                    waypointsList[index].coordinates = [item.x, item.y]; 
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error("Geocoding lookup error:", err); }
    }, 400));
}

// ROUTE MODE JOURNEY CALCULATOR (TAB 2)
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList
        .filter(wp => wp && wp.coordinates)
        .map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { 
        alert('Please select valid destinations from the dropdown autocomplete lists.'); 
        return; 
    }

    statusDiv.innerText = "Requesting spatial route lines...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const apiUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Accept': 'application/json, application/geo+json; charset=utf-8', 
                'Content-Type': 'application/json', 
                'Authorization': ORS_API_KEY 
            },
            body: JSON.stringify({ "coordinates": validCoords })
        });

        if (!response.ok) {
            const errorDetails = await response.text();
            if (response.status === 403) {
                throw new Error("403 Forbidden: Your ORS Key has expired or doesn't support authorization requests originating from this domain framework profile.");
            }
            throw new Error(`Server Rejected Payload: ${errorDetails}`);
        }

        const routeData = await response.json();
        lastSavedRouteData = routeData;

        routeLayer = L.geoJSON(routeData, { style: { color: '#1a73e8', weight: 5, opacity: 0.85 } }).addTo(map);
        map.fitBounds(routeLayer.getBounds());

        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err);
        statusDiv.innerText = err.message.includes("403") ? "Routing Error: API Key Key Rejected (403)." : "Failed tracking path coordinates.";
    }
}

// STRATIFIED PARSING ENGINE: SCAN VIEWPORT (TAB 1)
function filterFuelStationsLocalMode() {
    const statusDiv = document.getElementById('status');
    stationMarkers.clearLayers();

    const bounds = map.getBounds();
    const minLat = bounds.getSouth(); const maxLat = bounds.getNorth();
    const minLon = bounds.getWest(); const maxLon = bounds.getEast();

    const sqlQuery = `SELECT * WHERE J >= ${minLat} AND J <= ${maxLat} AND K >= ${minLon} AND K <= ${maxLon}`;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            processAndRenderStations(results.data, null);
        }
    });
}

// STRATIFIED PARSING ENGINE: JOURNEY CORRIDOR BUFFER (TAB 2)
function filterFuelStationsRouteMode(routeData) {
    const statusDiv = document.getElementById('status');
    stationMarkers.clearLayers();

    const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
    const routeBBox = turf.bbox(routeData); 
    const paddingDegrees = (selectedRadius / 111.32) + 0.05; 

    const minLon = routeBBox[0] - paddingDegrees; const minLat = routeBBox[1] - paddingDegrees;
    const maxLon = routeBBox[2] + paddingDegrees; const maxLat = routeBBox[3] + paddingDegrees;

    const sqlQuery = `SELECT * WHERE J >= ${minLat} AND J <= ${maxLat} AND K >= ${minLon} AND K <= ${maxLon}`;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            // Unpack the feature definition tracking list safe array index structure directly
            const bufferedCorridor = turf.buffer(routeData.features[0], selectedRadius, {units: 'kilometers'});
            processAndRenderStations(results.data, bufferedCorridor);
        }
    });
}

// Unified downstream filter rendering system block
function processAndRenderStations(stationsArray, spatialBufferPolygon) {
    const statusDiv = document.getElementById('status');
    const requiresEV = document.getElementById('filterEV').checked;
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;
    
    let displayListings = [];
    currentlyFilteredStations = [];
    document.getElementById('topStationsList').innerHTML = '';
    let cheapestPriceFound = Infinity;

    stationsArray.forEach(function(station) {
        const coords = getCoordinates(station);
        if (!coords) return;

        // Flatten checkbox string evaluation matches safely
        if (requiresEV && station.has_ev !== true && station.has_ev !== "TRUE") return;
        if (requiresUnleaded && station.has_unleaded !== true && station.has_unleaded !== "TRUE") return;

        if (spatialBufferPolygon) {
            const point = turf.point([coords.lon, coords.lat]);
            if (!turf.booleanPointInPolygon(point, spatialBufferPolygon)) return;
        }

        const price = station[chosenFuelType];
        if (price) {
            displayListings.push(station);
            currentlyFilteredStations.push(station);
            if (price < cheapestPriceFound) cheapestPriceFound = price;
        }

        const markerLabel = price ? price + 'p' : 'N/A';
        const markerColor = getMarkerColor(price);

        const badgeIcon = L.divIcon({
            className: 'price-badge-container',
            html: `<div style="background-color: ${markerColor}; border: 1px solid white; color: white; font-weight: bold; padding: 2px 5px; border-radius: 4px; font-size: 11px; text-align:center; white-space:nowrap;">${markerLabel}</div>`,
            iconSize: [46, 22]
        });

        L.marker([coords.lat, coords.lon], { icon: badgeIcon })
            .bindPopup(`<strong>${station.brand || 'Independent'}</strong><br>${station.address || ''}<br>Price: ${markerLabel}`)
            .addTo(stationMarkers);
    });

    statusDiv.innerText = `Found ${displayListings.length} matching tracking results inside active viewport boundaries.`;

    if (displayListings.length > 0) {
        displayListings.sort((a, b) => a[chosenFuelType] - b[chosenFuelType]);
        displayListings.slice(0, 3).forEach(function(stn) {
            const c = getCoordinates(stn);
            var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
            li.innerHTML = `<strong>${stn.brand || 'Independent'}</strong> - <span style="color:green;font-weight:bold;">${stn[chosenFuelType]}p</span>`;
            li.onclick = () => { map.flyTo([c.lat, c.lon], 14); };
            document.getElementById('topStationsList').appendChild(li);
        });
        document.getElementById('topStationsContainer').style.display = 'block';

        if (currentMode === 'route' && lastSavedRouteData) {
            var distMeters = lastSavedRouteData.features[0].properties.summary.distance;
            var mpg = parseFloat(document.getElementById('mpg').value) || 45;
            var miles = distMeters / 1609.34;
            var cost = ((miles / mpg) * 4.54609) * (cheapestPriceFound / 100);

            document.getElementById('summaryDistance').innerText = miles.toFixed(1);
            document.getElementById('summaryCost').innerText = '£' + cost.toFixed(2);
            document.getElementById('costSummary').style.display = 'block';
        }
    } else {
        document.getElementById('topStationsContainer').style.display = 'none';
        if(currentMode === 'route') document.getElementById('costSummary').style.display = 'none';
    }
}

function clearWaypointField(index) {
    document.getElementById('input-' + index).value = '';
    document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none';
    waypointsList[index] = { coordinates: null, rawText: "" };
}
function removeWaypointField(index, rowId) { document.getElementById(rowId).remove(); waypointsList[index] = null; if(lastSavedRouteData) calculateJourney(); }
function getMarkerColor(p) { return !p ? '#7f8c8d' : p <= 135 ? '#2ecc71' : p <= 145 ? '#e67e22' : '#e74c3c'; }
function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
function setupTab1Autocomplete() {}
function addDragAndDropListeners(row) {}
function reorderWaypointsDataMatrix() {}
function exportItineraryToCSV() {}
