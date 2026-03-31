import { AfterViewInit, Component, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import * as L from 'leaflet';

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

  private startPoint?: L.LatLng;
  private startMarker?: L.Marker;
  private endMarker?: L.Marker;
  private waitingForSecondPoint = false;
  private routeLine?: L.Polyline;
  private nearestLine?: L.Polyline;

  constructor(private http: HttpClient) {}

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

  ngAfterViewInit(): void {
    setTimeout(() => this.createMap());
  }

  private createMap(): void {
    const container = document.getElementById('map');
    if (!container || this.map) {
      return;
    }

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

  private onMapClick(latlng: L.LatLng): void {
    if (!this.map) {
      return;
    }

    if (!this.waitingForSecondPoint) {
      this.resetSelectionOnly();
      this.startPoint = latlng;
      this.startMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon })
      .addTo(this.map);

      this.showFirstPointPopup();
      return;
    } else {
      if (this.endMarker) {
        this.map.removeLayer(this.endMarker);
      }
      this.endMarker = L.marker([latlng.lat, latlng.lng], { icon: this.customIcon })
        .addTo(this.map);
      this.showSecondPointPopup();
    }
  }

  private showFirstPointPopup(): void {
    if (!this.startMarker) return;

    const popup = L.popup({
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
      className: 'custom-route-popup'
    }).setContent(this.buildPopupHtml('Start point selected', 'Confirm start'));

    this.startMarker.bindPopup(popup).openPopup();

    setTimeout(() => {
      document.getElementById('btn-confirm')?.addEventListener('click', () => {
        this.startMarker?.closePopup();
        this.waitingForSecondPoint = true;
      });
      document.getElementById('btn-cancel')?.addEventListener('click', () => {
        this.resetSelectionOnly();
      });
    }, 100);
  }

  private showSecondPointPopup(): void {
    if (!this.endMarker) return;

    const popup = L.popup({
      closeButton: false,
      autoClose: false,
      closeOnClick: false,
      className: 'custom-route-popup'
    }).setContent(this.buildPopupHtml('End point selected', 'Build route'));

    this.endMarker.bindPopup(popup).openPopup();

    setTimeout(() => {
      document.getElementById('btn-confirm')?.addEventListener('click', () => {
        this.endMarker?.closePopup();
        if (this.startPoint && this.endMarker) {
          this.buildRoute(this.startPoint, this.endMarker.getLatLng());
        }
      });
      document.getElementById('btn-cancel')?.addEventListener('click', () => {
        if (this.map && this.endMarker) {
          this.map.removeLayer(this.endMarker);
          this.endMarker = undefined;
        }
        this.waitingForSecondPoint = true;
      });
    }, 100);
  }

  private buildPopupHtml(title: string, confirmText: string): string {
    return `
      <div class="route-popup">
        <div class="route-popup-title">${title}</div>
        <div class="route-popup-actions">
          <button id="btn-confirm" class="popup-btn popup-btn-primary">${confirmText}</button>
          <button id="btn-cancel" class="popup-btn popup-btn-secondary">Cancel</button>
        </div>
      </div>
    `;
  }

  private buildRoute(from: L.LatLng, to: L.LatLng): void {
    if (!this.map) return;

    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = undefined;
    }

    this.http.get<any>(
      `http://localhost:8080/api/map/route?latFrom=${from.lat}&lonFrom=${from.lng}&latTo=${to.lat}&lonTo=${to.lng}`,
    ).subscribe({
      next: (response) => {
        const routeGeoJson = JSON.parse(response.routeGeoJson);
        const routeCoordinates: [number, number][] = [];

        for (const line of routeGeoJson.coordinates) {
          for (const point of line) {
            routeCoordinates.push([point[1], point[0]]);
          }
        }

        this.routeLine = L.polyline(routeCoordinates, {
          color: 'blue',
          weight: 5
        }).addTo(this.map!);

        if (routeCoordinates.length > 0) {
          this.map?.fitBounds(this.routeLine.getBounds(), { padding: [40, 40] });
        }
      },
      error: (error) => {
        console.error('Route request failed', error);
      }
    });
  }

  private cancelSecondPoint(): void {
    if (!this.map) {
      return;
    }

    if (this.endMarker) {
      this.map.removeLayer(this.endMarker);
      this.endMarker = undefined;
    }

    this.waitingForSecondPoint = true;
  }

  private resetSelectionOnly(): void {
    if (!this.map) {
      return;
    }

    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = undefined;
    }

    if (this.endMarker) {
      this.map.removeLayer(this.endMarker);
      this.endMarker = undefined;
    }

    this.startPoint = undefined;
    this.waitingForSecondPoint = false;
  }

  clearMap(): void {
    if (!this.map) {
      return;
    }

    this.resetSelectionOnly();

    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = undefined;
    }

    if (this.nearestLine) {
      this.map.removeLayer(this.nearestLine);
      this.nearestLine = undefined;
    }
  }

  toggleSidebar(): void {
    this.isSidebarOpen = !this.isSidebarOpen;

    setTimeout(() => {
      this.map?.invalidateSize();
    }, 310);
  }

  onSearchInput(): void {
    this.showSearchHistory = this.searchText.trim().length > 0;
  }


  @HostListener('window:resize')
  onResize(): void {
    if (!this.map) {
      return;
    }

    this.map.invalidateSize();
  }

  onSearch(): void {
    console.log('Search:', this.searchText);
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  private createCustomMarker(lat: number, lng: number): L.Marker {
    if (!this.map) {
      throw new Error('Map is not initialized');
    }

    const customIcon = L.icon({
      iconUrl: 'assets/marker-icon.png',
      iconSize: [40, 40],
      iconAnchor: [20, 40],
      popupAnchor: [0, -40]
    });

    return L.marker([lat, lng], { icon: customIcon }).addTo(this.map);
  }
}