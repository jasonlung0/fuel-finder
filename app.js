// CRITICAL CREDENTIAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0gid=1137635326&single=true&/gviz/tq?tqx=out:csv&';

// Initialize Map
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider();

const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }),
    dark: L.tileLayer('https://{s}://{z}/{x}/{y}{r}.png', { attribution: '© CartoDB' }),
    satellite: L.tileLayer('https://arcgisonline.com{z}/{y}/{x}', { attribution: '© Esri' })
};
let activeTheme = themes.light.addTo(map);

let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let draggedElement = null;

// FIXED BOOT TIMING: Wait for CSS layouts to stabilize completely before drawing Leaflet bounds
window.addEventListener('load', function() {
    map.invalidateSize();
    addNewWaypointField("Start");
    addNewWaypointField("Destination");
    document.getElementById('status').innerText = 'Ready - Search a route to scan fuel';
});

function changeMapTheme(themeName) {
    map.removeLayer(activeTheme);
    activeTheme = themes[themeName];
    activeTheme.addTo(map);
}

function updateRadiusLabel(val) {
    document.getElementById('radiusVal').innerText = val;
    if (lastSavedRouteData) filterFuelStations(lastSavedRouteData);
}

// Add Listeners to Dropdowns for Live Recalculations
document.getElementById('fuelType').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('mpg').addEventListener('input', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('filterEV').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('filterUnleaded').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });

// Add/Remove Dynamic Stop Inputs Mechanics (Corrected Layout Focus)
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
    row.style.cursor = 'grab';

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

    // FIXED: Ensured class names and wrapper tags match our background geocoding handlers exactly
    var htmlString = '<span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none;">⋮⋮</span>' +
        '<div style="position: relative; flex-grow: 1;">' +
        '    <input type="text" id="input-' + index + '" placeholder="' + customLabel + '..." style="width: 100%;" autocomplete="off">' +
        '    <span id="clear-' + index + '" onclick="clearWaypointField(' + index + ')" style="position: absolute; right: 10px; top: 10px; cursor: pointer; color: #70757a; font-weight: bold; display: none;">×</span>' +
        '    <div id="suggest-' + index + '" class="suggestions-box" style="position: absolute; top: 40px; left: 0; width: 100%; background: white; border: 1px solid #dadce0; z-index: 9999; display: none; max-height: 200px; overflow-y: auto; border-radius: 0 0 4px 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"></div>' +
        '</div>';

    if (!isCoreField) {
        htmlString += '<button onclick="removeWaypointField(' + index + ', \'' + rowId + '\')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; padding:0 5px; width:auto;">🗑️</button>';
    } else {
        htmlString += '<div style="width:28px;"></div>';
    }

    row.innerHTML = htmlString;
    container.appendChild(row);
    
    // Explicitly wake up the dynamic autocomplete tracking engine for this input card
    setupDynamicAutocomplete(index);
    addDragAndDropListeners(row);
}

function removeWaypointField(index, rowId) {
    document.getElementById(rowId).remove();
    waypointsList[index] = null;
    if(lastSavedRouteData) calculateJourney();
}

function clearWaypointField(index) {
    document.getElementById('input-' + index).value = '';
    document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none';
    waypointsList[index] = { coordinates: null, rawText: "" };
}

// Drag and Drop Layout Positioning Script Engine
function addDragAndDropListeners(row) {
    row.addEventListener('dragstart', function(e) { draggedElement = row; row.style.opacity = '0.3'; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', function() { draggedElement.style.opacity = '1'; draggedElement = null; reorderWaypointsDataMatrix(); });
    row.addEventListener('dragover', function(e) {
        e.preventDefault();
        if (row === draggedElement) return;
        const container = document.getElementById('waypointContainer');
        const bounding = row.getBoundingClientRect();
        const offset = e.clientY - bounding.top - (bounding.height / 2);
        if (offset < 0) container.insertBefore(draggedElement, row);
        else container.insertBefore(draggedElement, row.nextSibling);
    });
}

function reorderWaypointsDataMatrix() {
    const container = document.getElementById('waypointContainer');
    const visibleRows = container.querySelectorAll('.draggable-waypoint-row');
    let updatedNewList = [];

    visibleRows.forEach(function(row, idx) {
        const originalIndex = parseInt(row.getAttribute('data-index'));
        updatedNewList.push(waypointsList[originalIndex]);
        
        const inputField = row.querySelector('input');
        if (idx === 0) inputField.placeholder = "Start...";
        else if (idx === visibleRows.length - 1) inputField.placeholder = "Destination...";
        else inputField.placeholder = "Stop " + idx + "...";
    });

    waypointsList = updatedNewList;
    visibleRows.forEach(function(row, idx) {
        row.setAttribute('data-index', idx);
        row.querySelector('input').id = "input-" + idx;
        row.querySelector('.suggestions-box').id = "suggest-" + idx;
        row.querySelector('span').id = "clear-" + idx;
    });

    if (lastSavedRouteData) calculateJourney();
}

// Address Autocomplete Handlers
function setupDynamicAutocomplete(index) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        waypointsList[index].rawText = query;

        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }

        const results = await searchProvider.search({ query: query });
        suggestionsDiv.innerHTML = '';
        if (results.length === 0) { suggestionsDiv.style.display = 'none'; return; }

        results.slice(0, 5).forEach(function(item) {
            const row = document.createElement('div');
            row.style.padding = '8px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4';
            row.innerText = item.label;
            row.onmouseover = function() { row.style.background = '#f1f3f4'; };
            row.onmouseout = function() { row.style.background = 'white'; };
            row.onclick = function() {
                input.value = item.label;
                suggestionsDiv.style.display = 'none';
                waypointsList[index].coordinates = [item.x, item.y];
            };
            suggestionsDiv.appendChild(row);
        });
        suggestionsDiv.style.display = 'block';
    }, 400));
}

