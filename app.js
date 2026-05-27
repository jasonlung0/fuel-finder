// CRITICAL CREDENTIAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3TTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map with default UK viewing frame
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: { countrycodes: 'gb', limit: 10 },
    headers: { 'User-Agent': 'UK-Fuel-Finder-App-v1.0 (Contact: jasonlung0@github)' }
});

// FIXED: Corrected tile layer URL paths to resolve domain connection issues
const themes = {
    light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '© OpenStreetMap contributors' 
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
        attribution: '© OpenStreetMap contributors, © CartoDB' 
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' 
    })
};
let activeTheme = themes.light.addTo(map);

let currentMode = 'local'; // 'local' or 'route'
let localSelectedCoordinates = null;
let waypointsList = []; 
let routeLayer = null;
let stationMarkers = L.layerGroup().addTo(map);
let lastSavedRouteData = null;
let currentlyFilteredStations = [];
let draggedElement = null;

// APP LIFECYCLE INITIALIZATION ENTRY POINT
window.addEventListener('load', function() {
    map.invalidateSize();
    setupTab1Autocomplete();
    
    // Instanced Route UI elements readying
    addNewWaypointField("Start");
    addNewWaypointField("Destination");

    // Trigger Browser Geolocation Detection Immediately
    if (navigator.geolocation) {
        document.getElementById('status').innerText = "Requesting device GPS anchor...";
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                document.getElementById('status').innerText = "Position acquired. Loading nearby forecourts...";
                map.setView([lat, lon], 12); 
            },
            function(error) {
                document.getElementById('status').innerText = "GPS denied. Defaulting to national overview.";
                refreshPricesOnViewChange();
            },
            { timeout: 7000 }
        );
    } else {
        document.getElementById('status').innerText = "Device lacks GPS access. Showing complete UK overview.";
        refreshPricesOnViewChange();
    }
});

// Automated Idle Pan/Zoom Price Loading Engine
map.on('moveend', function() {
    if (currentMode === 'local') {
        refreshPricesOnViewChange();
    }
});

// UI TAB PANEL TOGGLE MECHANIC
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if (tabId === 'local-tab') {
        currentMode = 'local';
        document.querySelector("[onclick=\"switchTab('local-tab')\"]").classList.add('active');
        document.getElementById('local-tab').classList.add('active');
        document.getElementById('bufferRadiusContainer').style.display = 'none';
        document.getElementById('costSummary').style.display = 'none';
        if(routeLayer) map.removeLayer(routeLayer);
        refreshPricesOnViewChange();
    } else {
        currentMode = 'route';
        document.querySelector("[onclick=\"switchTab('route-tab')\"]").classList.add('active');
        document.getElementById('route-tab').classList.add('active');
        document.getElementById('bufferRadiusContainer').style.display = 'block';
        if (lastSavedRouteData) {
            if (routeLayer) routeLayer.addTo(map);
            filterFuelStationsRouteMode(lastSavedRouteData);
        } else {
            stationMarkers.clearLayers();
            document.getElementById('topStationsContainer').style.display = 'none';
            document.getElementById('status').innerText = "Ready - Enter terminal addresses to scan corridor.";
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

// FIXED: Cleaned up inline attribute formatting references
document.getElementById('filterEV').addEventListener('change', refreshPricesOnViewChange);
document.getElementById('filterUnleaded').addEventListener('change', refreshPricesOnViewChange);

// TAB 1 SINGLE ADDRESS SELECTION LOGIC
function setupTab1Autocomplete() {
    const input = document.getElementById('localSearchInput');
    const suggestionsDiv = document.getElementById('localSuggestions');
    const clearBtn = document.getElementById('localClearBtn');

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        clearBtn.style.display = query.length > 0 ? 'block' : 'none';

        if (query.length < 3) { suggestionsDiv.style.display = 'none'; return; }

        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { suggestionsDiv.style.display = 'none'; return; }

            results.forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px';
                row.style.borderBottom = '1px solid #f1f3f4'; row.innerText = item.label;
                row.onclick = function() {
                    input.value = item.label;
                    suggestionsDiv.style.display = 'none';
                    localSelectedCoordinates = [item.x, item.y];
                    map.setView([item.y, item.x], 13);
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) { console.error(err); }
    }, 400));
}

