// CRITICAL CREDENTIAL CONFIGURATIONS
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZlMTc1YjJjNzFkMDQ5NjI5ZTY1ZWExNmQ3NTAyZDNkIiwiaCI6Im11cm11cjY0In0=';
const GOOGLE_SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR4rIqHLHn1BY6N0AWwpDTXJj0HkxGgtj_gthIpchXzxkwCxu-BPCy51bJqalR7Z8x4QPK2PiE1w0s0/pub?gid=1137635326&single=true&output=csv';

// Initialize Map
const map = L.map('map').setView([54.5, -3.5], 6);
const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: {
        countrycodes: 'gb', // Restricts autocomplete exclusively to the United Kingdom
        limit: 5            // Limits to top 5 closest matches
    },
    headers: {
        'User-Agent': 'UK-Fuel-Finder-App-v1.0 (Contact: jasonlung0@github)'
    }
});

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

document.getElementById('fuelType').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('mpg').addEventListener('input', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('filterEV').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });
document.getElementById('filterUnleaded').addEventListener('change', function() { if(lastSavedRouteData) filterFuelStations(lastSavedRouteData); });

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
    
    row.style.position = 'relative';
    row.style.zIndex = (100 - index); 
    row.style.background = '#ffffff';

    var isCoreField = (customLabel === "Start" || customLabel === "Destination");

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

function setupDynamicAutocomplete(index) {
    const input = document.getElementById("input-" + index);
    const suggestionsDiv = document.getElementById("suggest-" + index);
    const clearBtn = document.getElementById("clear-" + index);

    if (!input || !suggestionsDiv) return;

    input.addEventListener('input', debounce(async function(e) {
        const query = e.target.value;
        if (clearBtn) clearBtn.style.display = query.length > 0 ? 'block' : 'none';
        waypointsList[index].rawText = query;

        if (query.length < 3) { 
            suggestionsDiv.style.display = 'none'; 
            return; 
        }

        try {
            const results = await searchProvider.search({ query: query });
            suggestionsDiv.innerHTML = '';
            if (!results || results.length === 0) { 
                suggestionsDiv.style.display = 'none'; 
                return; 
            }

            results.slice(0, 5).forEach(function(item) {
                const row = document.createElement('div');
                row.style.padding = '10px 12px'; 
                row.style.cursor = 'pointer'; 
                row.style.fontSize = '13px'; 
                row.style.borderBottom = '1px solid #f1f3f4';
                row.style.color = '#333';
                row.innerText = item.label;

                row.onmouseover = function() { row.style.background = '#f1f3f4'; };
                row.onmouseout = function() { row.style.background = 'white'; };
                
                row.onclick = function() {
                    input.value = item.label;
                    suggestionsDiv.style.display = 'none';
                    if (clearBtn) clearBtn.style.display = 'block';
                    waypointsList[index].coordinates = [item.x, item.y]; 
                };
                suggestionsDiv.appendChild(row);
            });
            suggestionsDiv.style.display = 'block';
        } catch (err) {
            console.error("Geocoding lookup error:", err);
        }
    }, 400));
}

function debounce(func, delay) {
    let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
}

// Multi-Waypoint Route Planner Post Call
async function calculateJourney() {
    const statusDiv = document.getElementById('status');
    
    const validCoords = waypointsList
        .filter(function(wp) { 
            return wp !== null && wp !== undefined && wp.coordinates !== null && wp.coordinates !== undefined; 
        })
        .map(function(wp) { 
            // OpenRouteService demands coordinates passed as [longitude, latitude]
            return [parseFloat(wp.coordinates[0]), parseFloat(wp.coordinates[1])]; 
        });

    if (validCoords.length < 2) { 
        alert('Please type an address and select a location from the dropdown suggestions list for at least 2 fields.'); 
        return; 
    }

    statusDiv.innerText = "Calculating dynamic journey path...";
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
            const errorMsg = await response.text();
            throw new Error("Server Rejected Request: " + errorMsg);
        }

        const routeData = await response.json();
        lastSavedRouteData = routeData;

        // FIXED CONFLICT: OpenRouteService returns coordinates natively as [Lon, Lat] arrays.
        // We use Leaflet's built-in mapping utility to automatically swap the ordering so GeoJSON handles it perfectly.
        routeLayer = L.geoJSON(routeData, {
            coordsToLatLng: function (coords) {
                return new L.LatLng(coords[1], coords[0]);
            },
            style: { color: '#1a73e8', weight: 5, opacity: 0.85 }
        }).addTo(map);
        
        map.fitBounds(routeLayer.getBounds());
        filterFuelStations(routeData);
    } catch (err) {
        console.error("Full System Error Log Details:", err); 
        statusDiv.innerText = "Error tracking path coordinates. Check browser inspect console.";
    }
}

