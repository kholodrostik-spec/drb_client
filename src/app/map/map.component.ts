import { Component, AfterViewInit, OnDestroy } from '@angular/core';
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
  private map!: L.Map;
  searchText = '';

  private readonly IRELAND_BOUNDS = L.latLngBounds(
    L.latLng(51.2, -10.8),
    L.latLng(55.5, -5.3)
  );

  ngAfterViewInit(): void {
    setTimeout(() => this.initMap(), 100);
  }

  private initMap(): void {
    const container = document.getElementById('map');
    if (!container) return;

    const bounds = this.IRELAND_BOUNDS;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    
    const lngDiff = ne.lng - sw.lng;
    const latDiff = ne.lat - sw.lat;
    
    const availableHeight = window.innerHeight - 32;
    const availableWidth = window.innerWidth - 32;
    
    const aspectRatio = lngDiff / latDiff;
    
    let width = availableHeight * aspectRatio;
    let height = availableHeight;
    
    if (width > availableWidth) {
      width = availableWidth;
      height = width / aspectRatio;
    }

    container.style.width = `${Math.floor(width)}px`;
    container.style.height = `${Math.floor(height)}px`;

    this.map = L.map('map', {
      center: [53.1424, -7.6921],
      zoom: 7,
      minZoom: 6,
      maxZoom: 18,
      maxBounds: bounds,
      maxBoundsViscosity: 1.0,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      subdomains: ['a', 'b', 'c']
    }).addTo(this.map);

    this.addIrelandBorder();
  }

  private addIrelandBorder(): void {
    const border: L.LatLngExpression[] = [
      [55.4, -8.2], [55.3, -6.2], [54.0, -5.9], [52.8, -6.0],
      [51.4, -8.5], [51.3, -9.8], [52.5, -10.7], [53.8, -10.5],
      [54.5, -10.0], [55.2, -7.6], [55.4, -8.2]
    ];

    L.polygon(border, {
      color: '#4CAF50',
      weight: 3,
      fillColor: '#4CAF50',
      fillOpacity: 0.1
    }).addTo(this.map);
  }

  onSearch(): void {
    console.log('Search:', this.searchText);
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }
}