import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { RegisterComponent } from './app/features/auth/register/register.component';
import { LoginComponent } from './app/features/auth/login/login.component';
import { MapComponent } from './app/map/map.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter([
      { path: '', component: RegisterComponent },
      { path: 'login', component: LoginComponent },
      { path: 'map', component: MapComponent },
      { path: '**', redirectTo: '' }
    ])
  ]
});