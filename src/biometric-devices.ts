// ============================================
// BIOMETRIC DEVICES — Cortex Loop
// ============================================
// 6 consumer wearable devices with display channels for biometric strip visualization.
// Each device maps to a set of physiological signals rendered as oscilloscope-style waveforms.
// All waveforms use a red/crimson palette to visually distinguish from the blue/gold phase curves.

export interface SignalMeta {
    displayName: string;
    unit: string;
    range: [number, number];
    stripHeight: number;
}

export interface SubChannel {
    signal: string;
    displayName: string;
    color: string;
    range: [number, number];
}

export interface DisplayChannel {
    signal: string;
    displayName: string;
    color: string;
    range: [number, number];
    unit: string;
    stripHeight: number;
    composite?: boolean;
    subChannels?: SubChannel[];
}

export interface BiometricDevice {
    key: string;
    name: string;
    deviceType: string;
    iconDark: string;
    iconLight: string;
    color: string;
    displayChannels: DisplayChannel[];
    fullSignals: string[];
}

// Red-shade palette for biometric strips (10 distinct shades, light->dark)
export const BIO_RED_PALETTE: string[] = [
    '#ff4d4d', // bright scarlet
    '#e03e3e', // crimson
    '#c92a2a', // deep red
    '#ff6b6b', // coral red
    '#f76707', // red-orange
    '#d9480f', // burnt sienna
    '#ff8787', // soft rose
    '#e8590c', // ember
    '#fa5252', // vivid red
    '#b72b2b', // dark crimson
];

// ============================================
// SIGNAL METADATA — Full ontology rendering lookup
// ============================================
// Maps every canonical signal from the biometric-device-ontology to display metadata.
// Used when the spotter LLM picks channels from the full ontology so we can render them
// without the LLM specifying every visual detail.
export const SIGNAL_METADATA: Record<string, SignalMeta> = {
    // --- Cardiac ---
    hr_bpm: { displayName: 'Heart Rate', unit: 'bpm', range: [40, 180], stripHeight: 18 },
    resting_hr_bpm: { displayName: 'Resting HR', unit: 'bpm', range: [40, 100], stripHeight: 16 },
    rri_ms: { displayName: 'RR Interval', unit: 'ms', range: [300, 1200], stripHeight: 14 },
    // --- HRV sub-metrics ---
    hrv_rmssd_ms: { displayName: 'HRV (RMSSD)', unit: 'ms', range: [10, 120], stripHeight: 16 },
    hrv_sdnn_ms: { displayName: 'HRV (SDNN)', unit: 'ms', range: [20, 200], stripHeight: 16 },
    hrv_hf_power_ms2: { displayName: 'HRV HF Power', unit: 'ms\u00B2', range: [0, 3000], stripHeight: 16 },
    hrv_lf_power_ms2: { displayName: 'HRV LF Power', unit: 'ms\u00B2', range: [0, 3000], stripHeight: 16 },
    hrv_lf_hf_ratio: { displayName: 'LF/HF Ratio', unit: 'ratio', range: [0.5, 6], stripHeight: 14 },
    // --- Respiratory ---
    resp_rate_bpm: { displayName: 'Resp Rate', unit: 'br/min', range: [8, 25], stripHeight: 14 },
    spo2_pct: { displayName: 'SpO2', unit: '%', range: [90, 100], stripHeight: 14 },
    // --- Temperature ---
    skin_temp_c: { displayName: 'Skin Temp', unit: '\u00B0C', range: [33, 38], stripHeight: 14 },
    skin_temp_delta_c: { displayName: 'Temp Delta', unit: '\u00B0C', range: [-1.5, 1.5], stripHeight: 14 },
    bed_temp_c: { displayName: 'Bed Temp', unit: '\u00B0C', range: [25, 40], stripHeight: 14 },
    // --- Sleep (time-series renderable) ---
    sleep_total_min: { displayName: 'Total Sleep', unit: 'min', range: [0, 600], stripHeight: 16 },
    sleep_latency_min: { displayName: 'Sleep Latency', unit: 'min', range: [0, 90], stripHeight: 14 },
    sleep_efficiency_pct: { displayName: 'Sleep Eff.', unit: '%', range: [50, 100], stripHeight: 16 },
    sleep_stage_min_awake: { displayName: 'Awake', unit: 'min', range: [0, 120], stripHeight: 14 },
    sleep_stage_min_light: { displayName: 'Light Sleep', unit: 'min', range: [0, 300], stripHeight: 14 },
    sleep_stage_min_deep: { displayName: 'Deep Sleep', unit: 'min', range: [0, 150], stripHeight: 16 },
    sleep_stage_min_rem: { displayName: 'REM Sleep', unit: 'min', range: [0, 180], stripHeight: 16 },
    sleep_wake_events_count: { displayName: 'Wake Events', unit: 'count', range: [0, 20], stripHeight: 14 },
    sleep_movement_index: { displayName: 'Movement Idx', unit: 'index', range: [0, 100], stripHeight: 14 },
    // --- Activity ---
    steps_count: { displayName: 'Steps', unit: 'count', range: [0, 2000], stripHeight: 14 },
    distance_m: { displayName: 'Distance', unit: 'm', range: [0, 5000], stripHeight: 14 },
    active_energy_kcal: { displayName: 'Active Energy', unit: 'kcal', range: [0, 500], stripHeight: 14 },
    floors_climbed_count: { displayName: 'Floors', unit: 'count', range: [0, 30], stripHeight: 14 },
    altitude_m: { displayName: 'Altitude', unit: 'm', range: [0, 500], stripHeight: 14 },
    training_load_score: { displayName: 'Training Load', unit: 'score', range: [0, 100], stripHeight: 14 },
    // --- Glucose ---
    glucose_mgdl: { displayName: 'Glucose', unit: 'mg/dL', range: [60, 200], stripHeight: 20 },
    glucose_roc_mgdl_min: { displayName: 'Glucose RoC', unit: 'mg/dL/min', range: [-3, 3], stripHeight: 16 },
    tir_pct: { displayName: 'Time in Range', unit: '%', range: [0, 100], stripHeight: 16 },
    tar_pct: { displayName: 'Time Above Range', unit: '%', range: [0, 50], stripHeight: 14 },
    tbr_pct: { displayName: 'Time Below Range', unit: '%', range: [0, 50], stripHeight: 14 },
    gmi_pct: { displayName: 'GMI', unit: '%', range: [5, 10], stripHeight: 14 },
    glucose_mean_mgdl: { displayName: 'Mean Glucose', unit: 'mg/dL', range: [60, 200], stripHeight: 16 },
    glucose_cv_pct: { displayName: 'Glucose CV', unit: '%', range: [0, 50], stripHeight: 14 },
    // --- Legacy aliases (map old signal names to canonical) ---
    hrv_ms: { displayName: 'HRV', unit: 'ms', range: [10, 120], stripHeight: 16 },
    resp_rate: { displayName: 'Resp Rate', unit: 'br/min', range: [8, 25], stripHeight: 14 },
    skin_temp_delta: { displayName: 'Temp Delta', unit: '\u00B0C', range: [-1.5, 1.5], stripHeight: 14 },
    training_load: { displayName: 'Training Load', unit: 'score', range: [0, 100], stripHeight: 14 },
    rr_interval: { displayName: 'RR Interval', unit: 'ms', range: [300, 1200], stripHeight: 14 },
    glucose_roc: { displayName: 'Glucose RoC', unit: 'mg/dL/min', range: [-3, 3], stripHeight: 16 },
};

