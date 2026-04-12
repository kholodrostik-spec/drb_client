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

interface ReviewCheck {
  hasReview: boolean;
  locationId: number | null;
  locationName: string | null;
  existingRating: number | null;
  existingComment: string | null;
}

// Review form state
type ReviewStep = 'actions' | 'review-form' | 'review-confirm-replace';

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
  selectedCarProfile = '';

  // Bottom sheet state
  isBottomSheetOpen = false;
  isLoadingRoute = false;
  isLoadingNearby = false;
  isLoadingReviewCheck = false;

  // Review state
  reviewStep: ReviewStep = 'actions';
  reviewRating = 0;
  reviewComment = '';
  reviewPhoto: File | null = null;
  reviewPhotoPreview: string | null = null;
  reviewLocationId: number | null = null;
  reviewLocationName: string | null = null;
  existingReviewRating: number | null = null;
  existingReviewComment: string | null = null;
  isSubmittingReview = false;

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

  private readonly irelandBounds = L.latLngBounds([51.2, -10.8], [55.5, -5.3]);

  private get customIcon(): L.Icon {
    return L.icon({
      iconUrl: 'map_marker_icon.svg',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });
  }

  private get userId(): string {
    return localStorage.getItem('userId') ?? '0';
  }

  // Convenience getters for template
  get isReviewMode(): boolean { return this.reviewStep !== 'actions'; }
  get isConfirmReplace(): boolean { return this.reviewStep === 'review-confirm-replace'; }
  get isReviewForm(): boolean { return this.reviewStep === 'review-form'; }

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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { noWrap: true }).addTo(this.map);
    this.map.fitBounds(this.irelandBounds, { padding: [20, 20] });

    setTimeout(() => {
      this.map?.invalidateSize();
      this.map?.fitBounds(this.irelandBounds, { padding: [20, 20] });
    }, 100);

    this.map.on('click', (event: L.LeafletMouseEvent) => this.onMapClick(event.latlng));
  }

  // ─── Map click handler ────────────────────────────────────────────────────────

  private onMapClick(latlng: L.LatLng): void {
    if (!this.map) return;

    const hasExistingRoute = !!this.routePolyline || !!this.snapStartPolyline || !!this.snapEndPolyline;

    if (hasExistingRoute) {
      const popup = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, className: 'confirm-popup' })
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
        document.getElementById('confirm-no')?.addEventListener('click', () => this.map?.closePopup());
      }, 0);
      return;
    }

    if (this.waitingForSecondPoint && this.selectedTransport) {
      this.clearSelectedMarker();
      this.selectedPoint = latlng;
      this.selectedMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon }).addTo(this.map);
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

    // First click
    this.clearSelectedMarker();
    this.selectedPoint = latlng;
    this.selectedMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon }).addTo(this.map);

    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
    this.nearbyLocations = [];
    this.isBottomSheetOpen = true;

    this.loadNearbyLocations(latlng);
  }

  private removeRouteMarkers(): void {
    this.startMarker?.remove(); this.startMarker = undefined;
    this.endMarker?.remove(); this.endMarker = undefined;
    this.selectedMarker?.remove(); this.selectedMarker = undefined;
  }

  // ─── Load nearby locations ────────────────────────────────────────────────────

  private loadNearbyLocations(latlng: L.LatLng): void {
    this.isLoadingNearby = true;
    this.http.get<NearbyLocation[]>(
      `${this.SPRING_BASE}/api/map/nearest?lat=${latlng.lat}&lon=${latlng.lng}&limit=3`
    ).subscribe({
      next: (locations) => { this.nearbyLocations = locations; this.isLoadingNearby = false; },
      error: () => { this.isLoadingNearby = false; this.nearbyLocations = []; }
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

  /** Leave review — calls /api/locations/review-check first */
  onLeaveReview(): void {
    if (!this.selectedPoint) return;

    this.showNearbyLocations = false;
    this.isLoadingReviewCheck = true;

    this.http.get<ReviewCheck>(
      `${this.SPRING_BASE}/api/locations/review-check` +
      `?lat=${this.selectedPoint.lat}&lon=${this.selectedPoint.lng}&userId=${this.userId}`
    ).subscribe({
      next: (check) => {
        this.isLoadingReviewCheck = false;
        this.reviewLocationId = check.locationId;
        this.reviewLocationName = check.locationName;

        if (check.hasReview) {
          // User already reviewed this location — show confirmation
          this.existingReviewRating = check.existingRating;
          this.existingReviewComment = check.existingComment;
          this.reviewStep = 'review-confirm-replace';
        } else {
          // No existing review — go straight to form
          this.resetReviewForm();
          this.reviewStep = 'review-form';
        }
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

  /** User confirmed they want to replace existing review */
  confirmReplaceReview(): void {
    this.resetReviewForm();
    this.reviewRating = this.existingReviewRating ?? 0;
    this.reviewComment = this.existingReviewComment ?? '';
    this.reviewStep = 'review-form';
  }

  /** User cancelled replacing review */
  cancelReplaceReview(): void {
    this.reviewStep = 'actions';
    this.showNearbyLocations = true;
  }

  /** Back from review form to actions */
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

    // Generate preview
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
      error: () => { this.isLoadingRoute = false; }
    });
  }

  private buildCarRoute(from: L.LatLng, to: L.LatLng): void {
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
        if (!selected?.routeGeoJson) { this.routeErrorMessage = 'No car route found.'; return; }

        this.selectedCarProfile = response.selectedProfile;

        let routeGeoJson: any;
        try { routeGeoJson = JSON.parse(selected.routeGeoJson); }
        catch { this.routeErrorMessage = 'Invalid route data.'; return; }

        const allCoords: [number, number][] = [];
        if (routeGeoJson.type === 'LineString') {
          for (const p of routeGeoJson.coordinates) { if (p?.length >= 2) allCoords.push([p[1], p[0]]); }
        } else if (routeGeoJson.type === 'MultiLineString') {
          for (const seg of routeGeoJson.coordinates ?? [])
            for (const p of seg ?? []) { if (p?.length >= 2) allCoords.push([p[1], p[0]]); }
        }

        if (allCoords.length === 0) { this.routeErrorMessage = 'Route has no coordinates.'; return; }

        if (selected.snapStartGeoJson) {
          try {
            const snap = JSON.parse(selected.snapStartGeoJson);
            const coords = snap.coordinates?.filter((p: any) => Array.isArray(p) && p.length >= 2)
              .map((p: number[]) => [p[1], p[0]] as [number, number]);
            if (coords?.length > 0)
              this.snapStartPolyline = L.polyline(coords, { color: '#ff6b00', weight: 3, dashArray: '6 6' }).addTo(this.map!);
          } catch { /* ignore */ }
        }

        if (selected.snapEndGeoJson) {
          try {
            const snap = JSON.parse(selected.snapEndGeoJson);
            const coords = snap.coordinates?.filter((p: any) => Array.isArray(p) && p.length >= 2)
              .map((p: number[]) => [p[1], p[0]] as [number, number]);
            if (coords?.length > 0)
              this.snapEndPolyline = L.polyline(coords, { color: '#ff6b00', weight: 3, dashArray: '6 6' }).addTo(this.map!);
          } catch { /* ignore */ }
        }

        this.routePolyline = L.polyline(allCoords, { color: '#ff6b00', weight: 5, lineJoin: 'round', lineCap: 'round' }).addTo(this.map!);
        const layers: L.Layer[] = [this.routePolyline];
        if (this.snapStartPolyline) layers.push(this.snapStartPolyline);
        if (this.snapEndPolyline) layers.push(this.snapEndPolyline);
        this.map?.fitBounds(L.featureGroup(layers).getBounds(), { padding: [40, 40] });
        this.routeErrorMessage = '';
        this.resetRouteSelection();
      },
      error: () => { this.isLoadingRoute = false; this.routeErrorMessage = 'Car route request failed.'; }
    });
  }

  private drawRouteFromSpring(response: any): boolean {
    if (!this.map || !response?.routeGeoJson) return false;
    this.clearRouteLines();

    if (response.snapStartGeoJson) {
      try {
        const snap = JSON.parse(response.snapStartGeoJson);
        const coords = snap.coordinates?.filter((p: any) => Array.isArray(p) && p.length >= 2)
          .map((p: number[]) => [p[1], p[0]] as [number, number]);
        if (coords?.length > 0)
          this.snapStartPolyline = L.polyline(coords, { color: '#ff4444', weight: 3, dashArray: '6 6' }).addTo(this.map);
      } catch { /* ignore */ }
    }

    if (response.snapEndGeoJson) {
      try {
        const snap = JSON.parse(response.snapEndGeoJson);
        const coords = snap.coordinates?.filter((p: any) => Array.isArray(p) && p.length >= 2)
          .map((p: number[]) => [p[1], p[0]] as [number, number]);
        if (coords?.length > 0)
          this.snapEndPolyline = L.polyline(coords, { color: '#44ff44', weight: 3, dashArray: '6 6' }).addTo(this.map);
      } catch { /* ignore */ }
    }

    let routeGeoJson: any;
    try { routeGeoJson = JSON.parse(response.routeGeoJson); } catch { return false; }

    const allCoords: [number, number][] = [];
    if (routeGeoJson.type === 'LineString') {
      for (const p of routeGeoJson.coordinates) { if (p?.length >= 2) allCoords.push([p[1], p[0]]); }
    } else if (routeGeoJson.type === 'MultiLineString') {
      for (const seg of routeGeoJson.coordinates ?? [])
        for (const p of seg ?? []) { if (p?.length >= 2) allCoords.push([p[1], p[0]]); }
    }

    if (allCoords.length === 0) return false;

    this.routePolyline = L.polyline(allCoords, { color: '#2f80ff', weight: 5, lineJoin: 'round', lineCap: 'round' }).addTo(this.map);
    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [40, 40] });
    return true;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  private clearSelectedMarker(): void {
    if (this.selectedMarker && this.map) { this.map.removeLayer(this.selectedMarker); this.selectedMarker = undefined; }
    this.selectedPoint = undefined;
  }

  private clearRouteLines(): void {
    this.routePolyline?.remove(); this.routePolyline = undefined;
    this.snapStartPolyline?.remove(); this.snapStartPolyline = undefined;
    this.snapEndPolyline?.remove(); this.snapEndPolyline = undefined;
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
    this.nearestLine?.remove(); this.nearestLine = undefined;
    this.closeBottomSheet();
    this.routeErrorMessage = '';
    this.selectedCarProfile = '';
  }

  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;
    setTimeout(() => this.map?.invalidateSize(), 310);
  }

  searchResults: Array<{id: number, name: string, latitude: number, longitude: number, category?: string}> = [];
  showSearchResults = false;

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
      error: () => { this.searchResults = []; this.showSearchResults = false; }
    });
  }

  onSearch(): void {
    const q = this.searchText.trim();
    if (q.length < 1) return;

    // Спочатку шукаємо в своїй БД
    this.http.get<any[]>(
      `${this.SPRING_BASE}/api/locations/search?q=${encodeURIComponent(q)}&limit=1`
    ).subscribe({
      next: (results) => {
        if (results.length > 0) {
          this.selectSearchResult(results[0]);
        } else {
          // Fallback — шукаємо через Nominatim
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

  selectSearchResult(result: {id: number, name: string, latitude: number, longitude: number, category?: string}): void {
  this.searchText = result.name;
  this.showSearchResults = false;
  this.searchResults = [];

  if (!this.map) return;

  const latlng = L.latLng(result.latitude, result.longitude);
  this.map.setView([result.latitude, result.longitude], 16);

  this.clearSelectedMarker();

  this.selectedPoint = latlng;
  this.selectedMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon }).addTo(this.map);

  this.reviewStep = 'actions';
  this.showNearbyLocations = true;
  this.nearbyLocations = [];
  this.isBottomSheetOpen = true;

  this.loadNearbyLocations(latlng);
}

  @HostListener('window:resize')
  onResize(): void { this.map?.invalidateSize(); }

  ngOnDestroy(): void { this.map?.remove(); this.map = undefined; }

  get stars(): number[] { return [1, 2, 3, 4, 5]; }
}