function clearLocalSearch() {
    document.getElementById('localSearchInput').value = '';
    document.getElementById('localSuggestions').style.display = 'none';
    document.getElementById('localClearBtn').style.display = 'none';
    localSelectedCoordinates = null;
}

function zoomToLocalSelection() {
    const inputVal = document.getElementById('localSearchInput').value;
    if (!inputVal) { alert('Please enter an address location target to scan.'); return; }
    refreshPricesOnViewChange();
}

// AUTOMATED MAP VIEWPORT RADIAL MATRICES (TAB 1)
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

    // Direct regional parameters SQL fetch query payload
    const sqlQuery = "SELECT * WHERE J >= " + minLat + " AND J <= " + maxLat + " AND K >= " + minLon + " AND K <= " + maxLon;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const liveStations = results.data;
            let displayListings = [];
            currentlyFilteredStations = [];
            document.getElementById('topStationsList').innerHTML = '';

            liveStations.forEach(function(station) {
                if (!station.lat || !station.lon) return;
                if (requiresEV && station.has_ev !== true && station.has_ev !== "TRUE") return;
                if (requiresUnleaded && station.has_unleaded !== true && station.has_unleaded !== "TRUE") return;

                const price = station[chosenFuelType];
                if (price) {
                    displayListings.push(station);
                    currentlyFilteredStations.push(station);
                }

                const markerLabel = station[chosenFuelType] ? station[chosenFuelType] + 'p' : 'N/A';
                const markerColor = getMarkerColor(station[chosenFuelType]);

                const divIconTemplate = L.divIcon({
                    className: 'price-badge-container',
                    html: `<div class="custom-price-marker" style="background-color: ${markerColor};">${markerLabel}</div>`,
                    iconSize: [46, 22], iconAnchor: [23, 11]
                });

                L.marker([station.lat, station.lon], { icon: divIconTemplate })
                .on('click', function() { displayStationDetailSheet(station); })
                .addTo(stationMarkers);
            });

            statusDiv.innerText = `Found ${displayListings.length} stations inside current view map viewport.`;
            
            if (displayListings.length > 0) {
                displayListings.sort((a,b) => a[chosenFuelType] - b[chosenFuelType]);
                displayListings.slice(0, 3).forEach(function(stn) {
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = '<strong>' + stn.brand + '</strong> - <span style="color:green;font-weight:bold;">' + stn[chosenFuelType] + 'p</span>';
                    li.onclick = function() { map.flyTo([stn.lat, stn.lon], 14); displayStationDetailSheet(stn); };
                    document.getElementById('topStationsList').appendChild(li);
                });
                document.getElementById('topStationsContainer').style.display = 'block';
            } else {
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    });
}

