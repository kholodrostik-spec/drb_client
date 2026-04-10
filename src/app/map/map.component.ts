import { AfterViewInit, Component, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import * as L from 'leaflet';

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

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private map?: L.Map;

  searchText = '';
  isSidebarOpen = false;
  showSearchHistory = false;
  routeErrorMessage = '';

  // Car route profile label shown after route is built
  selectedCarProfile = '';

  // Bottom sheet state
  isBottomSheetOpen = false;
  reviewRating = 0;
  reviewComment = '';
  isReviewMode = false;
  isLoadingRoute = false;
  isLoadingNearby = false;

  nearbyLocations: NearbyLocation[] = [];
  showNearbyLocations = true;

  selectedTransport: 'walk' | 'car' | null = null;

  selectedPoint?: L.LatLng;
  private selectedMarker?: L.Marker;

  startPoint?: L.LatLng;
  waitingForSecondPoint = false;

  private startMarker?: L.Marker;
  private endMarker?: L.Marker;
  private nearestLine?: L.Polyline;
  private routePolyline?: L.Polyline;
  private snapStartPolyline?: L.Polyline;
  private snapEndPolyline?: L.Polyline;

  private readonly SPRING_BASE = 'http://localhost:8080';

  constructor(private http: HttpClient, private router: Router) {}

  private readonly irelandBounds = L.latLngBounds(
    [51.2, -10.8],
    [55.5, -5.3]
  );

  private get customIcon(): L.Icon {
    return L.icon({
      iconUrl: 'marker-icon.png',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
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

    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 7.5,
      maxZoom: 18,
      maxBounds: this.irelandBounds,
      maxBoundsViscosity: 1.0,
      worldCopyJump: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      noWrap: true
    }).addTo(this.map);

    this.map.fitBounds(this.irelandBounds, { padding: [20, 20] });

    setTimeout(() => {
      this.map?.invalidateSize();
      this.map?.fitBounds(this.irelandBounds, { padding: [20, 20] });
    }, 100);

    this.map.on('click', (event: L.LeafletMouseEvent) => {
      this.onMapClick(event.latlng);
    });
  }

  // ─── Map click handler ────────────────────────────────────────────────────────

  private onMapClick(latlng: L.LatLng): void {
    if (!this.map) return;

    const hasExistingRoute = !!this.routePolyline || !!this.snapStartPolyline || !!this.snapEndPolyline;

    if (hasExistingRoute) {
      const popup = L.popup({
        closeButton: false,
        autoClose: false,
        closeOnClick: false,
        className: 'confirm-popup'
      })
        .setLatLng(latlng)
        .setContent(`
          <div class="popup-confirm">
            <div>Erase current route?</div>
            <div class="popup-actions">
              <button id="confirm-yes" class="popup-btn popup-btn-ok">OK</button>
              <button id="confirm-no" class="popup-btn popup-btn-cancel">Cancel</button>
            </div>
          </div>
        `)
        .openOn(this.map);

      setTimeout(() => {
        document.getElementById('confirm-yes')?.addEventListener('click', () => {
          this.map?.closePopup();
          this.clearRouteLines();
          this.removeRouteMarkers();
          this.resetRouteSelection();
          this.routeErrorMessage = '';
          this.selectedCarProfile = '';
          this.onMapClick(latlng);
        });
        document.getElementById('confirm-no')?.addEventListener('click', () => {
          this.map?.closePopup();
        });
      }, 0);

      return;
    }

    // Second click when transport already chosen — build route immediately
    if (this.waitingForSecondPoint && this.selectedTransport) {
      this.clearSelectedMarker();
      this.selectedPoint = latlng;
      this.selectedMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon })
        .addTo(this.map);

      this.endMarker?.remove();
      this.endMarker = this.selectedMarker;
      this.selectedMarker = undefined;

      if (this.selectedTransport === 'walk') {
        this.buildWalkRoute(this.startPoint!, latlng);
      } else {
        this.buildCarRoute(this.startPoint!, latlng);
      }
      return;
    }

    // First click — show bottom sheet
    this.clearSelectedMarker();
    this.selectedPoint = latlng;
    this.selectedMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon })
      .addTo(this.map);

    this.isReviewMode = false;
    this.reviewRating = 0;
    this.reviewComment = '';
    this.showNearbyLocations = true;
    this.nearbyLocations = [];
    this.isBottomSheetOpen = true;

    this.loadNearbyLocations(latlng);
  }

  private removeRouteMarkers(): void {
    this.startMarker?.remove();
    this.startMarker = undefined;
    this.endMarker?.remove();
    this.endMarker = undefined;
    this.selectedMarker?.remove();
    this.selectedMarker = undefined;
  }

  private isDirectFallback(coords: [number, number][]): boolean {
    return coords.length <= 2;
  }

  // ─── Load nearby locations ────────────────────────────────────────────────────

  private loadNearbyLocations(latlng: L.LatLng): void {
    this.isLoadingNearby = true;

    this.http.get<NearbyLocation[]>(
      `${this.SPRING_BASE}/api/map/nearest?lat=${latlng.lat}&lon=${latlng.lng}&limit=3`
    ).subscribe({
      next: (locations) => {
        this.nearbyLocations = locations;
        this.isLoadingNearby = false;
      },
      error: (err) => {
        console.error('Failed to load nearby locations', err);
        this.isLoadingNearby = false;
        this.nearbyLocations = [];
      }
    });
  }

  // ─── Bottom sheet actions ─────────────────────────────────────────────────────

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
    this.showNearbyLocations = false;
    this.isReviewMode = true;
  }

  // Navigate to AI route preferences page
  openRouteSettings(): void {
    this.isSidebarOpen = false;
    this.router.navigate(['/route']);
  }

  submitReview(): void {
    if (!this.selectedPoint || this.reviewRating === 0) return;

    const body = {
      latitude: this.selectedPoint.lat,
      longitude: this.selectedPoint.lng,
      rating: this.reviewRating,
      comment: this.reviewComment || null
    };

    this.http.post(`${this.SPRING_BASE}/api/locations/reviews`, body).subscribe({
      next: () => {
        console.log('Review submitted successfully');
        this.closeBottomSheet();
      },
      error: (err) => console.error('Review submission failed', err)
    });
  }

  setRating(star: number): void {
    this.reviewRating = star;
  }

  closeBottomSheet(): void {
    this.isBottomSheetOpen = false;
    this.isReviewMode = false;
    this.showNearbyLocations = true;

    if (!this.waitingForSecondPoint) {
      this.clearSelectedMarker();
    }
  }

  // ─── Route building ───────────────────────────────────────────────────────────

  private buildWalkRoute(from: L.LatLng, to: L.LatLng): void {
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
      error: (err) => {
        this.isLoadingRoute = false;
        console.error('Walk route request failed', err);
      }
    });
  }

  /** Car route — calls Spring Boot /api/map/ai-route with user preferences */
  private buildCarRoute(from: L.LatLng, to: L.LatLng): void {
    if (!this.map) return;

    this.clearRouteLines();
    this.isLoadingRoute = true;
    this.selectedCarProfile = '';

    this.http.get<AiRouteResponse>(
      `${this.SPRING_BASE}/api/map/ai-route` +
      `?userId=${this.userId}` +
      `&latFrom=${from.lat}&lonFrom=${from.lng}` +
      `&latTo=${to.lat}&lonTo=${to.lng}`
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
          this.routeErrorMessage = 'Invalid route data from server.';
          return;
        }

        const allCoords: [number, number][] = [];

        if (routeGeoJson.type === 'LineString') {
          for (const p of routeGeoJson.coordinates) {
            if (p?.length >= 2) allCoords.push([p[1], p[0]]);
          }
        } else if (routeGeoJson.type === 'MultiLineString') {
          for (const seg of routeGeoJson.coordinates ?? []) {
            for (const p of seg ?? []) {
              if (p?.length >= 2) allCoords.push([p[1], p[0]]);
            }
          }
        }

        if (allCoords.length === 0) {
          this.routeErrorMessage = 'Route has no coordinates.';
          return;
        }

        // Draw snap lines
        if (selected.snapStartGeoJson) {
          try {
            const snap = JSON.parse(selected.snapStartGeoJson);
            const coords = snap.coordinates
              ?.filter((p: any) => Array.isArray(p) && p.length >= 2)
              .map((p: number[]) => [p[1], p[0]] as [number, number]);
            if (coords?.length > 0) {
              this.snapStartPolyline = L.polyline(coords, {
                color: '#ff6b00', weight: 3, dashArray: '6 6'
              }).addTo(this.map!);
            }
          } catch { /* ignore */ }
        }

        if (selected.snapEndGeoJson) {
          try {
            const snap = JSON.parse(selected.snapEndGeoJson);
            const coords = snap.coordinates
              ?.filter((p: any) => Array.isArray(p) && p.length >= 2)
              .map((p: number[]) => [p[1], p[0]] as [number, number]);
            if (coords?.length > 0) {
              this.snapEndPolyline = L.polyline(coords, {
                color: '#ff6b00', weight: 3, dashArray: '6 6'
              }).addTo(this.map!);
            }
          } catch { /* ignore */ }
        }

        this.routePolyline = L.polyline(allCoords, {
          color: '#ff6b00',
          weight: 5,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(this.map!);

        const layers: L.Layer[] = [this.routePolyline];
        if (this.snapStartPolyline) layers.push(this.snapStartPolyline);
        if (this.snapEndPolyline) layers.push(this.snapEndPolyline);

        this.map?.fitBounds(L.featureGroup(layers).getBounds(), { padding: [40, 40] });
        this.routeErrorMessage = '';
        this.resetRouteSelection();
      },
      error: (err) => {
        this.isLoadingRoute = false;
        this.routeErrorMessage = 'Car route request failed.';
        console.error('Car route request failed', err);
      }
    });
  }

  private drawRouteFromSpring(response: any): boolean {
    if (!this.map || !response?.routeGeoJson) return false;

    this.clearRouteLines();

    if (response.snapStartGeoJson) {
      try {
        const snap = JSON.parse(response.snapStartGeoJson);
        const coords = snap.coordinates
          ?.filter((p: any) => Array.isArray(p) && p.length >= 2)
          .map((p: number[]) => [p[1], p[0]] as [number, number]);
        if (coords?.length > 0) {
          this.snapStartPolyline = L.polyline(coords, {
            color: '#ff4444', weight: 3, dashArray: '6 6'
          }).addTo(this.map);
        }
      } catch { /* ignore */ }
    }

    if (response.snapEndGeoJson) {
      try {
        const snap = JSON.parse(response.snapEndGeoJson);
        const coords = snap.coordinates
          ?.filter((p: any) => Array.isArray(p) && p.length >= 2)
          .map((p: number[]) => [p[1], p[0]] as [number, number]);
        if (coords?.length > 0) {
          this.snapEndPolyline = L.polyline(coords, {
            color: '#44ff44', weight: 3, dashArray: '6 6'
          }).addTo(this.map);
        }
      } catch { /* ignore */ }
    }

    let routeGeoJson: any;
    try {
      routeGeoJson = JSON.parse(response.routeGeoJson);
    } catch { return false; }

    const allCoords: [number, number][] = [];

    if (routeGeoJson.type === 'LineString') {
      for (const p of routeGeoJson.coordinates) {
        if (p?.length >= 2) allCoords.push([p[1], p[0]]);
      }
    } else if (routeGeoJson.type === 'MultiLineString') {
      for (const seg of routeGeoJson.coordinates ?? []) {
        for (const p of seg ?? []) {
          if (p?.length >= 2) allCoords.push([p[1], p[0]]);
        }
      }
    }

    if (allCoords.length === 0) return false;

    this.routePolyline = L.polyline(allCoords, {
      color: '#2f80ff',
      weight: 5,
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(this.map);

    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [40, 40] });
    return true;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  private clearSelectedMarker(): void {
    if (this.selectedMarker && this.map) {
      this.map.removeLayer(this.selectedMarker);
      this.selectedMarker = undefined;
    }
    this.selectedPoint = undefined;
  }

  private clearRouteLines(): void {
    this.routePolyline?.remove();
    this.routePolyline = undefined;
    this.snapStartPolyline?.remove();
    this.snapStartPolyline = undefined;
    this.snapEndPolyline?.remove();
    this.snapEndPolyline = undefined;
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
    this.nearestLine?.remove();
    this.nearestLine = undefined;
    this.closeBottomSheet();
    this.routeErrorMessage = '';
    this.selectedCarProfile = '';
  }

  // ─── UI helpers ───────────────────────────────────────────────────────────────

  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
    setTimeout(() => this.map?.invalidateSize(), 310);
  }

  onSearchInput(): void {
    this.showSearchHistory = this.searchText.trim().length > 0;
  }

  onSearch(): void {
    console.log('Search:', this.searchText);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.map?.invalidateSize();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  get stars(): number[] {
    return [1, 2, 3, 4, 5];
  }
}