function debounce(func, delay) {
    let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
}

// Multi-Waypoint Route Planner Post Call
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList.filter(wp => wp !== null && wp.coordinates !== null).map(wp => wp.coordinates);

    if (validCoords.length < 2) { alert('Please select at least 2 locations from dropdown suggestions.'); return; }

    statusDiv.innerText = "Calculating dynamic journey...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const response = await fetch('https://openrouteservice.org', {
            method: 'POST',
            headers: { 'Accept': 'application/json, application/geo+json', 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
            body: JSON.stringify({ "coordinates": validCoords })
        });
        const routeData = await response.json();
        lastSavedRouteData = routeData;

        routeLayer = L.geoJSON(routeData, { style: { color: '#1a73e8', weight: 5, opacity: 0.85 } }).addTo(map);
        map.fitBounds(routeLayer.getBounds());

        filterFuelStations(routeData);
    } catch (err) {
        console.error(err); statusDiv.innerText = "Error tracking path coordinates.";
    }
}

// DYNAMIC SPATIAL PROCESSING SYNC ENGINE
function filterFuelStations(routeData) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Calculating journey boundaries...";
    stationMarkers.clearLayers();

    const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
    const requiresEV = document.getElementById('filterEV').checked;
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;

    // 1. Compute dynamic bounding box with buffer padding from your active journey coordinates
    const routeBBox = turf.bbox(routeData); 
    const paddingDegrees = (selectedRadius / 111.32) + 0.05; 

    const minLon = routeBBox[0] - paddingDegrees;
    const minLat = routeBBox[1] - paddingDegrees;
    const maxLon = routeBBox[2] + paddingDegrees;
    const maxLat = routeBBox[3] + paddingDegrees;

    // 2. Build explicit SQL filtering text command on-the-fly
    const sqlQuery = "SELECT * WHERE B >= " + minLat + " AND B <= " + maxLat + " AND C >= " + minLon + " AND C <= " + maxLon;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    statusDiv.innerText = "Requesting regional data from Google...";

    // 3. Stream data using the dynamic, server-side filtered URL endpoint
    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const liveStations = results.data;
            const bufferedCorridor = turf.buffer(routeData.features, selectedRadius, {units: 'kilometers'});
            
            let cheapestPriceFound = Infinity;
            let validStationsAlongRoute = [];
            currentlyFilteredStations = [];
            document.getElementById('topStationsList').innerHTML = '';

            liveStations.forEach(function(station) {
                if (!station.lat || !station.lon) return;
                if (requiresEV && station.has_ev !== true) return;
                if (requiresUnleaded && station.has_unleaded !== true) return;

                const point = turf.point([station.lon, station.lat]);
                if (turf.booleanPointInPolygon(point, bufferedCorridor)) {
                    const price = station[chosenFuelType];
                    if (price) {
                        validStationsAlongRoute.push(station);
                        currentlyFilteredStations.push(station);
                        if (price < cheapestPriceFound) cheapestPriceFound = price;
                    }

                    L.circleMarker([station.lat, station.lon], {
                        radius: 10, fillColor: getMarkerColor(station.e10), color: '#ffffff', weight: 2, fillOpacity: 0.9
                    })
                    .bindPopup('<div class="station-popup"><strong>' + station.brand + '</strong><br>E10: ' + station.e10 + 'p | B7: ' + station.b7 + 'p</div>')
                    .addTo(stationMarkers);
                }
            });

            if (validStationsAlongRoute.length > 0) {
                statusDiv.innerText = "Mapped " + validStationsAlongRoute.length + " stations within corridor.";
                validStationsAlongRoute.sort(function(a, b) { return a[chosenFuelType] - b[chosenFuelType]; });
                
                validStationsAlongRoute.slice(0, 3).forEach(function(stn) {
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = '<strong>' + stn.brand + '</strong> - <span style="color:green;font-weight:bold;">' + stn[chosenFuelType] + 'p</span>';
                    li.onclick = function() { map.flyTo([stn.lat, stn.lon], 14); };
                    document.getElementById('topStationsList').appendChild(li);
                });
                document.getElementById('topStationsContainer').style.display = 'block';

                // Process Distance Calculations
                var distMeters = routeData.features.properties.summary.distance;
                var mpg = parseFloat(document.getElementById('mpg').value) || 45;
                var miles = distMeters / 1609.34;
                var cost = ((miles / mpg) * 4.54609) * (cheapestPriceFound / 100);

                document.getElementById('summaryDistance').innerText = miles.toFixed(1);
                document.getElementById('summaryCost').innerText = '£' + cost.toFixed(2);
                document.getElementById('costSummary').style.display = 'block';
            } else {
                statusDiv.innerText = "No forecourts match parameters in corridor.";
                document.getElementById('costSummary').style.display = 'none';
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    });
}

function getMarkerColor(p) { return !p ? '#7f8c8d' : p <= 135 ? '#2ecc71' : p <= 145 ? '#e67e22' : '#e74c3c'; }

// CSV Export Script Generator Action
function exportItineraryToCSV() {
    if (currentlyFilteredStations.length === 0) return;
    var headers = ["Station Name", "Latitude", "Longitude", "E10 (p)", "B7 (p)"];
    var rows = currentlyFilteredStations.map(function(s) { return ['"' + s.brand + '"', s.lat, s.lon, s.e10||"N/A", s.b7||"N/A"]; });
    var csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(function(e) { return e.join(","); })].join("\n");
    var link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "fuel_itinerary.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
