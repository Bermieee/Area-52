import { ResultClass } from './constants.js';

export class ForegroundDeadlinePolicy {
  state(task, now) {
    const time=Number(now);
    if (time > task.hardDeadline) return 'HARD_EXPIRED';
    if (time > task.softDeadline) return 'SOFT_EXPIRED';
    return 'OPEN';
  }

  canBlockForeground(task, now) {
    return task.resultClass === ResultClass.REQUIRED && this.state(task, now) !== 'HARD_EXPIRED';
  }

  shouldRetry(task, { now, attempt = 1 } = {}) {
    const maxRetries=Number(task.fallbackPolicy?.maxRetries ?? 0);
    if (attempt > maxRetries) return false;
    const state=this.state(task, now);
    if (state === 'HARD_EXPIRED') return false;
    if (task.resultClass === ResultClass.OPPORTUNISTIC && state !== 'OPEN') return false;
    return task.resultClass !== ResultClass.DEFERRED;
  }

  hardDeadlineAction(task) {
    if (task.resultClass === ResultClass.REQUIRED) return 'FALLBACK_REQUIRED';
    if (task.resultClass === ResultClass.OPPORTUNISTIC) return 'ROUTE_NEXT_TURN';
    return 'ROUTE_BACKGROUND';
  }
}