const biometricIconUrl = (filename: string): string => `/assets/icons/${filename}`;

export const BIOMETRIC_DEVICES: { devices: BiometricDevice[] } = {
    devices: [
        {
            key: 'watch',
            name: 'Watch',
            deviceType: 'watch',
            iconDark: biometricIconUrl('apple-watch.dark.png'),
            iconLight: biometricIconUrl('apple-watch.light.png'),
            color: '#ff4d4d',
            displayChannels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                },
                {
                    signal: 'spo2_pct',
                    displayName: 'SpO2',
                    color: '#c92a2a',
                    range: [90, 100],
                    unit: '%',
                    stripHeight: 14,
                },
                {
                    signal: 'skin_temp_c',
                    displayName: 'Skin Temp',
                    color: '#ff6b6b',
                    range: [33, 38],
                    unit: '\u00B0C',
                    stripHeight: 14,
                },
                {
                    signal: 'resp_rate',
                    displayName: 'Resp Rate',
                    color: '#f76707',
                    range: [8, 25],
                    unit: 'br/m',
                    stripHeight: 14,
                },
                {
                    signal: 'sleep_composite',
                    displayName: 'Sleep',
                    color: '#8b5cf6',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 24,
                    composite: true,
                    subChannels: [
                        { signal: 'sleep_deep', displayName: 'Deep', color: '#4a5fc1', range: [0, 100] },
                        { signal: 'sleep_rem', displayName: 'REM', color: '#8b5cf6', range: [0, 100] },
                        { signal: 'sleep_light', displayName: 'Light', color: '#f9a8d4', range: [0, 100] },
                    ],
                },
            ],
            fullSignals: [
                'hr_bpm',
                'resting_hr_bpm',
                'rri_ms',
                'hrv_rmssd_ms',
                'hrv_sdnn_ms',
                'resp_rate_bpm',
                'spo2_pct',
                'skin_temp_c',
                'skin_temp_delta_c',
                'sleep_total_min',
                'sleep_latency_min',
                'sleep_efficiency_pct',
                'sleep_stage_min_awake',
                'sleep_stage_min_light',
                'sleep_stage_min_deep',
                'sleep_stage_min_rem',
                'sleep_wake_events_count',
                'sleep_movement_index',
                'steps_count',
                'distance_m',
                'active_energy_kcal',
                'floors_climbed_count',
                'altitude_m',
                'training_load_score',
                'hrv_hf_power_ms2',
                'hrv_lf_power_ms2',
                'hrv_lf_hf_ratio',
            ],
        },
        {
            key: 'band',
            name: 'Band',
            deviceType: 'wrist_band',
            iconDark: biometricIconUrl('whoop-band.dark.png'),
            iconLight: biometricIconUrl('whoop-band.light.png'),
            color: '#c92a2a',
            displayChannels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                },
                {
                    signal: 'resp_rate',
                    displayName: 'Resp Rate',
                    color: '#f76707',
                    range: [8, 25],
                    unit: 'br/m',
                    stripHeight: 14,
                },
                {
                    signal: 'spo2_pct',
                    displayName: 'SpO2',
                    color: '#c92a2a',
                    range: [90, 100],
                    unit: '%',
                    stripHeight: 14,
                },
                {
                    signal: 'training_load',
                    displayName: 'Training Load',
                    color: '#d9480f',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 14,
                },
                {
                    signal: 'sleep_composite',
                    displayName: 'Sleep',
                    color: '#8b5cf6',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 24,
                    composite: true,
                    subChannels: [
                        { signal: 'sleep_deep', displayName: 'Deep', color: '#4a5fc1', range: [0, 100] },
                        { signal: 'sleep_rem', displayName: 'REM', color: '#8b5cf6', range: [0, 100] },
                        { signal: 'sleep_light', displayName: 'Light', color: '#f9a8d4', range: [0, 100] },
                    ],
                },
            ],
            fullSignals: [
                'hr_bpm',
                'resting_hr_bpm',
                'rri_ms',
                'hrv_rmssd_ms',
                'hrv_sdnn_ms',
                'resp_rate_bpm',
                'spo2_pct',
                'skin_temp_c',
                'skin_temp_delta_c',
                'sleep_total_min',
                'sleep_latency_min',
                'sleep_efficiency_pct',
                'sleep_stage_min_awake',
                'sleep_stage_min_light',
                'sleep_stage_min_deep',
                'sleep_stage_min_rem',
                'sleep_wake_events_count',
                'sleep_movement_index',
                'steps_count',
                'distance_m',
                'active_energy_kcal',
                'training_load_score',
            ],
        },
        {
            key: 'ring',
            name: 'Ring',
            deviceType: 'ring',
            iconDark: biometricIconUrl('oura-ring.dark.png'),
            iconLight: biometricIconUrl('oura-ring.light.png'),
            color: '#e03e3e',
            displayChannels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                },
                {
                    signal: 'skin_temp_delta',
                    displayName: 'Temp Delta',
                    color: '#ff8787',
                    range: [-1.5, 1.5],
                    unit: '\u00B0C',
                    stripHeight: 14,
                },
                {
                    signal: 'spo2_pct',
                    displayName: 'SpO2',
                    color: '#c92a2a',
                    range: [90, 100],
                    unit: '%',
                    stripHeight: 14,
                },
                {
                    signal: 'resp_rate',
                    displayName: 'Resp Rate',
                    color: '#f76707',
                    range: [8, 25],
                    unit: 'br/m',
                    stripHeight: 14,
                },
                {
                    signal: 'sleep_composite',
                    displayName: 'Sleep',
                    color: '#8b5cf6',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 24,
                    composite: true,
                    subChannels: [
                        { signal: 'sleep_deep', displayName: 'Deep', color: '#4a5fc1', range: [0, 100] },
                        { signal: 'sleep_rem', displayName: 'REM', color: '#8b5cf6', range: [0, 100] },
                        { signal: 'sleep_light', displayName: 'Light', color: '#f9a8d4', range: [0, 100] },
                    ],
                },
            ],
            fullSignals: [
                'hr_bpm',
                'resting_hr_bpm',
                'rri_ms',
                'hrv_rmssd_ms',
                'hrv_sdnn_ms',
                'resp_rate_bpm',
                'spo2_pct',
                'skin_temp_c',
                'skin_temp_delta_c',
                'sleep_total_min',
                'sleep_latency_min',
                'sleep_efficiency_pct',
                'sleep_stage_min_awake',
                'sleep_stage_min_light',
                'sleep_stage_min_deep',
                'sleep_stage_min_rem',
                'sleep_wake_events_count',
                'sleep_movement_index',
                'steps_count',
                'active_energy_kcal',
            ],
        },
        {
            key: 'bed',
            name: 'Bed',
            deviceType: 'bed_sensors',
            iconDark: biometricIconUrl('smart-bed.dark.png'),
            iconLight: biometricIconUrl('smart-bed.light.png'),
            color: '#fa5252',
            displayChannels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                },
                {
                    signal: 'resp_rate',
                    displayName: 'Resp Rate',
                    color: '#f76707',
                    range: [8, 25],
                    unit: 'br/m',
                    stripHeight: 14,
                },
                {
                    signal: 'skin_temp_delta',
                    displayName: 'Temp Delta',
                    color: '#ff8787',
                    range: [-1.5, 1.5],
                    unit: '\u00B0C',
                    stripHeight: 14,
                },
                {
                    signal: 'sleep_composite',
                    displayName: 'Sleep',
                    color: '#8b5cf6',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 24,
                    composite: true,
                    subChannels: [
                        { signal: 'sleep_deep', displayName: 'Deep', color: '#4a5fc1', range: [0, 100] },
                        { signal: 'sleep_rem', displayName: 'REM', color: '#8b5cf6', range: [0, 100] },
                        { signal: 'sleep_light', displayName: 'Light', color: '#f9a8d4', range: [0, 100] },
                    ],
                },
            ],
            fullSignals: [
                'hr_bpm',
                'resting_hr_bpm',
                'rri_ms',
                'hrv_rmssd_ms',
                'hrv_sdnn_ms',
                'resp_rate_bpm',
                'sleep_total_min',
                'sleep_latency_min',
                'sleep_efficiency_pct',
                'sleep_stage_min_awake',
                'sleep_stage_min_light',
                'sleep_stage_min_deep',
                'sleep_stage_min_rem',
                'sleep_wake_events_count',
                'sleep_movement_index',
                'bed_temp_c',
            ],
        },
        {
            key: 'chest',
            name: 'Chest',
            deviceType: 'chest_band',
            iconDark: biometricIconUrl('chest-band.dark.png'),
            iconLight: biometricIconUrl('chest-band.light.png'),
            color: '#ff6b6b',
            displayChannels: [
                {
                    signal: 'hr_bpm',
                    displayName: 'Heart Rate',
                    color: '#ff4d4d',
                    range: [40, 180],
                    unit: 'bpm',
                    stripHeight: 18,
                },
                {
                    signal: 'hrv_ms',
                    displayName: 'HRV',
                    color: '#e03e3e',
                    range: [10, 120],
                    unit: 'ms',
                    stripHeight: 16,
                },
                {
                    signal: 'resp_rate',
                    displayName: 'Resp Rate',
                    color: '#f76707',
                    range: [8, 25],
                    unit: 'br/m',
                    stripHeight: 14,
                },
                {
                    signal: 'training_load',
                    displayName: 'Training Load',
                    color: '#d9480f',
                    range: [0, 100],
                    unit: '',
                    stripHeight: 14,
                },
                {
                    signal: 'rr_interval',
                    displayName: 'RR Interval',
                    color: '#fa5252',
                    range: [300, 1200],
                    unit: 'ms',
                    stripHeight: 14,
                },
            ],
            fullSignals: [
                'hr_bpm',
                'resting_hr_bpm',
                'rri_ms',
                'hrv_rmssd_ms',
                'hrv_sdnn_ms',
                'training_load_score',
                'resp_rate_bpm',
                'hrv_hf_power_ms2',
                'hrv_lf_power_ms2',
                'hrv_lf_hf_ratio',
            ],
        },
        {
            key: 'cgm',
            name: 'CGM',
            deviceType: 'cgm',
            iconDark: biometricIconUrl('cgm-sensor.dark.png'),
            iconLight: biometricIconUrl('cgm-sensor.light.png'),
            color: '#e8590c',
            displayChannels: [
                {
                    signal: 'glucose_mgdl',
                    displayName: 'Glucose',
                    color: '#e8590c',
                    range: [60, 200],
                    unit: 'mg/dL',
                    stripHeight: 20,
                },
                {
                    signal: 'glucose_roc',
                    displayName: 'Glucose RoC',
                    color: '#d9480f',
                    range: [-3, 3],
                    unit: 'mg/dL/m',
                    stripHeight: 16,
                },
            ],
            fullSignals: [
                'glucose_mgdl',
                'glucose_roc_mgdl_min',
                'tir_pct',
                'tar_pct',
                'tbr_pct',
                'gmi_pct',
                'glucose_mean_mgdl',
                'glucose_cv_pct',
            ],
        },
    ],
};