// TAB 2 ROUTE SYSTEM LOGIC ARCHITECTURE
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    const validCoords = waypointsList
        .filter(wp => wp && wp.coordinates)
        .map(wp => [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]);

    if (validCoords.length < 2) { alert('Please choose address suggestions from the dropdown list for at least 2 itinerary rows.'); return; }

    statusDiv.innerText = "Routing dynamic spatial course via ORS...";
    stationMarkers.clearLayers();
    if (routeLayer) map.removeLayer(routeLayer);

    try {
        const apiUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Accept': 'application/json, application/geo+json; charset=utf-8', 'Content-Type': 'application/json', 'Authorization': ORS_API_KEY },
            body: JSON.stringify({ "coordinates": validCoords })
        });

        if (!response.ok) throw new Error(await response.text());

        const routeData = await response.json();
        lastSavedRouteData = routeData;

        routeLayer = L.geoJSON(routeData, {
            coordsToLatLng: function(coords) { return new L.LatLng(coords[1], coords[0]); },
            style: { color: '#1a73e8', weight: 5, opacity: 0.85 }
        }).addTo(map);
        
        map.fitBounds(routeLayer.getBounds());
        filterFuelStationsRouteMode(routeData);
    } catch (err) {
        console.error(err); statusDiv.innerText = "Error mapping route coordinates.";
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

    const sqlQuery = "SELECT * WHERE B >= " + minLat + " AND B <= " + maxLat + " AND C >= " + minLon + " AND C <= " + maxLon;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    Papa.parse(liveDynamicSheetUrl, {
        download: true, header: true, dynamicTyping: true,
        complete: function(results) {
            const liveStations = results.data;
            const bufferedCorridor = turf.buffer(routeData.features[0], selectedRadius, {units: 'kilometers'});
            
            let cheapestPriceFound = Infinity;
            let validStationsAlongRoute = [];
            currentlyFilteredStations = [];
            document.getElementById('topStationsList').innerHTML = '';

            liveStations.forEach(function(station) {
                if (!station.lat || !station.lon) return;
                if (requiresEV && station.has_ev !== true && station.has_ev !== "TRUE") return;
                if (requiresUnleaded && station.has_unleaded !== true && station.has_unleaded !== "TRUE") return;

                const point = turf.point([station.lon, station.lat]);
                if (turf.booleanPointInPolygon(point, bufferedCorridor)) {
                    const price = station[chosenFuelType];
                    if (price) {
                        validStationsAlongRoute.push(station);
                        currentlyFilteredStations.push(station);
                        if (price < cheapestPriceFound) cheapestPriceFound = price;
                    }

                    const markerLabel = station[chosenFuelType] ? station[chosenFuelType] + 'p' : 'N/A';
                    const markerColor = getMarkerColor(station[chosenFuelType]);

                    const divIconTemplate = L.divIcon({
                        className: 'price-badge-container',
                        html: `<div class="custom-price-marker" style="background-color: ${markerColor};">${markerLabel}</div>`,
                        iconSize: [46, 22], iconAnchor: [23, 11]
                    });

                    L.marker([station.lat, station.lon], { icon: divIconTemplate })
                    .on('click', function() { displayStationDetailSheet(station); })
                    .addTo(stationMarkers);
                }
            });

            if (validStationsAlongRoute.length > 0) {
                statusDiv.innerText = "Mapped " + validStationsAlongRoute.length + " corridor fuel items.";
                validStationsAlongRoute.sort((a,b) => a[chosenFuelType] - b[chosenFuelType]);
                
                validStationsAlongRoute.slice(0, 3).forEach(function(stn) {
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = '<strong>' + stn.brand + '</strong> - <span style="color:green;font-weight:bold;">' + stn[chosenFuelType] + 'p</span>';
                    li.onclick = function() { map.flyTo([stn.lat, stn.lon], 14); displayStationDetailSheet(stn); };
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
                statusDiv.innerText = "No forecourts match parameters in corridor.";
                document.getElementById('costSummary').style.display = 'none';
                document.getElementById('topStationsContainer').style.display = 'none';
            }
        }
    });
}

// DATA VISUAL SHEET POPUP CONTROL
function displayStationDetailSheet(station) {
    document.getElementById('sheetBrand').innerText = station.brand || "Independent Station";
    document.getElementById('sheetAddress').innerText = station.address ? station.address : `Coords: [${station.lat.toFixed(4)}, ${station.lon.toFixed(4)}]`;
    
    document.getElementById('sheetE10').innerText = station.e10 ? station.e10 + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = station.b7 ? station.b7 + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = station.e5 ? station.e5 + 'p' : 'N/A';
    
    let capabilities = [];
    if (station.has_ev === true || station.has_ev === "TRUE") capabilities.push("⚡ EV Charger");
    if (station.has_unleaded === true || station.has_unleaded === "TRUE") capabilities.push("⛽ Main Pump");
    document.getElementById('sheetCapabilities').innerHTML = capabilities.join(' | ');

    document.getElementById('stationDetailSheet').style.display = 'flex';
}

function getMarkerColor(p) { return !p ? '#7f8c8d' : p <= 135 ? '#2ecc71' : p <= 145 ? '#e67e22' : '#e74c3c'; }

function debounce(func, delay) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }

// DYNAMIC WAYPOINT INPUT FIELDS MULTI-ROUTING STACK MANAGER
function addNewWaypointField(customLabel) {
    if (!customLabel) customLabel = "Stop";
    var container = document.getElementById('waypointContainer');
    var index = waypointsList.length;
    waypointsList.push({ coordinates: null, rawText: "" });

    var rowId = 'waypoint-row-' + index;
    var row = document.createElement('div');
    row.id = rowId; row.className = 'draggable-waypoint-row';
    row.setAttribute('data-index', index); row.setAttribute('draggable', 'true');
    row.style.zIndex = (100 - index);

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

    var htmlString = '<span style="color: #b0b4b9; font-size: 16px; padding: 0 4px; user-select: none;">⋮⋮</span>' +
        '<div style="position: relative; flex-grow: 1;">' +
        '    <input type="text" id="input-' + index + '" placeholder="' + customLabel + '..." style="width: 100%;" autocomplete="off">' +
        '    <span id="clear-' + index + '" onclick="clearWaypointField(' + index + ')" style="position: absolute; right: 10px; top: 10px; cursor: pointer; color: #70757a; font-weight: bold; display: none;">×</span>' +
        '    <div id="suggest-' + index + '" class="suggestions-box"></div>' +
        '</div>';

    if (!isCoreField) {
        htmlString += '<button onclick="removeWaypointField(' + index + ', \'' + rowId + '\')" style="background:none; border:none; color:#ea4335; font-size:18px; cursor:pointer; padding:0 5px; width:auto;">🗑️</button>';
    } else {
        htmlString += '<div style="width:28px;"></div>';
    }

    row.innerHTML = htmlString; container.appendChild(row);
    setupDynamicRouteAutocomplete(index);
    addDragAndDropListeners(row);
}

function removeWaypointField(index, rowId) { document.getElementById(rowId).remove(); waypointsList[index] = null; if(lastSavedRouteData) calculateJourney(); }
function clearWaypointField(index) {
    document.getElementById('input-' + index).value = ''; document.getElementById('suggest-' + index).style.display = 'none';
    document.getElementById('clear-' + index).style.display = 'none'; waypointsList[index] = { coordinates: null, rawText: "" };
}

function addDragAndDropListeners(row) {
    row.addEventListener('dragstart', function(e) { draggedElement = row; row.style.opacity = '0.3'; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', function() { draggedElement.style.opacity = '1'; draggedElement = null; reorderWaypointsDataMatrix(); });
    row.addEventListener('dragover', function(e) {
        e.preventDefault(); if (row === draggedElement) return;
        const container = document.getElementById('waypointContainer');
        const bounding = row.getBoundingClientRect(); const offset = e.clientY - bounding.top - (bounding.height / 2);
        if (offset < 0) container.insertBefore(draggedElement, row); else container.insertBefore(draggedElement, row.nextSibling);
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
        row.style.zIndex = (100 - idx);
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

function setupDynamicRouteAutocomplete(index) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);

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
                row.style.padding = '10px 12px'; row.style.cursor = 'pointer'; row.style.fontSize = '13px'; row.style.borderBottom = '1px solid #f1f3f4';
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

function exportItineraryToCSV() {
    if (currentlyFilteredStations.length === 0) return;
    var headers = ["Station Name", "Latitude", "Longitude", "E10 (p)", "B7 (p)", "E5 (p)"];
    var rows = currentlyFilteredStations.map(function(s) { return ['="' + s.brand + '"', s.lat, s.lon, s.e10||"N/A", s.b7||"N/A", s.e5||"N/A"]; });
    var csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(function(e) { return e.join(","); })].join("\n");
    var link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `fuel_export.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
