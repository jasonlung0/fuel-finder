// CRITICAL CREDENTIAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3TTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map with default UK viewing frame
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 10 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0 (Contact: jasonlung0@github)' }
});

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap contributors, © CartoDB' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; 
let localSelectedCoordinates = null;
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let draggedElement = null;

window.addEventListener('load', function() {
    map.invalidateSize();
    setupTab1Autocomplete();
    
    addNewWaypointField("Start");
    addNewWaypointField("Destination");

    if (navigator.geolocation) {
        document.getElementById('status').innerText = "Requesting device GPS anchor...";
        navigator.geolocation.getCurrentPosition(
            function(position) {
                map.setView([position.coords.latitude, position.coords.longitude], 12); 
            },
            function(error) {
                document.getElementById('status').innerText = "GPS denied. Defaulting to national overview.";
                refreshPricesOnViewChange();
            },
            { timeout: 7000 }
        );
    } else {
        refreshPricesOnViewChange();
    }
});

map.on('moveend', function() {
    if (currentMode === 'local') {
        refreshPricesOnViewChange();
    }
});

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.getElementById('local-tab').classList.add('active');
        document.getElementById('bufferRadiusContainer').style.display = 'none';
        document.getElementById('costSummary').style.display = 'none';
        if(routeLayer) map.removeLayer(routeLayer);
        refreshPricesOnViewChange();
    } else {
        currentMode = 'route';
        document.getElementById('route-tab').classList.add('active');
        document.getElementById('bufferRadiusContainer').style.display = 'block';
        if (lastSavedRouteData) {
            if (!map.hasLayer(routeLayer) && routeLayer) routeLayer.addTo(map);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            stationMarkers.clearLayers();
            document.getElementById('topStationsContainer').style.display = 'none';
        }
    }
}

function refreshPricesOnViewChange() {
    if (currentMode === 'local') {
        filterFuelStationsLocalMode();
    } else if (currentMode === 'route' && lastSavedRouteData) {
        filterFuelStationsRouteMode(lastSavedRouteData);
    }
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

// Helper function to extract lat/lon regardless of header casing or naming conventions
function getCoordinates(station) {
    const latKeys = ['lat', 'latitude', 'Latitude', 'LAT', 'J'];
    const lonKeys = ['lon', 'lng', 'longitude', 'Longitude', 'LON', 'K'];
    
    let lat = null, lon = null;
    for (let key of latKeys) { if (station[key] !== undefined && station[key] !== null) { lat = parseFloat(station[key]); break; } }
    for (let key of lonKeys) { if (station[key] !== undefined && station[key] !== null) { lon = parseFloat(station[key]); break; } }
    
    return (isNaN(lat) || isNaN(lon)) ? null : { lat, lon };
}

// SCAN VIEWPORT ENGINE (TAB 1)
function filterFuelStationsLocalMode() {
    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Scanning view frame boundaries...";
    stationMarkers.clearLayers();

    const currentBounds = map.getBounds();
    const minLat = currentBounds.getSouth();
    const maxLat = currentBounds.getNorth();
    const minLon = currentBounds.getWest();
    const maxLon = currentBounds.getEast();

    const requiresEV = document.getElementById('filterEV').checked;
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;

    // Target columns J (Latitude) and K (Longitude) matching your spreadsheet structure
    const sqlQuery = `SELECT * WHERE J >= ${minLat} AND J <= ${maxLat} AND K >= ${minLon} AND K <= ${maxLon}`;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const liveStations = results.data;
            let displayListings = [];
            currentlyFilteredStations = [];
            document.getElementById('topStationsList').innerHTML = '';

            liveStations.forEach(function(station) {
                const coords = getCoordinates(station);
                if (!coords) return; 

                if (requiresEV && station.has_ev !== true && station.has_ev !== "TRUE") return;
                if (requiresUnleaded && station.has_unleaded !== true && station.has_unleaded !== "TRUE") return;

                const price = station[chosenFuelType];
                if (price) {
                    displayListings.push(station);
                    currentlyFilteredStations.push(station);
                }

                const markerLabel = price ? price + 'p' : 'N/A';
                const markerColor = getMarkerColor(price);

                const divIconTemplate = L.divIcon({
                    className: 'price-badge-container',
                    html: `<div class="custom-price-marker" style="background-color: ${markerColor}; border: 1px solid white; color: white; font-weight: bold; padding: 2px 5px; border-radius: 4px; font-size: 11px;">${markerLabel}</div>`,
                    iconSize: [46, 22]
                });

                L.marker([coords.lat, coords.lon], { icon: divIconTemplate })
                .on('click', function() { displayStationDetailSheet(station, coords); })
                .addTo(stationMarkers);
            });

            statusDiv.innerText = `Found ${displayListings.length} stations inside view frame viewport.`;
            
            if (displayListings.length > 0) {
                displayListings.sort((a,b) => a[chosenFuelType] - b[chosenFuelType]);
                displayListings.slice(0, 3).forEach(function(stn) {
                    const c = getCoordinates(stn);
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = `<strong>${stn.brand || 'Independent'}</strong> - <span style="color:green;font-weight:bold;">${stn[chosenFuelType]}p</span>`;
                    li.onclick = function() { map.flyTo([c.lat, c.lon], 14); displayStationDetailSheet(stn, c); };
                    document.getElementById('topStationsList').appendChild(li);
                });
                document.getElementById('topStationsContainer').style.display = 'block';
            } else {
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    });
}

