import { Component, OnInit, ElementRef } from '@angular/core';
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

  // All fields initialized to valid numbers — prevents NaN on first render
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
    { key: 'wTime',        label: 'Faster route',           description: 'Prioritize shorter travel time' },
    { key: 'wSafety',      label: 'Safer route',            description: 'Prefer residential and minor roads' },
    { key: 'wSimplicity',  label: 'Simpler route',          description: 'Fewer turns, easier navigation' },
    { key: 'wBeauty',      label: 'More scenic',            description: 'Prefer countryside and minor roads' },
    { key: 'wResidential', label: 'More residential roads', description: 'Prefer living streets over main roads' },
    { key: 'wMinor',       label: 'More minor roads',       description: 'Prefer unclassified and track roads' }
  ];

  isSaving = false;
  isLoading = true;
  saveSuccess = false;
  errorMessage = '';

  private readonly SPRING_BASE = 'http://localhost:8080';

  constructor(
    private http: HttpClient,
    private router: Router,
    private el: ElementRef
  ) {}

  ngOnInit(): void {
    const userId = localStorage.getItem('userId') ?? '0';

    this.http.get<RoutePreferences>(
      `${this.SPRING_BASE}/api/route-preferences?userId=${userId}`
    ).subscribe({
      next: (data) => {
        this.prefs = {
          wTime:        this.toFloat(data.wTime,        this.defaults.wTime),
          wSafety:      this.toFloat(data.wSafety,      this.defaults.wSafety),
          wSimplicity:  this.toFloat(data.wSimplicity,  this.defaults.wSimplicity),
          wBeauty:      this.toFloat(data.wBeauty,      this.defaults.wBeauty),
          wResidential: this.toFloat(data.wResidential, this.defaults.wResidential),
          wMinor:       this.toFloat(data.wMinor,       this.defaults.wMinor),
        };
        this.isLoading = false;
      },
      error: () => {
        this.prefs = { ...this.defaults };
        this.isLoading = false;
      }
    });
  }

  // Safe float — returns fallback if value is NaN/null/undefined
  private toFloat(value: any, fallback: number): number {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : Math.max(0, Math.min(1, n));
  }

  onSliderChange(key: keyof RoutePreferences, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.prefs[key] = this.toFloat(input.value, this.defaults[key]);
  }

  onInputChange(key: keyof RoutePreferences, event: Event): void {
    const input = event.target as HTMLInputElement;
    const clamped = this.toFloat(input.value, this.defaults[key]);
    this.prefs[key] = clamped;
    input.value = clamped.toString();
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
        this.prefs = {
          wTime:        this.toFloat(updated.wTime,        this.defaults.wTime),
          wSafety:      this.toFloat(updated.wSafety,      this.defaults.wSafety),
          wSimplicity:  this.toFloat(updated.wSimplicity,  this.defaults.wSimplicity),
          wBeauty:      this.toFloat(updated.wBeauty,      this.defaults.wBeauty),
          wResidential: this.toFloat(updated.wResidential, this.defaults.wResidential),
          wMinor:       this.toFloat(updated.wMinor,       this.defaults.wMinor),
        };
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

  // Play exit animation then navigate back
  goBack(): void {
    const host = this.el.nativeElement as HTMLElement;
    host.classList.add('leaving');
    // Wait for exit animation (220ms) before navigating
    setTimeout(() => this.router.navigate(['/map']), 220);
  }

  formatValue(val: number): string {
    if (val == null || isNaN(val)) return '0%';
    return (val * 100).toFixed(0) + '%';
  }
}