import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'ka-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AdminApp {}
