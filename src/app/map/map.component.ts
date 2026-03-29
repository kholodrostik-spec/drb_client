import { AfterViewInit, Component, HostListener, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss']
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private map?: L.Map;
  searchText = '';

  private readonly irelandBounds = L.latLngBounds(
    [51.2, -10.8],
    [55.5, -5.3]
  );

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.createMap();
    });
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
}