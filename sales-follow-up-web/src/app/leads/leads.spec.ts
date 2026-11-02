import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Leads } from './leads';

describe('Leads', () => {
  let component: Leads;
  let fixture: ComponentFixture<Leads>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Leads],
    }).compileComponents();

    fixture = TestBed.createComponent(Leads);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
