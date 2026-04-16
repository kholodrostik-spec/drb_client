import { AfterViewInit, Component, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LOCAL_CONFIG } from '../local-config';
import mapboxgl from 'mapbox-gl';

interface NearbyLocation {
  id: number;
  name: string;
  description?: string;
  category?: string;
  rating?: number;
  latitude: number;
  longitude: number;
}

interface AiRouteResponse {
  selectedProfile: string;
  selected: {
    profile: string;
    totalCostM: number;
    timeMin: number;
    turnCount: number;
    residentialRatio: number;
    minorRatio: number;
    safetyScore: number;
    beautyScore: number;
    simplicityScore: number;
    totalScore: number;
    routeGeoJson: string;
    snapStartGeoJson: string;
    snapEndGeoJson: string;
  };
}

interface ReviewCheck {
  hasReview: boolean;
  locationId: number | null;
  locationName: string | null;
  existingRating: number | null;
  existingComment: string | null;
  existingPhotoUrl: string | null;
}

type ReviewStep = 'actions' | 'review-form' | 'review-confirm-replace';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private map?: mapboxgl.Map;
  private confirmPopup?: mapboxgl.Popup;

  searchText = '';
  isSidebarOpen = false;
  showSearchHistory = false;
  routeErrorMessage = '';
  selectedCarProfile = '';

  private readonly MAPBOX_TOKEN = LOCAL_CONFIG.mapboxToken;
  private readonly MAP_STYLE = LOCAL_CONFIG.mapstyle;

  private readonly SPRING_BASE = 'http://localhost:8080';
  private readonly irelandBounds: mapboxgl.LngLatBoundsLike = [[-10.8, 51.2], [-5.3, 55.5]];

  private readonly ROUTE_SOURCE_ID = 'route-source';
  private readonly ROUTE_LAYER_ID = 'route-layer';
  private readonly SNAP_START_SOURCE_ID = 'snap-start-source';
  private readonly SNAP_START_LAYER_ID = 'snap-start-layer';
  private readonly SNAP_END_SOURCE_ID = 'snap-end-source';
  private readonly SNAP_END_LAYER_ID = 'snap-end-layer';

  isBottomSheetOpen = false;
  isLoadingRoute = false;
  isLoadingNearby = false;
  isLoadingReviewCheck = false;

  reviewStep: ReviewStep = 'actions';
  reviewRating = 0;
  reviewComment = '';
  reviewPhoto: File | null = null;
  reviewPhotoPreview: string | null = null;
  reviewLocationId: number | null = null;
  reviewLocationName: string | null = null;
  existingReviewRating: number | null = null;
  existingReviewComment: string | null = null;
  existingReviewPhotoUrl: string | null = null;
  isSubmittingReview = false;

  nearbyLocations: NearbyLocation[] = [];
  showNearbyLocations = true;

  selectedTransport: 'walk' | 'car' | null = null;
  selectedPoint?: mapboxgl.LngLat;
  private selectedMarker?: mapboxgl.Marker;

  startPoint?: mapboxgl.LngLat;
  waitingForSecondPoint = false;

  private startMarker?: mapboxgl.Marker;
  private endMarker?: mapboxgl.Marker;

  private routePolyline?: true;
  private snapStartPolyline?: true;
  private snapEndPolyline?: true;
  private nearestLine?: true;

  searchResults: Array<{ id: number; name: string; latitude: number; longitude: number; category?: string }> = [];
  showSearchResults = false;

  constructor(private http: HttpClient, private router: Router) {}

  get isReviewMode(): boolean {
    return this.reviewStep !== 'actions';
  }

  get isConfirmReplace(): boolean {
    return this.reviewStep === 'review-confirm-replace';
  }

  get isReviewForm(): boolean {
    return this.reviewStep === 'review-form';
  }

  get stars(): number[] {
    return [1, 2, 3, 4, 5];
  }

  private get userId(): string {
    return localStorage.getItem('userId') ?? '0';
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.createMap());
  }

  private createMap(): void {
    const container = document.getElementById('map');
    if (!container || this.map) return;

    mapboxgl.accessToken = this.MAPBOX_TOKEN;

    this.map = new mapboxgl.Map({
      container: 'map',
      style: this.MAP_STYLE,
      center: [-8.5, 53.4],
      zoom: 6,
      minZoom: 5,
      maxZoom: 18,
      maxBounds: this.irelandBounds
    });

    this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    this.map.on('load', () => {
      this.map?.fitBounds(this.irelandBounds, { padding: 20 });

      const currentZoom = this.map?.getZoom();
      if (currentZoom !== undefined) {
        this.map?.setMinZoom(currentZoom);
      }

      this.map?.resize();
    });

    setTimeout(() => {
      this.map?.resize();
    }, 200);

    this.map.on('click', (event) => this.onMapClick(event.lngLat));
  }

  private onMapClick(latlng: mapboxgl.LngLat): void {
    if (!this.map) return;

    const hasExistingRoute = !!this.routePolyline || !!this.snapStartPolyline || !!this.snapEndPolyline;

    if (hasExistingRoute) {
      this.openConfirmPopup(latlng);
      return;
    }

    if (this.waitingForSecondPoint && this.selectedTransport) {
      this.clearSelectedMarker();
      this.selectedPoint = latlng;
      this.endMarker?.remove();
      this.endMarker = this.createMarker(latlng);
      this.selectedMarker = undefined;

      if (this.selectedTransport === 'walk') {
        this.buildWalkRoute(this.startPoint!, latlng);
      } else {
        this.buildCarRoute(this.startPoint!, latlng);
      }
      return;
    }

    this.clearSelectedMarker();
    this.selectedPoint = latlng;
    this.selectedMarker = this.createMarker(latlng);

    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
    this.nearbyLocations = [];
    this.isBottomSheetOpen = true;

    this.loadNearbyLocations(latlng);
  }

  private openConfirmPopup(latlng: mapboxgl.LngLat): void {
    if (!this.map) return;

    this.confirmPopup?.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'popup-confirm';
    wrapper.innerHTML = `
      <div>Erase current route?</div>
      <div class="popup-actions" style="display:flex;gap:8px;margin-top:8px;">
        <button id="confirm-yes" class="popup-btn popup-btn-ok">OK</button>
        <button id="confirm-no" class="popup-btn popup-btn-cancel">Cancel</button>
      </div>
    `;

    this.confirmPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'confirm-popup'
    })
      .setLngLat(latlng)
      .setDOMContent(wrapper)
      .addTo(this.map);

    setTimeout(() => {
      wrapper.querySelector('#confirm-yes')?.addEventListener('click', () => {
        this.confirmPopup?.remove();
        this.clearRouteLines();
        this.removeRouteMarkers();
        this.resetRouteSelection();
        this.routeErrorMessage = '';
        this.selectedCarProfile = '';
        this.onMapClick(latlng);
      });

      wrapper.querySelector('#confirm-no')?.addEventListener('click', () => {
        this.confirmPopup?.remove();
      });
    }, 0);
  }

  private createMarker(lngLat: mapboxgl.LngLat): mapboxgl.Marker {
    if (!this.map) {
      throw new Error('Map is not initialized');
    }

    const img = document.createElement('img');
    img.src = '/map_marker_icon.svg';
    img.alt = 'Marker';
    img.style.width = '40px';
    img.style.height = '40px';
    img.style.display = 'block';
    img.style.cursor = 'pointer';

    return new mapboxgl.Marker({
      element: img,
      anchor: 'bottom'
    })
      .setLngLat(lngLat)
      .addTo(this.map);
  }

  private removeRouteMarkers(): void {
    this.startMarker?.remove();
    this.startMarker = undefined;

    this.endMarker?.remove();
    this.endMarker = undefined;

    this.selectedMarker?.remove();
    this.selectedMarker = undefined;
  }

  private loadNearbyLocations(latlng: mapboxgl.LngLat): void {
    this.isLoadingNearby = true;
    this.http.get<NearbyLocation[]>(
      `${this.SPRING_BASE}/api/map/nearest?lat=${latlng.lat}&lon=${latlng.lng}&limit=3`
    ).subscribe({
      next: (locations) => {
        this.nearbyLocations = locations;
        this.isLoadingNearby = false;
      },
      error: () => {
        this.isLoadingNearby = false;
        this.nearbyLocations = [];
      }
    });
  }

  onWalkRoute(): void {
    if (!this.selectedPoint) return;

    if (!this.startPoint) {
      this.startPoint = this.selectedPoint;
      this.startMarker = this.selectedMarker;
      this.selectedMarker = undefined;
      this.selectedPoint = undefined;
      this.selectedTransport = 'walk';
      this.waitingForSecondPoint = true;
      this.showNearbyLocations = false;
      this.closeBottomSheet();
      return;
    }

    const from = this.startPoint;
    const to = this.selectedPoint;
    this.closeBottomSheet();
    this.buildWalkRoute(from, to);
  }

  onCarRoute(): void {
    if (!this.selectedPoint) return;

    if (!this.startPoint) {
      this.startPoint = this.selectedPoint;
      this.startMarker = this.selectedMarker;
      this.selectedMarker = undefined;
      this.selectedPoint = undefined;
      this.selectedTransport = 'car';
      this.waitingForSecondPoint = true;
      this.showNearbyLocations = false;
      this.closeBottomSheet();
      return;
    }

    const from = this.startPoint;
    const to = this.selectedPoint;
    this.closeBottomSheet();
    this.buildCarRoute(from, to);
  }

  onLeaveReview(): void {
    console.log('onLeaveReview fired', this.selectedPoint, this.isLoadingReviewCheck);
    if (!this.selectedPoint) return;

    this.showNearbyLocations = false;
    this.isLoadingReviewCheck = true;

    this.http.get<NearbyLocation>(
      `${this.SPRING_BASE}/api/locations/nearest` +
      `?lat=${this.selectedPoint.lat}&lon=${this.selectedPoint.lng}`
    ).subscribe({
      next: (nearest) => {
        this.reviewLocationId = nearest.id;
        this.reviewLocationName = nearest.name;

        this.http.get<ReviewCheck>(
          `${this.SPRING_BASE}/api/locations/review-check` +
          `?lat=${nearest.latitude}&lon=${nearest.longitude}&userId=${this.userId}`
        ).subscribe({
          next: (check) => {
            this.isLoadingReviewCheck = false;

            this.reviewLocationId = check.locationId ?? nearest.id;
            this.reviewLocationName = check.locationName ?? nearest.name;

            if (check.hasReview) {
              this.existingReviewRating = check.existingRating;
              this.existingReviewComment = check.existingComment;
              this.existingReviewPhotoUrl = check.existingPhotoUrl;
              this.reviewStep = 'review-confirm-replace';
            } else {
              this.resetReviewForm();
              this.reviewStep = 'review-form';
            }
          },
          error: () => {
            this.isLoadingReviewCheck = false;
            this.reviewLocationId = nearest.id;
            this.reviewLocationName = nearest.name;
            this.resetReviewForm();
            this.reviewStep = 'review-form';
          }
        });
      },
      error: () => {
        this.isLoadingReviewCheck = false;
        this.reviewLocationId = null;
        this.reviewLocationName = null;
        this.resetReviewForm();
        this.reviewStep = 'review-form';
      }
    });
  }

  confirmReplaceReview(): void {
    this.resetReviewForm();
    this.reviewRating = this.existingReviewRating ?? 0;
    this.reviewComment = this.existingReviewComment ?? '';
    this.reviewStep = 'review-form';
  }

  cancelReplaceReview(): void {
    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
  }

  backFromReviewForm(): void {
    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
    this.resetReviewForm();
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.reviewPhoto = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.reviewPhotoPreview = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  removePhoto(): void {
    this.reviewPhoto = null;
    this.reviewPhotoPreview = null;
  }

  submitReview(): void {
    if (this.reviewRating === 0) return;
    if (!this.reviewLocationId) return;

    this.isSubmittingReview = true;

    const formData = new FormData();
    formData.append('locationId', this.reviewLocationId.toString());
    formData.append('userId', this.userId);
    formData.append('rating', this.reviewRating.toString());
    if (this.reviewComment) formData.append('comment', this.reviewComment);
    if (this.reviewPhoto) formData.append('photo', this.reviewPhoto);

    this.http.post(`${this.SPRING_BASE}/api/locations/reviews`, formData).subscribe({
      next: () => {
        this.isSubmittingReview = false;
        this.closeBottomSheet();
      },
      error: (err) => {
        this.isSubmittingReview = false;
        console.error('Review submission failed', err);
      }
    });
  }

  setRating(star: number): void {
    this.reviewRating = star;
  }

  private resetReviewForm(): void {
    this.reviewRating = 0;
    this.reviewComment = '';
    this.reviewPhoto = null;
    this.reviewPhotoPreview = null;
    this.existingReviewPhotoUrl = null;
  }

  closeBottomSheet(): void {
    this.isBottomSheetOpen = false;
    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
    this.resetReviewForm();

    if (!this.waitingForSecondPoint) {
      this.clearSelectedMarker();
    }
  }

  openRouteSettings(): void {
    this.isSidebarOpen = false;
    this.router.navigate(['/route']);
  }

  private buildWalkRoute(from: mapboxgl.LngLat, to: mapboxgl.LngLat): void {
    if (!this.map) return;

    this.clearRouteLines();
    this.isLoadingRoute = true;

    this.http.get<any>(
      `${this.SPRING_BASE}/api/map/route?latFrom=${from.lat}&lonFrom=${from.lng}&latTo=${to.lat}&lonTo=${to.lng}`
    ).subscribe({
      next: (response) => {
        this.isLoadingRoute = false;
        const drawn = this.drawRouteFromSpring(response);
        this.routeErrorMessage = drawn ? '' : 'No route found between selected points.';
        if (drawn) this.resetRouteSelection();
      },
      error: () => {
        this.isLoadingRoute = false;
      }
    });
  }

  private buildCarRoute(from: mapboxgl.LngLat, to: mapboxgl.LngLat): void {
    if (!this.map) return;

    this.clearRouteLines();
    this.isLoadingRoute = true;
    this.selectedCarProfile = '';

    this.http.get<AiRouteResponse>(
      `${this.SPRING_BASE}/api/map/ai-route?userId=${this.userId}` +
      `&latFrom=${from.lat}&lonFrom=${from.lng}&latTo=${to.lat}&lonTo=${to.lng}`
    ).subscribe({
      next: (response) => {
        this.isLoadingRoute = false;
        const selected = response?.selected;
        if (!selected?.routeGeoJson) {
          this.routeErrorMessage = 'No car route found.';
          return;
        }

        this.selectedCarProfile = response.selectedProfile;

        let routeGeoJson: any;
        try {
          routeGeoJson = JSON.parse(selected.routeGeoJson);
        } catch {
          this.routeErrorMessage = 'Invalid route data.';
          return;
        }

        if (!this.hasCoordinates(routeGeoJson)) {
          this.routeErrorMessage = 'Route has no coordinates.';
          return;
        }

        if (selected.snapStartGeoJson) {
          try {
            const snapStart = JSON.parse(selected.snapStartGeoJson);
            if (this.hasCoordinates(snapStart)) {
              this.addLineLayer(
                this.SNAP_START_SOURCE_ID,
                this.SNAP_START_LAYER_ID,
                snapStart,
                '#ff9f40',
                3,
                [2, 2]
              );
              this.snapStartPolyline = true;
            }
          } catch {}
        }

        if (selected.snapEndGeoJson) {
          try {
            const snapEnd = JSON.parse(selected.snapEndGeoJson);
            if (this.hasCoordinates(snapEnd)) {
              this.addLineLayer(
                this.SNAP_END_SOURCE_ID,
                this.SNAP_END_LAYER_ID,
                snapEnd,
                '#ff9f40',
                3,
                [2, 2]
              );
              this.snapEndPolyline = true;
            }
          } catch {}
        }

        this.addLineLayer(
          this.ROUTE_SOURCE_ID,
          this.ROUTE_LAYER_ID,
          routeGeoJson,
          '#ff9f40',
          5
        );
        this.routePolyline = true;

        this.fitMapToGeoJsons(routeGeoJson, selected.snapStartGeoJson ? JSON.parse(selected.snapStartGeoJson) : null, selected.snapEndGeoJson ? JSON.parse(selected.snapEndGeoJson) : null);
        this.routeErrorMessage = '';
        this.resetRouteSelection();
      },
      error: () => {
        this.isLoadingRoute = false;
        this.routeErrorMessage = 'Car route request failed.';
      }
    });
  }

  private drawRouteFromSpring(response: any): boolean {
    if (!this.map || !response?.routeGeoJson) return false;

    this.clearRouteLines();

    let routeGeoJson: any;
    try {
      routeGeoJson = JSON.parse(response.routeGeoJson);
    } catch {
      return false;
    }

    if (!this.hasCoordinates(routeGeoJson)) return false;

    let snapStartGeoJson: any = null;
    let snapEndGeoJson: any = null;

    if (response.snapStartGeoJson) {
      try {
        snapStartGeoJson = JSON.parse(response.snapStartGeoJson);
        if (this.hasCoordinates(snapStartGeoJson)) {
          this.addLineLayer(
            this.SNAP_START_SOURCE_ID,
            this.SNAP_START_LAYER_ID,
            snapStartGeoJson,
            '#0062ff',
            3,
            [2, 2]
          );
          this.snapStartPolyline = true;
        }
      } catch {}
    }

    if (response.snapEndGeoJson) {
      try {
        snapEndGeoJson = JSON.parse(response.snapEndGeoJson);
        if (this.hasCoordinates(snapEndGeoJson)) {
          this.addLineLayer(
            this.SNAP_END_SOURCE_ID,
            this.SNAP_END_LAYER_ID,
            snapEndGeoJson,
            '#0062ff',
            3,
            [2, 2]
          );
          this.snapEndPolyline = true;
        }
      } catch {}
    }

    this.addLineLayer(
      this.ROUTE_SOURCE_ID,
      this.ROUTE_LAYER_ID,
      routeGeoJson,
      '#0062ff',
      5
    );
    this.routePolyline = true;

    this.fitMapToGeoJsons(routeGeoJson, snapStartGeoJson, snapEndGeoJson);
    return true;
  }

  private addLineLayer(
    sourceId: string,
    layerId: string,
    geometry: any,
    color: string,
    width: number,
    dashArray?: number[]
  ): void {
    if (!this.map) return;

    const feature = this.toFeature(geometry);
    if (!feature) return;

    this.removeLayerIfExists(layerId);
    this.removeSourceIfExists(sourceId);

    this.map.addSource(sourceId, {
      type: 'geojson',
      data: feature
    });

    this.map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': color,
        'line-width': width,
        ...(dashArray ? { 'line-dasharray': dashArray } : {})
      }
    });

    console.log('layer added', layerId, this.map.getLayer(layerId));
  }

  private toFeature(geometry: any): any {
    if (!geometry) return null;
    if (geometry.type === 'Feature') return geometry;

    return {
      type: 'Feature',
      properties: {},
      geometry
    };
  }

  private hasCoordinates(geoJson: any): boolean {
    if (!geoJson) return false;

    const geometry = geoJson.type === 'Feature' ? geoJson.geometry : geoJson;
    if (!geometry) return false;

    if (geometry.type === 'LineString') {
      return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0;
    }

    if (geometry.type === 'MultiLineString') {
      return Array.isArray(geometry.coordinates) &&
        geometry.coordinates.some((segment: any[]) => Array.isArray(segment) && segment.length > 0);
    }

    return false;
  }

  private fitMapToGeoJsons(...geoJsons: any[]): void {
    if (!this.map) return;

    let bounds: mapboxgl.LngLatBounds | null = null;

    const extend = (coord: any) => {
      if (!Array.isArray(coord) || coord.length < 2) return;
      if (!bounds) bounds = new mapboxgl.LngLatBounds(coord as [number, number], coord as [number, number]);
      else bounds.extend(coord as [number, number]);
    };

    const walkGeometry = (geometry: any) => {
      if (!geometry) return;

      if (geometry.type === 'LineString') {
        for (const coord of geometry.coordinates ?? []) extend(coord);
      } else if (geometry.type === 'MultiLineString') {
        for (const segment of geometry.coordinates ?? []) {
          for (const coord of segment ?? []) extend(coord);
        }
      }
    };

    for (const item of geoJsons) {
      if (!item) continue;
      const geometry = item.type === 'Feature' ? item.geometry : item;
      walkGeometry(geometry);
    }

    if (bounds) {
      this.map.fitBounds(bounds, { padding: 40 });
    }
  }

  private removeLayerIfExists(layerId: string): void {
    if (this.map?.getLayer(layerId)) {
      this.map.removeLayer(layerId);
    }
  }

  private removeSourceIfExists(sourceId: string): void {
    if (this.map?.getSource(sourceId)) {
      this.map.removeSource(sourceId);
    }
  }

  private clearSelectedMarker(): void {
    this.selectedMarker?.remove();
    this.selectedMarker = undefined;
    this.selectedPoint = undefined;
  }

  private clearRouteLines(): void {
    this.removeLayerIfExists(this.ROUTE_LAYER_ID);
    this.removeSourceIfExists(this.ROUTE_SOURCE_ID);

    this.removeLayerIfExists(this.SNAP_START_LAYER_ID);
    this.removeSourceIfExists(this.SNAP_START_SOURCE_ID);

    this.removeLayerIfExists(this.SNAP_END_LAYER_ID);
    this.removeSourceIfExists(this.SNAP_END_SOURCE_ID);

    this.routePolyline = undefined;
    this.snapStartPolyline = undefined;
    this.snapEndPolyline = undefined;
    this.nearestLine = undefined;
  }

  private resetRouteSelection(): void {
    this.startPoint = undefined;
    this.waitingForSecondPoint = false;
    this.selectedTransport = null;
    this.selectedPoint = undefined;
    this.selectedMarker = undefined;
  }

  clearMap(): void {
    if (!this.map) return;

    this.clearRouteLines();
    this.removeRouteMarkers();
    this.resetRouteSelection();
    this.nearestLine = undefined;
    this.closeBottomSheet();
    this.routeErrorMessage = '';
    this.selectedCarProfile = '';
    this.confirmPopup?.remove();
  }

  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
    setTimeout(() => this.map?.resize(), 310);
  }

  onSearchInput(): void {
    const q = this.searchText.trim();
    if (q.length < 2) {
      this.searchResults = [];
      this.showSearchResults = false;
      return;
    }

    this.http.get<any[]>(
      `${this.SPRING_BASE}/api/locations/search?q=${encodeURIComponent(q)}&limit=5`
    ).subscribe({
      next: (results) => {
        this.searchResults = results;
        this.showSearchResults = results.length > 0;
      },
      error: () => {
        this.searchResults = [];
        this.showSearchResults = false;
      }
    });
  }

  onSearch(): void {
    const q = this.searchText.trim();
    if (q.length < 1) return;

    this.http.get<any[]>(
      `${this.SPRING_BASE}/api/locations/search?q=${encodeURIComponent(q)}&limit=1`
    ).subscribe({
      next: (results) => {
        if (results.length > 0) {
          this.selectSearchResult(results[0]);
        } else {
          this.searchNominatim(q);
        }
      },
      error: () => this.searchNominatim(q)
    });
  }

  private searchNominatim(q: string): void {
    this.http.get<any[]>(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=ie`
    ).subscribe({
      next: (results) => {
        if (results.length > 0) {
          const r = results[0];
          this.selectSearchResult({
            id: 0,
            name: r.display_name,
            latitude: parseFloat(r.lat),
            longitude: parseFloat(r.lon)
          });
        }
      },
      error: () => {}
    });
  }

  selectSearchResult(result: { id: number; name: string; latitude: number; longitude: number; category?: string }): void {
    this.searchText = result.name;
    this.showSearchResults = false;
    this.searchResults = [];

    if (!this.map) return;

    const lngLat = new mapboxgl.LngLat(result.longitude, result.latitude);

    this.map.easeTo({
      center: [result.longitude, result.latitude],
      zoom: 16
    });

    this.clearSelectedMarker();

    this.selectedPoint = lngLat;
    this.selectedMarker = this.createMarker(lngLat);

    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
    this.nearbyLocations = [];
    this.isBottomSheetOpen = true;

    this.loadNearbyLocations(lngLat);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.map?.resize();
  }

  ngOnDestroy(): void {
    this.confirmPopup?.remove();
    this.map?.remove();
    this.map = undefined;
  }
}