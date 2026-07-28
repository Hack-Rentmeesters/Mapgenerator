(function () {
  'use strict';

  function formatNumber(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(number);
  }

  function getMapViewState() {
    try {
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    } catch (err) {
      return null;
    }
  }

  function restoreMapView(view) {
    if (!view || !Number.isFinite(view.lat) || !Number.isFinite(view.lng)) return;
    try { map.setView([view.lat, view.lng], Number(view.zoom) || map.getZoom()); } catch (err) {}
  }

  function stripFeatureCollection(fc) {
    return JSON.parse(JSON.stringify(fc || { type: 'FeatureCollection', features: [] }));
  }

  function selectedCount() {
    try { return getSelectedFeatureCollection().features.length; } catch (err) { return 0; }
  }

  function selectedArea() {
    try {
      return getExportFeatureCollection().totale_oppervlakte_m2 || 0;
    } catch (err) {
      return 0;
    }
  }

  function getParcelProjectLabel(feature) {
    if (!feature) return 'Onbekend perceel';

    try {
      if (typeof getParcelCodeFromFeature === 'function') {
        const code = getParcelCodeFromFeature(feature);
        if (code && code !== 'Onbekend perceel') return String(code);
      }
    } catch (err) {}

    const props = feature.properties || {};
    const gemeente =
      props.kadastralegemeentenaam ||
      props.kadastraleGemeenteNaam ||
      props.kadastraleGemeenteWaarde ||
      props.gemeentenaam ||
      props.gemeente ||
      props.kadastralegemeente ||
      '';
    const sectie =
      props.sectie ||
      props.kadastralesectie ||
      props.kadastraleSectie ||
      props.kadas_sectie ||
      '';
    const nummer =
      props.perceelnummer ||
      props.kadastraalperceelnummer ||
      props.kadastraalPerceelnummer ||
      props.kadas_perceelnummer ||
      props.perceelNummer ||
      '';

    if (gemeente && sectie && nummer) return `${gemeente} ${sectie} ${nummer}`;

    return String(
      props.kadastraleAanduiding ||
      props.kadastraleaanduiding ||
      props.label ||
      nummer ||
      'Onbekend perceel'
    );
  }

  function getSelectionProjectTitle(features) {
    const selected = Array.isArray(features) ? features : [];
    if (!selected.length) return 'Nog geen perceel geselecteerd';
    if (selected.length > 1) return `Cluster (${selected.length})`;
    return getParcelProjectLabel(selected[0]);
  }

  function initSituatietekening() {
    const adapter = {
      getState: function () {
        return {
          geojson: stripFeatureCollection(getExportFeatureCollection()),
          searchText: addressInputEl.value || '',
          clusterChoice: clusterChoiceEl.value || '',
          mapView: getMapViewState()
        };
      },
      getStateHash: function () {
        return {
          geojson: getExportFeatureCollection(),
          searchText: addressInputEl.value || '',
          clusterChoice: clusterChoiceEl.value || '',
          mapView: getMapViewState()
        };
      },
      restoreState: async function (state) {
        clearEditableLayers();
        addressInputEl.value = state && state.searchText ? state.searchText : '';
        if (state && state.geojson && Array.isArray(state.geojson.features) && state.geojson.features.length) {
          addImportedGeoJsonToMap({ type: 'FeatureCollection', features: state.geojson.features });
        }
        clusterChoiceEl.value = state && state.clusterChoice ? state.clusterChoice : '';
        updateInfoFromSelection();
        restoreMapView(state && state.mapView);
      },
      getProjectTitle: function () {
        return getSelectionProjectTitle(getSelectedFeatureCollection().features);
      },
      getProjectItemCount: function () {
        return selectedCount();
      },
      validate: function () {
        const count = selectedCount();
        const errors = [];
        if (!count) errors.push({ message: 'Selecteer minimaal één perceel of importeer een GeoJSON-bestand.', selector: '#map' });
        if (count > 1 && !clusterChoiceEl.value) {
          errors.push({ message: 'Kies hoe meerdere percelen op de tekening moeten worden weergegeven.', selector: '#clusterChoice' });
        }
        return errors;
      },
      getSummary: function () {
        const count = selectedCount();
        const choice = count <= 1
          ? 'Eén perceel per tekening'
          : (clusterChoiceEl.value === 'ja' ? 'Alle percelen op één tekening' : 'Elk perceel apart');
        return {
          rows: [
            { label: 'Aantal percelen', value: String(count) },
            { label: 'Totale oppervlakte', value: `${formatNumber(selectedArea())} m²` },
            { label: 'Weergave', value: choice },
            { label: 'Uitvoer', value: 'GeoJSON voor Situatietekening / Factsheet' }
          ]
        };
      },
      run: function () {
        downloadCurrentGeojson();
      },
      getProgress: function () {
        const count = selectedCount();
        return [
          !!addressInputEl.value.trim() || count > 0,
          count > 0,
          count > 0 && (count === 1 || !!clusterChoiceEl.value)
        ];
      }
    };

    RAUX.initTool({
      toolKey: 'situatietekening',
      toolName: 'Situatietekening / Factsheet',
      steps: ['Locatie zoeken', 'Percelen selecteren', 'Opties instellen', 'Controleren', 'Exporteren'],
      adapter,
      runButtonSelector: '#runBtn',
      runButtonLabel: 'Controleer & exporteer',
      reviewTitle: 'Controleer de Situatietekening / Factsheet',
      confirmLabel: 'Bevestigen en downloaden',
      successMessage: 'Het GeoJSON-bestand is gemaakt en wordt gedownload.'
    });
  }

  function getOfferteFeatures() {
    try { return getSelectedFeatureCollection().features; } catch (err) { return []; }
  }

  function getClusterValues() {
    return getOfferteFeatures().map(feature => feature && feature.properties ? feature.properties.Clusternummer : null);
  }

  function clustersComplete() {
    const features = getOfferteFeatures();
    if (!features.length) return false;
    return features.every(feature => {
      const raw = feature && feature.properties ? feature.properties.Clusternummer : null;
      if (raw === null || typeof raw === 'undefined' || String(raw).trim() === '') return false;
      const number = Number(raw);
      return Number.isFinite(number) && number >= 0 && number <= 10;
    });
  }

  function initOfferte() {
    const adapter = {
      getState: function () {
        return {
          geojson: stripFeatureCollection(getExportFeatureCollection()),
          searchText: addressInputEl.value || '',
          mapView: getMapViewState()
        };
      },
      getStateHash: function () {
        return {
          geojson: getExportFeatureCollection(),
          searchText: addressInputEl.value || '',
          mapView: getMapViewState()
        };
      },
      restoreState: async function (state) {
        clearEditableLayers();
        addressInputEl.value = state && state.searchText ? state.searchText : '';
        if (state && state.geojson && Array.isArray(state.geojson.features) && state.geojson.features.length) {
          addImportedGeoJsonToMap({ type: 'FeatureCollection', features: state.geojson.features });
        }
        updateInfoFromSelection();
        restoreMapView(state && state.mapView);
      },
      getProjectTitle: function () {
        return getSelectionProjectTitle(getOfferteFeatures());
      },
      getProjectItemCount: function () {
        return getOfferteFeatures().length;
      },
      validate: function () {
        const features = getOfferteFeatures();
        const errors = [];
        if (!features.length) {
          errors.push({ message: 'Selecteer minimaal één perceel of importeer een GeoJSON-bestand.', selector: '#map' });
          return errors;
        }
        const missing = features.filter(feature => {
          const value = feature && feature.properties ? feature.properties.Clusternummer : null;
          return value === null || typeof value === 'undefined' || String(value).trim() === '';
        }).length;
        const invalid = features.filter(feature => {
          const value = feature && feature.properties ? feature.properties.Clusternummer : null;
          if (value === null || typeof value === 'undefined' || String(value).trim() === '') return false;
          const number = Number(value);
          return !Number.isFinite(number) || number < 0 || number > 10;
        }).length;
        if (missing) errors.push({ message: `Vul voor ${missing} perceel/percelen nog een clusternummer in.`, selector: '.parcel-cluster-input' });
        if (invalid) errors.push({ message: 'Clusternummers moeten gehele getallen van 0 tot en met 10 zijn.', selector: '.parcel-cluster-input' });
        return errors;
      },
      getSummary: function () {
        const features = getOfferteFeatures();
        const clusters = [...new Set(getClusterValues().map(value => String(value)))].sort((a, b) => Number(a) - Number(b));
        return {
          rows: [
            { label: 'Aantal percelen', value: String(features.length) },
            { label: 'Totale oppervlakte', value: `${formatNumber(selectedArea())} m²` },
            { label: 'Clusters', value: clusters.join(', ') || 'Geen' },
            { label: 'Uitvoer', value: 'GeoJSON voor offerte' }
          ],
          notes: ['Controleer of ieder perceel aan het juiste clusternummer is gekoppeld voordat u downloadt.']
        };
      },
      run: function () {
        downloadCurrentGeojson();
      },
      getProgress: function () {
        const count = getOfferteFeatures().length;
        return [
          !!addressInputEl.value.trim() || count > 0,
          count > 0,
          clustersComplete()
        ];
      }
    };

    RAUX.initTool({
      toolKey: 'offerte',
      toolName: 'Offerte',
      steps: ['Locatie zoeken', 'Percelen selecteren', 'Clusters invullen', 'Controleren', 'Exporteren'],
      adapter,
      runButtonSelector: '#runBtn',
      runButtonLabel: 'Controleer & exporteer',
      reviewTitle: 'Controleer de offertegegevens',
      confirmLabel: 'Bevestigen en downloaden',
      successMessage: 'Het offertebestand is gemaakt en wordt gedownload.'
    });
  }

  function serializeLatLng(value) {
    if (!value) return null;
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function overlayCorners(entry) {
    if (!entry || !entry.layer) return [];
    let corners = [];
    try {
      if (typeof entry.layer.getCorners === 'function') corners = entry.layer.getCorners();
      else if (Array.isArray(entry.layer._corners)) corners = entry.layer._corners;
    } catch (err) {}
    return (Array.isArray(corners) ? corners : []).map(serializeLatLng).filter(Boolean);
  }

  function overlayImageUrl(entry) {
    if (!entry || !entry.layer) return null;
    try {
      if (entry.layer._url) return entry.layer._url;
      if (entry.layer._image && entry.layer._image.src) return entry.layer._image.src;
      if (typeof entry.layer.getElement === 'function' && entry.layer.getElement()) return entry.layer.getElement().src;
    } catch (err) {}
    return null;
  }

  function serializeOverlays(includeImageData) {
    return overlayImages.map(entry => ({
      id: entry.id,
      name: entry.name || 'Afbeelding',
      opacity: Number(entry.opacity || 0.35),
      visible: entry.visible !== false,
      corners: overlayCorners(entry),
      imageUrl: includeImageData ? (overlayImageUrl(entry) || uploadedImageUrl || null) : undefined
    }));
  }

  function serializeDrawings() {
    try { return drawnItems.toGeoJSON(); } catch (err) { return { type: 'FeatureCollection', features: [] }; }
  }

  function georefState(includeImageData) {
    return {
      searchText: addressInputEl.value || '',
      mapView: getMapViewState(),
      currentImage: {
        url: includeImageData ? uploadedImageUrl : undefined,
        name: uploadedImageName || '',
        width: uploadedImageWidth || 0,
        height: uploadedImageHeight || 0,
        imagePoints: imagePoints.map(point => ({ x: Number(point.x), y: Number(point.y) })),
        mapPoints: mapPoints.map(point => ({ lat: Number(point.lat), lng: Number(point.lng) })),
        imageView: {
          scale: Number(imageView.scale || 1),
          x: Number(imageView.x || 0),
          y: Number(imageView.y || 0)
        }
      },
      overlays: serializeOverlays(includeImageData),
      drawings: serializeDrawings(),
      options: {
        legendName: legendNameInputEl.value || '',
        bufferLegendName: bufferLegendNameInputEl.value || '',
        backgroundType: backgroundTypeSelectEl.value || 'Luchtfoto',
        bufferEnabled: !!bufferEnabledEl.checked,
        lineBuffer: lineBufferInputEl.value || '1',
        overlayOpacity: overlayOpacityEl.value || '0.35'
      }
    };
  }

  async function restoreGeorefState(state) {
    resetAll();
    if (!state) return;

    addressInputEl.value = state.searchText || '';
    const options = state.options || {};
    legendNameInputEl.value = options.legendName || '';
    bufferLegendNameInputEl.value = options.bufferLegendName || '';
    backgroundTypeSelectEl.value = options.backgroundType || 'Luchtfoto';
    bufferEnabledEl.checked = !!options.bufferEnabled;
    lineBufferInputEl.value = options.lineBuffer || '1';
    overlayOpacityEl.value = options.overlayOpacity || '0.35';

    const current = state.currentImage || {};
    if (current.url) {
      await setImageFromDataUrl(current.url, current.name || 'georefereren');
      imagePoints = Array.isArray(current.imagePoints) ? current.imagePoints.map(point => ({ x: Number(point.x), y: Number(point.y) })) : [];
      mapPoints = Array.isArray(current.mapPoints) ? current.mapPoints.map(point => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [];
      if (current.imageView) {
        imageView.scale = Number(current.imageView.scale || imageView.scale);
        imageView.x = Number(current.imageView.x || 0);
        imageView.y = Number(current.imageView.y || 0);
      }
      applyImageTransform();
      renderMapMarkers();
      updateStatus();
    }

    clearAllOverlays();
    (state.overlays || []).forEach((saved, index) => {
      if (!saved.imageUrl || !Array.isArray(saved.corners) || saved.corners.length !== 4) return;
      const corners = saved.corners.map(point => L.latLng(point.lat, point.lng));
      const layer = new L.DistortableImageOverlay(saved.imageUrl, {
        corners,
        editable: false,
        selected: false,
        suppressToolbar: true,
        opacity: saved.visible === false ? 0 : Number(saved.opacity || 0.35)
      }).addTo(map);
      overlayImages.push({
        id: saved.id || `overlay-${overlayIdCounter++}`,
        name: saved.name || `Afbeelding ${index + 1}`,
        layer,
        opacity: Number(saved.opacity || 0.35),
        visible: saved.visible !== false
      });
    });
    if (overlayImages.length) {
      selectedOverlayId = overlayImages[overlayImages.length - 1].id;
      currentGeoreferencedOverlayId = selectedOverlayId;
      overlayIdCounter = overlayImages.length + 1;
    }
    renderOverlayList();

    clearDrawings();
    if (state.drawings && Array.isArray(state.drawings.features) && state.drawings.features.length) {
      const imported = L.geoJSON(state.drawings, {
        style: function (feature) {
          return feature && feature.geometry && /LineString/.test(feature.geometry.type)
            ? { color: '#0F2B1B', weight: 4 }
            : { color: '#0F2B1B', weight: 3, fillColor: '#CCFF31', fillOpacity: 0.2 };
        }
      });
      imported.eachLayer(layer => drawnItems.addLayer(layer));
    }

    updateLineBuffers();
    updateConditionalFields();
    updateAreaVisibility();
    updateAreaStats();
    updateStatus();
    restoreMapView(state.mapView);
  }

  function initGeorefereren() {
    const adapter = {
      getState: function () {
        return georefState(true);
      },
      getStateHash: function () {
        return georefState(false);
      },
      restoreState: restoreGeorefState,
      getProjectTitle: function () {
        const searched = (addressInputEl.value || '').trim();
        if (searched) return searched;
        const uploaded = (uploadedImageName || '').trim();
        if (uploaded && uploaded !== 'georefereren') return uploaded.replace(/\.[^.]+$/, '');
        return 'Georefereren';
      },
      getProjectItemCount: function () {
        return serializeDrawings().features.length + overlayImages.length;
      },
      hasProjectContent: function () {
        return !!uploadedImageUrl || overlayImages.length > 0 || serializeDrawings().features.length > 0;
      },
      validate: function () {
        const fc = getDrawnFeatureCollectionForExport();
        const errors = [];
        if (!fc.features.length) {
          errors.push({ message: 'Teken eerst minimaal één lijn of polygoon op de kaart.', selector: '#map' });
        }
        if (bufferEnabledEl.checked) {
          const width = Number(lineBufferInputEl.value);
          if (!Number.isFinite(width) || width <= 0) {
            errors.push({ message: 'Vul een geldige bufferbreedte groter dan 0 meter in.', selector: '#lineBufferInput' });
          }
        }
        return errors;
      },
      getSummary: function () {
        const drawings = serializeDrawings();
        const lines = drawings.features.filter(feature => feature.geometry && /LineString/.test(feature.geometry.type)).length;
        const polygons = drawings.features.filter(feature => feature.geometry && /Polygon/.test(feature.geometry.type)).length;
        return {
          rows: [
            { label: 'Geplaatste afbeeldingen', value: String(overlayImages.length) },
            { label: 'Getekende objecten', value: `${lines} lijn(en), ${polygons} vlak(ken)` },
            { label: 'Kaarttype', value: backgroundTypeSelectEl.value || 'Luchtfoto' },
            { label: 'Uitvoer', value: 'GeoJSON met getekende geometrie' }
          ],
          notes: [bufferEnabledEl.checked
            ? `De lijnbuffer wordt meegenomen met een totale breedte van ${lineBufferInputEl.value || '0'} meter.`
            : 'Er wordt geen lijnbuffer toegevoegd.']
        };
      },
      run: function () {
        runExport();
      },
      getProgress: function () {
        const fc = serializeDrawings();
        return [
          !!uploadedImageUrl,
          imagePoints.length === 4 && mapPoints.length === 4,
          overlayImages.length > 0,
          fc.features.length > 0
        ];
      }
    };

    RAUX.initTool({
      toolKey: 'georefereren',
      toolName: 'Georefereren',
      steps: ['Bestand uploaden', 'Referentiepunten', 'Georefereren', 'Tekenen & opties', 'Controleren / exporteren'],
      adapter,
      runButtonSelector: '#runBtn',
      runButtonLabel: 'Controleer & exporteer',
      reviewTitle: 'Controleer de georeferentie-export',
      confirmLabel: 'Bevestigen en downloaden',
      successMessage: 'De getekende geometrie is geëxporteerd.',
      pollInterval: 1200
    });
  }

  function start() {
    if (!window.RAUX) return;
    const tool = document.body.dataset.raTool;
    if (tool === 'landing') RAUX.initLanding();
    else if (tool === 'situatietekening') initSituatietekening();
    else if (tool === 'offerte') initOfferte();
    else if (tool === 'georefereren') initGeorefereren();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