// CORRIDOR ROUTE ENGINE (TAB 2)
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList
        .filter(wp => wp && wp.coordinates)
        .map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { alert('Please choose addresses from the dropdown list for at least 2 fields.'); return; }

    statusDiv.innerText = "Routing spatial corridor route...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const apiUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Accept': 'application/json, application/geo+json;', 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
            body: JSON.stringify({ "coordinates": validCoords })
        });

        if (!response.ok) throw new Error(await response.text());

        const routeData = await response.json();
        lastSavedRouteData = routeData;

        routeLayer = L.geoJSON(routeData, {
            style: { color: '#1a73e8', weight: 5, opacity: 0.85 }
        }).addTo(map);
        
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); statusDiv.innerText = "Error requesting route track.";
    }
}

function filterFuelStationsRouteMode(routeData) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Buffering journey tracking polygon...";
    stationMarkers.clearLayers();

    const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
    const requiresEV = document.getElementById('filterEV').checked;
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;

    const routeBBox = turf.bbox(routeData);  
    const paddingDegrees = (selectedRadius / 111.32) + 0.05;  

    const minLon = routeBBox[0] - paddingDegrees; const minLat = routeBBox[1] - paddingDegrees;
    const maxLon = routeBBox[2] + paddingDegrees; const maxLat = routeBBox[3] + paddingDegrees;

    const sqlQuery = `SELECT * WHERE J >= ${minLat} AND J <= ${maxLat} AND K >= ${minLon} AND K <= ${maxLon}`;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const liveStations = results.data;
            // FIX: target feature[0] directly to provide a valid GeoJSON feature to the Turf buffer tool
            const bufferedCorridor = turf.buffer(routeData.features[0], selectedRadius, {units: 'kilometers'});
            
            let cheapestPriceFound = Infinity;
            let validStationsAlongRoute = [];
            currentlyFilteredStations = [];
            document.getElementById('topStationsList').innerHTML = '';

            liveStations.forEach(function(station) {
                const coords = getCoordinates(station);
                if (!coords) return;

                if (requiresEV && station.has_ev !== true && station.has_ev !== "TRUE") return;
                if (requiresUnleaded && station.has_unleaded !== true && station.has_unleaded !== "TRUE") return;

                const point = turf.point([coords.lon, coords.lat]);
                if (turf.booleanPointInPolygon(point, bufferedCorridor)) {
                    const price = station[chosenFuelType];
                    if (price) {
                        validStationsAlongRoute.push(station);
                        currentlyFilteredStations.push(station);
                        if (price < cheapestPriceFound) cheapestPriceFound = price;
                    }

                    const markerLabel = price ? price + 'p' : 'N/A';
                    const markerColor = getMarkerColor(price);

                    const divIconTemplate = L.divIcon({
                        className: 'price-badge-container',
                        html: `<div class="custom-price-marker" style="background-color: ${markerColor}; border: 1px solid white; color: white; font-weight: bold; padding: 2px 5px; border-radius: 4px; font-size: 11px;">${markerLabel}</div>`,
                        iconSize: [46, 22]
                    });

                    L.marker([coords.lat, coords.lon], { icon: divIconTemplate })
                    .on('click', function() { displayStationDetailSheet(station, coords); })
                    .addTo(stationMarkers);
                }
            });

            if (validStationsAlongRoute.length > 0) {
                statusDiv.innerText = `Mapped ${validStationsAlongRoute.length} corridor fuel stations.`;
                validStationsAlongRoute.sort((a,b) => a[chosenFuelType] - b[chosenFuelType]);
                
                validStationsAlongRoute.slice(0, 3).forEach(function(stn) {
                    const c = getCoordinates(stn);
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = `<strong>${stn.brand || 'Independent'}</strong> - <span style="color:green;font-weight:bold;">${stn[chosenFuelType]}p</span>`;
                    li.onclick = function() { map.flyTo([c.lat, c.lon], 14); displayStationDetailSheet(stn, c); };
                    document.getElementById('topStationsList').appendChild(li);
                });
                document.getElementById('topStationsContainer').style.display = 'block';

                var distMeters = routeData.features[0].properties.summary.distance;
                var mpg = parseFloat(document.getElementById('mpg').value) || 45;
                var miles = distMeters / 1609.34;
                var cost = ((miles / mpg) * 4.54609) * (cheapestPriceFound / 100);

                document.getElementById('summaryDistance').innerText = miles.toFixed(1);
                document.getElementById('summaryCost').innerText = '£' + cost.toFixed(2);
                document.getElementById('costSummary').style.display = 'block';
            } else {
                statusDiv.innerText = "No forecourts match parameters in route corridor.";
                document.getElementById('costSummary').style.display = 'none';
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    });
}

