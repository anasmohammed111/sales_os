import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JourneyRail, RailStage } from './journey-rail';

const STAGES: RailStage[] = [
  { key: 'lead', name: 'Lead', order: 1, done: 3, required: 3 },
  { key: 'selection', name: 'Selection', order: 2, done: 1, required: 2 },
  { key: 'visa', name: 'Visa', order: 3, done: 0, required: 6 },
];

describe('JourneyRail', () => {
  let fixture: ComponentFixture<JourneyRail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [JourneyRail] }).compileComponents();
    fixture = TestBed.createComponent(JourneyRail);
    fixture.componentRef.setInput('stages', STAGES);
  });

  const states = () =>
    Array.from(fixture.nativeElement.querySelectorAll('.stop') as NodeListOf<HTMLElement>).map((el) =>
      el.classList.contains('stop--passed') ? 'passed' : el.classList.contains('stop--current') ? 'current' : 'ahead'
    );

  it('marks stages before the current one as passed and shows progress on the current one', async () => {
    fixture.componentRef.setInput('currentKey', 'selection');
    await fixture.whenStable();

    expect(states()).toEqual(['passed', 'current', 'ahead']);
    expect(fixture.nativeElement.textContent).toContain('1 of 2 done');
  });

  it('ends the line with the visa outcome once the application is closed', async () => {
    fixture.componentRef.setInput('currentKey', 'visa');
    fixture.componentRef.setInput('outcome', 'REJECTED');
    await fixture.whenStable();

    expect(states()).toEqual(['passed', 'passed', 'passed', 'ahead']);
    expect(fixture.nativeElement.querySelector('.stop--terminus')?.textContent).toContain('Visa rejected');
  });

  it('in counts mode, emits the stage key when a station is clicked', async () => {
    fixture.componentRef.setInput('mode', 'counts');
    fixture.componentRef.setInput('stages', STAGES.map((s, i) => ({ ...s, count: i, stuck: i === 2 ? 1 : 0 })));
    await fixture.whenStable();

    const picked: string[] = [];
    fixture.componentInstance.select.subscribe((key) => picked.push(key));
    (fixture.nativeElement.querySelectorAll('button.station')[2] as HTMLButtonElement).click();

    expect(picked).toEqual(['visa']);
    expect(fixture.nativeElement.textContent).toContain('1 stuck');
  });
});
