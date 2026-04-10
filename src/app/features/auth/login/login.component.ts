import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  email = '';
  password = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  constructor(private http: HttpClient, private router: Router) {}

  onSubmit(): void {

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.http.post<{ accessToken: string; userId: number; email: string; role: string }>(
      'http://localhost:8080/api/auth/login',
      {
        email: this.email,
        password: this.password
      }
    ).subscribe({
      next: (response) => {
        console.log('Token received:', response.accessToken);
        localStorage.setItem('accessToken', response.accessToken);
        console.log('Token saved to localStorage:', localStorage.getItem('accessToken'));
        localStorage.setItem('userId', String(response.userId));
        localStorage.setItem('role', response.role);
        this.isLoading = false;
        console.log('Navigating to /map...');
        this.router.navigate(['/map']);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Log in failed. Please try again.';
        this.isLoading = false;
      }
    });
  }
}