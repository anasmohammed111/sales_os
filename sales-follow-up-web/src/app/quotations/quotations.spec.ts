import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Quotations } from './quotations';

describe('Quotations', () => {
  let component: Quotations;
  let fixture: ComponentFixture<Quotations>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Quotations],
    }).compileComponents();

    fixture = TestBed.createComponent(Quotations);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