function displayStationDetailSheet(station, coords) {
    if (!document.getElementById('stationDetailSheet')) return;
    document.getElementById('sheetBrand').innerText = station.brand || "Independent Station";
    document.getElementById('sheetAddress').innerText = station.address ? station.address : `Coords: [${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}]`;
    
    document.getElementById('sheetE10').innerText = station.e10 ? station.e10 + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = station.b7 ? station.b7 + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = station.e5 ? station.e5 + 'p' : 'N/A';
    
    document.getElementById('stationDetailSheet').style.display = 'flex';
}

function getMarkerColor(p) { return !p ? '#7f8c8d' : p <= 135 ? '#2ecc71' : p <= 145 ? '#e67e22' : '#e74c3c'; }
function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }

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
                    map.setView([item.y, item.x], 13);
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

function addNewWaypointField(customLabel) {
    if (!customLabel) customLabel = "Stop";
    var container = document.getElementById('waypointContainer');
    var index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    var rowId = 'waypoint-row-' + index;
    var row = document.createElement('div');
    row.id = rowId; row.className = 'draggable-waypoint-row';
    row.setAttribute('data-index', index); row.setAttribute('draggable', 'true');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '5px';

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");
    var htmlString = `<span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none; cursor: grab;">⋮⋮</span>
        <div style="position: relative; flex-grow: 1;">
            <input type="text" id="input-${index}" placeholder="${customLabel}..." autocomplete="off">
            <div id="suggest-${index}" class="suggestions-box"></div>
        </div>`;

    if (!isCoreField) {
        htmlString += `<button onclick="removeWaypointField(${index}, '${rowId}')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; width:auto;">🗑️</button>`;
    }
    row.innerHTML = htmlString;
    container.appendChild(row);
    setupDynamicRouteAutocomplete(index);
    addDragAndDropListeners(row);
}

function setupDynamicRouteAutocomplete(index) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }
        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.innerText = item.label;
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

function removeWaypointField(index, rowId) { document.getElementById(rowId).remove(); waypointsList[index] = null; if(lastSavedRouteData) calculateJourney(); }
function addDragAndDropListeners(row) {}
function reorderWaypointsDataMatrix() {}
function exportItineraryToCSV() {}
