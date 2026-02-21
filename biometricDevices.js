// ============================================
// BIOMETRIC DEVICES — Cortex Loop
// ============================================
// 6 consumer wearable devices with display channels for biometric strip visualization.
// Each device maps to a set of physiological signals rendered as oscilloscope-style waveforms.
// All waveforms use a red/crimson palette to visually distinguish from the blue/gold phase curves.
// Loaded via <script> tag — exposes global BIOMETRIC_DEVICES.

// Red-shade palette for biometric strips (10 distinct shades, light→dark)
const BIO_RED_PALETTE = [
    '#ff4d4d',  // bright scarlet
    '#e03e3e',  // crimson
    '#c92a2a',  // deep red
    '#ff6b6b',  // coral red
    '#f76707',  // red-orange
    '#d9480f',  // burnt sienna
    '#ff8787',  // soft rose
    '#e8590c',  // ember
    '#fa5252',  // vivid red
    '#b72b2b',  // dark crimson
];

const BIOMETRIC_DEVICES = {
    devices: [
        {
            key: 'watch',
            name: 'Watch',
            deviceType: 'watch',
            iconDark: 'assets/icons/apple-watch.dark.png',
            iconLight: 'assets/icons/apple-watch.light.png',
            color: '#ff4d4d',
            displayChannels: [
                { signal: 'hr_bpm',       displayName: 'Heart Rate',  color: '#ff4d4d', range: [40, 180], unit: 'bpm',  stripHeight: 18 },
                { signal: 'hrv_ms',       displayName: 'HRV',         color: '#e03e3e', range: [10, 120], unit: 'ms',   stripHeight: 16 },
                { signal: 'spo2_pct',     displayName: 'SpO2',        color: '#c92a2a', range: [90, 100], unit: '%',    stripHeight: 14 },
                { signal: 'skin_temp_c',  displayName: 'Skin Temp',   color: '#ff6b6b', range: [33, 38],  unit: '°C',   stripHeight: 14 },
                { signal: 'resp_rate',    displayName: 'Resp Rate',   color: '#f76707', range: [8, 25],   unit: 'br/m', stripHeight: 14 },
            ],
        },
        {
            key: 'band',
            name: 'Band',
            deviceType: 'wrist_band',
            iconDark: 'assets/icons/whoop-band.dark.png',
            iconLight: 'assets/icons/whoop-band.light.png',
            color: '#c92a2a',
            displayChannels: [
                { signal: 'hr_bpm',       displayName: 'Heart Rate',     color: '#ff4d4d', range: [40, 180], unit: 'bpm',  stripHeight: 18 },
                { signal: 'hrv_ms',       displayName: 'HRV',            color: '#e03e3e', range: [10, 120], unit: 'ms',   stripHeight: 16 },
                { signal: 'resp_rate',    displayName: 'Resp Rate',      color: '#f76707', range: [8, 25],   unit: 'br/m', stripHeight: 14 },
                { signal: 'spo2_pct',     displayName: 'SpO2',           color: '#c92a2a', range: [90, 100], unit: '%',    stripHeight: 14 },
                { signal: 'training_load',displayName: 'Training Load',  color: '#d9480f', range: [0, 100],  unit: '',     stripHeight: 14 },
            ],
        },
        {
            key: 'ring',
            name: 'Ring',
            deviceType: 'ring',
            iconDark: 'assets/icons/oura-ring.dark.png',
            iconLight: 'assets/icons/oura-ring.light.png',
            color: '#e03e3e',
            displayChannels: [
                { signal: 'hr_bpm',           displayName: 'Heart Rate',  color: '#ff4d4d', range: [40, 180], unit: 'bpm',  stripHeight: 18 },
                { signal: 'hrv_ms',           displayName: 'HRV',         color: '#e03e3e', range: [10, 120], unit: 'ms',   stripHeight: 16 },
                { signal: 'skin_temp_delta',  displayName: 'Temp Delta',  color: '#ff8787', range: [-1.5, 1.5], unit: '°C', stripHeight: 14 },
                { signal: 'spo2_pct',         displayName: 'SpO2',        color: '#c92a2a', range: [90, 100], unit: '%',    stripHeight: 14 },
                { signal: 'resp_rate',        displayName: 'Resp Rate',   color: '#f76707', range: [8, 25],   unit: 'br/m', stripHeight: 14 },
            ],
        },
        {
            key: 'bed',
            name: 'Bed',
            deviceType: 'bed_sensors',
            iconDark: 'assets/icons/smart-bed.dark.png',
            iconLight: 'assets/icons/smart-bed.light.png',
            color: '#fa5252',
            displayChannels: [
                { signal: 'hr_bpm',           displayName: 'Heart Rate',     color: '#ff4d4d', range: [40, 180], unit: 'bpm',  stripHeight: 18 },
                { signal: 'hrv_ms',           displayName: 'HRV',            color: '#e03e3e', range: [10, 120], unit: 'ms',   stripHeight: 16 },
                { signal: 'resp_rate',        displayName: 'Resp Rate',      color: '#f76707', range: [8, 25],   unit: 'br/m', stripHeight: 14 },
                { signal: 'skin_temp_delta',  displayName: 'Temp Delta',     color: '#ff8787', range: [-1.5, 1.5], unit: '°C', stripHeight: 14 },
                { signal: 'sleep_stages',     displayName: 'Sleep Stages',   color: '#b72b2b', range: [0, 4],    unit: '',     stripHeight: 16 },
            ],
        },
        {
            key: 'chest',
            name: 'Chest',
            deviceType: 'chest_band',
            iconDark: 'assets/icons/chest-band.dark.png',
            iconLight: 'assets/icons/chest-band.light.png',
            color: '#ff6b6b',
            displayChannels: [
                { signal: 'hr_bpm',           displayName: 'Heart Rate',     color: '#ff4d4d', range: [40, 180], unit: 'bpm',  stripHeight: 18 },
                { signal: 'hrv_ms',           displayName: 'HRV',            color: '#e03e3e', range: [10, 120], unit: 'ms',   stripHeight: 16 },
                { signal: 'resp_rate',        displayName: 'Resp Rate',      color: '#f76707', range: [8, 25],   unit: 'br/m', stripHeight: 14 },
                { signal: 'training_load',    displayName: 'Training Load',  color: '#d9480f', range: [0, 100],  unit: '',     stripHeight: 14 },
                { signal: 'rr_interval',      displayName: 'RR Interval',    color: '#fa5252', range: [300, 1200], unit: 'ms', stripHeight: 14 },
            ],
        },
        {
            key: 'cgm',
            name: 'CGM',
            deviceType: 'cgm',
            iconDark: 'assets/icons/cgm-sensor.dark.png',
            iconLight: 'assets/icons/cgm-sensor.light.png',
            color: '#e8590c',
            displayChannels: [
                { signal: 'glucose_mgdl',  displayName: 'Glucose',      color: '#e8590c', range: [60, 200],   unit: 'mg/dL',    stripHeight: 20 },
                { signal: 'glucose_roc',   displayName: 'Glucose RoC',  color: '#d9480f', range: [-3, 3],     unit: 'mg/dL/m',  stripHeight: 16 },
            ],
        },
    ],
};
