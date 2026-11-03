import { Component, computed, input, output } from '@angular/core';

export interface RailStage {
  key: string;
  name: string;
  order: number;
  isArchived?: boolean;
  /** counts mode */
  count?: number;
  stuck?: number;
  /** progress mode */
  done?: number;
  required?: number;
}

/**
 * The student's route through the admissions stages, drawn like a transit line.
 * progress mode: where one student is (passed, current, ahead) and the visa outcome.
 * counts mode: how many students wait at each station; stations are clickable.
 */
@Component({
  selector: 'adm-journey-rail',
  templateUrl: './journey-rail.html',
  styleUrl: './journey-rail.scss',
})
export class JourneyRail {
  readonly stages = input.required<RailStage[]>();
  readonly mode = input<'progress' | 'counts'>('progress');
  readonly currentKey = input<string | null>(null);
  readonly outcome = input<'APPROVED' | 'REJECTED' | 'PENDING' | null>(null);
  readonly compact = input(false);
  readonly select = output<string>();

  readonly currentOrder = computed(() => this.stages().find((s) => s.key === this.currentKey())?.order ?? 0);

  stateOf(stage: RailStage): 'passed' | 'current' | 'ahead' {
    if (this.mode() === 'counts') return stage.count ? 'current' : 'ahead';
    const finished = this.outcome() === 'APPROVED' || this.outcome() === 'REJECTED';
    if (stage.key === this.currentKey()) return finished ? 'passed' : 'current';
    return stage.order < this.currentOrder() ? 'passed' : 'ahead';
  }

  label(stage: RailStage, index: number): string {
    if (this.mode() === 'counts') {
      const stuck = stage.stuck ? `, ${stage.stuck} stuck` : '';
      return `${stage.name}: ${stage.count ?? 0} students${stuck}`;
    }
    const state = this.stateOf(stage);
    const word = state === 'passed' ? 'done' : state === 'current' ? 'current stage' : 'not reached';
    return `Stage ${index + 1}, ${stage.name}: ${word}`;
  }
}
