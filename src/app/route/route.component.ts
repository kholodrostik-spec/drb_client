import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';

interface RoutePreferences {
  wTime: number;
  wSafety: number;
  wSimplicity: number;
  wBeauty: number;
  wResidential: number;
  wMinor: number;
}

interface SliderConfig {
  key: keyof RoutePreferences;
  label: string;
  description: string;
}

@Component({
  selector: 'app-route',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './route.component.html',
  styleUrls: ['./route.component.scss']
})
export class RouteSettingsComponent implements OnInit {

  prefs: RoutePreferences = {
    wTime: 0.4,
    wSafety: 0.2,
    wSimplicity: 0.15,
    wBeauty: 0.15,
    wResidential: 0.05,
    wMinor: 0.05
  };

  readonly defaults: RoutePreferences = {
    wTime: 0.4,
    wSafety: 0.2,
    wSimplicity: 0.15,
    wBeauty: 0.15,
    wResidential: 0.05,
    wMinor: 0.05
  };

  readonly sliders: SliderConfig[] = [
    { key: 'wTime',        label: 'Faster route',          description: 'Prioritize shorter travel time' },
    { key: 'wSafety',      label: 'Safer route',           description: 'Prefer residential and minor roads' },
    { key: 'wSimplicity',  label: 'Simpler route',         description: 'Fewer turns, easier navigation' },
    { key: 'wBeauty',      label: 'More scenic',           description: 'Prefer countryside and minor roads' },
    { key: 'wResidential', label: 'More residential roads', description: 'Prefer living streets over main roads' },
    { key: 'wMinor',       label: 'More minor roads',      description: 'Prefer unclassified and track roads' }
  ];

  isSaving = false;
  isLoading = true;
  saveSuccess = false;
  errorMessage = '';

  private readonly SPRING_BASE = 'http://localhost:8080';

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit(): void {
    const userId = localStorage.getItem('userId') ?? '0';
    this.http.get<RoutePreferences>(
      `${this.SPRING_BASE}/api/route-preferences?userId=${userId}`
    ).subscribe({
      next: (data) => {
        this.prefs = { ...data };
        this.isLoading = false;
      },
      error: () => {
        // Fall back to defaults on error
        this.prefs = { ...this.defaults };
        this.isLoading = false;
      }
    });
  }

  // Clamp input value between 0 and 1
  onInputChange(key: keyof RoutePreferences, event: Event): void {
    const input = event.target as HTMLInputElement;
    let value = parseFloat(input.value);
    if (isNaN(value)) value = 0;
    value = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
    this.prefs[key] = value;
    input.value = value.toString();
  }

  onSliderChange(key: keyof RoutePreferences, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.prefs[key] = parseFloat(input.value);
  }

  resetToDefaults(): void {
    this.prefs = { ...this.defaults };
    this.saveSuccess = false;
    this.errorMessage = '';
  }

  save(): void {
    this.isSaving = true;
    this.saveSuccess = false;
    this.errorMessage = '';

    const userId = localStorage.getItem('userId') ?? '0';

    this.http.put<RoutePreferences>(
      `${this.SPRING_BASE}/api/route-preferences?userId=${userId}`,
      this.prefs
    ).subscribe({
      next: (updated) => {
        this.prefs = { ...updated };
        this.isSaving = false;
        this.saveSuccess = true;
        setTimeout(() => this.saveSuccess = false, 3000);
      },
      error: (err) => {
        this.isSaving = false;
        this.errorMessage = 'Failed to save. Please try again.';
        console.error('Save preferences failed', err);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/map']);
  }

  formatValue(val: number): string {
    return (val * 100).toFixed(0) + '%';
  }
}