// DRIVES THE INTERACTIVE SIDEBAR SHEET POPUP WITH DATA EXTRACTS
function displayStationDetailSheet(station) {
    document.getElementById('sheetBrand').innerText = station.brand || "Independent Station";
    document.getElementById('sheetAddress').innerText = station.address ? station.address : `Coords: [${station.lat.toFixed(4)}, ${station.lon.toFixed(4)}]`;
    
    // Process Price Rows
    document.getElementById('sheetE10').innerText = station.e10 ? station.e10 + 'p' : 'N/A';
    document.getElementById('sheetB7').innerText = station.b7 ? station.b7 + 'p' : 'N/A';
    document.getElementById('sheetE5').innerText = station.e5 ? station.e5 + 'p' : 'N/A';
    
    // Feature Tag Management
    let capabilities = [];
    if (station.has_ev === true || station.has_ev === "TRUE") capabilities.push("⚡ EV Charger");
    if (station.has_unleaded === true || station.has_unleaded === "TRUE") capabilities.push("⛽ Main Pump");
    document.getElementById('sheetCapabilities').innerHTML = capabilities.join(' | ');

    document.getElementById('stationDetailSheet').style.display = 'flex';
}

function filterFuelStations(routeData) {
    const statusDiv = document.getElementById('status');
    statusDiv.innerText = "Calculating journey boundaries...";
    stationMarkers.clearLayers();

    const selectedRadius = parseFloat(document.getElementById('bufferRadius').value);
    const requiresEV = document.getElementById('filterEV').checked;
    const requiresUnleaded = document.getElementById('filterUnleaded').checked;
    const chosenFuelType = document.getElementById('fuelType').value;

    const routeBBox = turf.bbox(routeData); 
    const paddingDegrees = (selectedRadius / 111.32) + 0.05; 

    const minLon = routeBBox[0] - paddingDegrees;
    const minLat = routeBBox[1] - paddingDegrees;
    const maxLon = routeBBox[2] + paddingDegrees;
    const maxLat = routeBBox[3] + paddingDegrees;

    const sqlQuery = "SELECT * WHERE B >= " + minLat + " AND B <= " + maxLat + " AND C >= " + minLon + " AND C <= " + maxLon;
    const liveDynamicSheetUrl = GOOGLE_SHEET_BASE_URL + "&tq=" + encodeURIComponent(sqlQuery);

    statusDiv.innerText = "Requesting regional data from Google...";

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

                    // RENDERS FLOATING HTML PRICE BADGES DIRECTLY ON THE MAP
                    const markerLabel = station[chosenFuelType] ? station[chosenFuelType] + 'p' : 'N/A';
                    const markerColor = getMarkerColor(station[chosenFuelType]);

                    const divIconTemplate = L.divIcon({
                        className: 'price-badge-container',
                        html: `<div class="custom-price-marker" style="background-color: ${markerColor};">${markerLabel}</div>`,
                        iconSize: [46, 22],
                        iconAnchor: [23, 11]
                    });

                    L.marker([station.lat, station.lon], { icon: divIconTemplate })
                    .on('click', function() {
                        displayStationDetailSheet(station);
                    })
                    .addTo(stationMarkers);
                }
            });

            if (validStationsAlongRoute.length > 0) {
                statusDiv.innerText = "Mapped " + validStationsAlongRoute.length + " stations within corridor.";
                validStationsAlongRoute.sort(function(a, b) { return a[chosenFuelType] - b[chosenFuelType]; });
                
                validStationsAlongRoute.slice(0, 3).forEach(function(stn) {
                    var li = document.createElement('li'); li.style.cursor = 'pointer'; li.style.padding = '4px';
                    li.innerHTML = '<strong>' + stn.brand + '</strong> - <span style="color:green;font-weight:bold;">' + stn[chosenFuelType] + 'p</span>';
                    li.onclick = function() { 
                        map.flyTo([stn.lat, stn.lon], 14); 
                        displayStationDetailSheet(stn);
                    };
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

function getMarkerColor(p) { return !p ? '#7f8c8d' : p <= 135 ? '#2ecc71' : p <= 145 ? '#e67e22' : '#e74c3c'; }

function exportItineraryToCSV() {
    if (currentlyFilteredStations.length === 0) return;
    var headers = ["Station Name", "Latitude", "Longitude", "E10 (p)", "B7 (p)", "E5 (p)"];
    var rows = currentlyFilteredStations.map(function(s) { return ['"' + s.brand + '"', s.lat, s.lon, s.e10||"N/A", s.b7||"N/A", s.e5||"N/A"]; });
    var csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(function(e) { return e.join(","); })].join("\n");
    var link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `fuel_itinerary.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
