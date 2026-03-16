/**
 * WebSocket client for the Cam Tracker backend.
 *
 * Connects to the tracker's binary protocol (opcodes 0x01–0x04),
 * sends JPEG frames from the camera, and receives JSON tracking results
 * with per-object position/pose data.
 *
 * Standalone module — no dependencies on Cortex Loop internals.
 */

// --- Binary protocol opcodes (must match backend protocol.py) ---
const OPCODE_START = 0x01;
const OPCODE_FRAME = 0x02;
const OPCODE_STOP = 0x03;
const OPCODE_CONFIG = 0x04;

// --- Types ---

export type TrackingTarget = 'dispenser' | 'both';

export interface TrackedObject {
    name: 'dispenser' | 'watch';
    type: 'quad' | 'bbox' | 'status' | 'lost';
    corners?: [number, number][]; // quad: 4 perspective corner points
    x?: number;
    y?: number; // bbox position
    w?: number;
    h?: number; // bbox size
    mode: 'tracking' | 'detecting' | 'lost';
}

export interface TrackerUpdate {
    objects: TrackedObject[];
    ms: number;
}

type UpdateCallback = (update: TrackerUpdate) => void;
type StatusCallback = (status: 'connected' | 'disconnected' | 'error') => void;

// --- Frame capture helper ---

const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;
const JPEG_QUALITY = 0.8;

/**
 * Create an offscreen canvas for capturing JPEG frames from a video element.
 * Returns a function that captures a single frame as a Blob.
 */
export function createFrameCapture(video: HTMLVideoElement): () => Promise<Blob | null> {
    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext('2d');

    return async () => {
        if (!ctx || video.readyState < 2) return null;
        ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
        return new Promise<Blob | null>(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', JPEG_QUALITY);
        });
    };
}

// --- TrackerClient ---

const DEFAULT_URL = 'ws://localhost:8000/ws/track';
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

export class TrackerClient {
    private url: string;
    private ws: WebSocket | null = null;
    private updateCallback: UpdateCallback | null = null;
    private statusCallback: StatusCallback | null = null;
    private reconnectDelay = RECONNECT_BASE_MS;
    private shouldReconnect = true;
    private _connected = false;

    constructor(url: string = DEFAULT_URL) {
        this.url = url;
    }

    /** Connect to the tracker backend WebSocket. */
    connect(): void {
        this.shouldReconnect = true;
        this._connect();
    }

    /** Disconnect and stop reconnecting. */
    disconnect(): void {
        this.shouldReconnect = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._connected = false;
    }

    /** Send tracking configuration and start command. */
    startTracking(target: TrackingTarget = 'both'): void {
        if (!this._ready()) return;

        // Send CONFIG opcode with target
        const json = JSON.stringify({ target });
        const jsonBytes = new TextEncoder().encode(json);
        const configPayload = new Uint8Array(1 + jsonBytes.length);
        configPayload[0] = OPCODE_CONFIG;
        configPayload.set(jsonBytes, 1);
        this.ws!.send(configPayload.buffer);

        // Send START opcode
        this.ws!.send(new Uint8Array([OPCODE_START]).buffer);
    }

    /** Stop tracking. */
    stopTracking(): void {
        if (!this._ready()) return;
        this.ws!.send(new Uint8Array([OPCODE_STOP]).buffer);
    }

    /** Send a JPEG frame to the tracker for processing. */
    async sendFrame(blob: Blob): Promise<void> {
        if (!this._ready()) return;

        const arrayBuf = await blob.arrayBuffer();
        const payload = new Uint8Array(1 + arrayBuf.byteLength);
        payload[0] = OPCODE_FRAME;
        payload.set(new Uint8Array(arrayBuf), 1);
        this.ws!.send(payload.buffer);
    }

    /** Register callback for tracking updates. */
    onUpdate(cb: UpdateCallback): void {
        this.updateCallback = cb;
    }

    /** Register callback for connection status changes. */
    onStatus(cb: StatusCallback): void {
        this.statusCallback = cb;
    }

    /** Whether the WebSocket is currently connected and ready. */
    get isConnected(): boolean {
        return this._connected;
    }

    // --- Private ---

    private _connect(): void {
        try {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = 'arraybuffer';
        } catch {
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this._connected = true;
            this.reconnectDelay = RECONNECT_BASE_MS;
            this.statusCallback?.('connected');
        };

        this.ws.onmessage = (event: MessageEvent) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data) as TrackerUpdate;
                    this.updateCallback?.(msg);
                } catch {
                    // Ignore malformed JSON
                }
            }
        };

        this.ws.onclose = () => {
            this._connected = false;
            this.statusCallback?.('disconnected');
            this._scheduleReconnect();
        };

        this.ws.onerror = () => {
            this.ws?.close();
        };
    }

    private _scheduleReconnect(): void {
        if (!this.shouldReconnect) return;
        setTimeout(() => {
            if (this.shouldReconnect) this._connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    }

    private _ready(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
