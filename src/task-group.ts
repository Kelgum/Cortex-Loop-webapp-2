import type { TaskGroupController } from './contracts';

export class TaskGroup implements TaskGroupController {
    private readonly rafIds = new Set<number>();
    private readonly timeoutIds = new Set<number>();

    trackAnimationFrame(callback: FrameRequestCallback): number {
        const rafId = requestAnimationFrame(timestamp => {
            this.rafIds.delete(rafId);
            callback(timestamp);
        });
        this.rafIds.add(rafId);
        return rafId;
    }

    trackTimeout(callback: () => void, delayMs: number): number {
        const timeoutId = window.setTimeout(() => {
            this.timeoutIds.delete(timeoutId);
            callback();
        }, delayMs);
        this.timeoutIds.add(timeoutId);
        return timeoutId;
    }

    cancelAll(): void {
        for (const rafId of this.rafIds) {
            cancelAnimationFrame(rafId);
        }
        this.rafIds.clear();

        for (const timeoutId of this.timeoutIds) {
            window.clearTimeout(timeoutId);
        }
        this.timeoutIds.clear();
    }
}
