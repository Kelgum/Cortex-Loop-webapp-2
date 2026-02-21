import { CLASS_COLORS } from './constants';
import { AppState } from './state';

export const SUBSTANCE_DB: Record<string, any> = {
    caffeineIR: {
        name: "Caffeine (IR)",
        class: "Stimulant",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Extensive clinical PK for CYP1A2 metabolism of anhydrous caffeine.",
        color: "#ff4757",
        standardDose: "100mg",
        pharma: { onset: 20, peak: 45, duration: 240, halfLife: 300, strength: 40, rebound: 10 }
    },
    caffeineXR: {
        name: "Caffeine (XR)",
        class: "Stimulant",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Extended-release matrix delays peak and extends functional plateau.",
        color: "#ff4757",
        standardDose: "100mg",
        pharma: { onset: 45, peak: 120, duration: 480, halfLife: 300, strength: 30, rebound: 5 }
    },
    adderallIR: {
        name: "Adderall (IR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "FDA mandated PK data for mixed amphetamine salts (75% D, 25% L).",
        color: "#ff4757",
        standardDose: "15mg",
        pharma: { onset: 20, peak: 90, duration: 240, halfLife: 600, strength: 85, rebound: 25 }
    },
    adderallXR: {
        name: "Adderall (XR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "50% immediate, 50% delayed release bead mechanism provides dual peak.",
        color: "#ff4757",
        standardDose: "20mg",
        pharma: { onset: 30, peak: 240, duration: 600, halfLife: 600, strength: 75, rebound: 20 }
    },
    vyvanse: {
        name: "Vyvanse",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Lisdexamfetamine prodrug cleavage rate limits peak and extends curve smoothly.",
        color: "#ff4757",
        standardDose: "30mg",
        pharma: { onset: 90, peak: 210, duration: 720, halfLife: 720, strength: 75, rebound: 15 }
    },
    ritalinIR: {
        name: "Ritalin (IR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Methylphenidate immediate release clinical PK. Notorious for steep crash.",
        color: "#ff4757",
        standardDose: "10mg",
        pharma: { onset: 15, peak: 60, duration: 180, halfLife: 210, strength: 75, rebound: 25 }
    },
    concerta: {
        name: "Concerta",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "OROS pump mechanism provides ascending methylphenidate profile.",
        color: "#ff4757",
        standardDose: "36mg",
        pharma: { onset: 60, peak: 360, duration: 600, halfLife: 210, strength: 65, rebound: 15 }
    },
    focalinIR: {
        name: "Focalin (IR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Dexmethylphenidate IR. Twice as potent as racemic ritalin with cleaner curve.",
        color: "#ff4757",
        standardDose: "5mg",
        pharma: { onset: 15, peak: 60, duration: 180, halfLife: 150, strength: 80, rebound: 20 }
    },
    focalinXR: {
        name: "Focalin (XR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Bimodal dexmethylphenidate release curve.",
        color: "#ff4757",
        standardDose: "10mg",
        pharma: { onset: 30, peak: 240, duration: 480, halfLife: 150, strength: 70, rebound: 15 }
    },
    dexedrineIR: {
        name: "Dexedrine (IR)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Pure dextroamphetamine PK. Lacks physical peripheral push of levoamphetamine.",
        color: "#ff4757",
        standardDose: "10mg",
        pharma: { onset: 20, peak: 90, duration: 240, halfLife: 600, strength: 80, rebound: 20 }
    },
    dexedrineSpansule: {
        name: "Dexedrine (Spansule)",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Extended release dextroamphetamine via gradual spansule technology.",
        color: "#ff4757",
        standardDose: "15mg",
        pharma: { onset: 45, peak: 240, duration: 480, halfLife: 600, strength: 70, rebound: 15 }
    },
    modafinil: {
        name: "Modafinil",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Well-documented clinical PK for atypical DRI wakefulness promotion.",
        color: "#ff4757",
        standardDose: "200mg",
        pharma: { onset: 60, peak: 120, duration: 720, halfLife: 900, strength: 65, rebound: 10 }
    },
    armodafinil: {
        name: "Armodafinil",
        class: "Stimulant",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "R-enantiomer of modafinil resulting in a delayed secondary peak.",
        color: "#ff4757",
        standardDose: "150mg",
        pharma: { onset: 90, peak: 180, duration: 840, halfLife: 900, strength: 70, rebound: 10 }
    },
    ephedrine: {
        name: "Ephedrine",
        class: "Stimulant",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Direct acting sympathomimetic amine. Standard bronchodilator PK.",
        color: "#ff4757",
        standardDose: "25mg",
        pharma: { onset: 30, peak: 60, duration: 240, halfLife: 360, strength: 60, rebound: 20 }
    },
    pseudoephedrine: {
        name: "Pseudoephedrine",
        class: "Stimulant",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Decongestant PK. Milder CNS penetration compared to ephedrine.",
        color: "#ff4757",
        standardDose: "60mg",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 360, strength: 40, rebound: 10 }
    },
    nicotineGum: {
        name: "Nicotine (Gum)",
        class: "Stimulant",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Buccal absorption PK data bypassing first-pass metabolism.",
        color: "#ff4757",
        standardDose: "2mg",
        pharma: { onset: 5, peak: 15, duration: 45, halfLife: 120, strength: 45, rebound: 15 }
    },
    nicotinePatch: {
        name: "Nicotine (Patch)",
        class: "Stimulant",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Transdermal sustained release matrix creating long plateau.",
        color: "#ff4757",
        standardDose: "14mg",
        pharma: { onset: 60, peak: 180, duration: 960, halfLife: 120, strength: 25, rebound: 5 }
    },
    yohimbine: {
        name: "Yohimbine",
        class: "Stimulant",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Alpha-2 antagonist. Highly dependent on fasted state; high anxiogenic rebound.",
        color: "#ff4757",
        standardDose: "5mg",
        pharma: { onset: 30, peak: 60, duration: 180, halfLife: 150, strength: 60, rebound: 15 }
    },
    theacrine: {
        name: "Theacrine",
        class: "Stimulant",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Purine alkaloid related to caffeine. Extremely long half-life, minimal tolerance.",
        color: "#ff4757",
        standardDose: "100mg",
        pharma: { onset: 45, peak: 120, duration: 360, halfLife: 1200, strength: 35, rebound: 5 }
    },
    methylliberine: {
        name: "Methylliberine",
        class: "Stimulant",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Rapid-acting caffeine derivative. Fast onset, fast clearance.",
        color: "#ff4757",
        standardDose: "100mg",
        pharma: { onset: 15, peak: 30, duration: 120, halfLife: 90, strength: 45, rebound: 10 }
    },
    melatoninIR: {
        name: "Melatonin (IR)",
        class: "Depressant/Sleep",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Exogenous immediate release sleep hormone. Cleared very rapidly.",
        color: "#2f3542",
        standardDose: "3mg",
        pharma: { onset: 30, peak: 60, duration: 120, halfLife: 45, strength: 40, rebound: 0 }
    },
    melatoninXR: {
        name: "Melatonin (XR)",
        class: "Depressant/Sleep",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Biphasic release to mimic natural pineal output and prevent midnight waking.",
        color: "#2f3542",
        standardDose: "2mg",
        pharma: { onset: 60, peak: 120, duration: 360, halfLife: 45, strength: 30, rebound: 0 }
    },
    diphenhydramine: {
        name: "Diphenhydramine",
        class: "Depressant/Sleep",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "First-generation antihistamine with strong anticholinergic sedation.",
        color: "#2f3542",
        standardDose: "50mg",
        pharma: { onset: 30, peak: 120, duration: 360, halfLife: 540, strength: 60, rebound: 20 }
    },
    doxylamine: {
        name: "Doxylamine",
        class: "Depressant/Sleep",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Potent OTC sedative; notorious for next-day grogginess due to long elimination.",
        color: "#2f3542",
        standardDose: "25mg",
        pharma: { onset: 30, peak: 150, duration: 480, halfLife: 600, strength: 70, rebound: 25 }
    },
    zolpidemIR: {
        name: "Zolpidem (IR)",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Rapid-acting non-benzodiazepine Z-drug targeting GABA-A alpha-1.",
        color: "#2f3542",
        standardDose: "10mg",
        pharma: { onset: 15, peak: 60, duration: 240, halfLife: 150, strength: 85, rebound: 15 }
    },
    zolpidemCR: {
        name: "Zolpidem (CR)",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Bilayer tablet; first layer IR, second layer slow release for sleep maintenance.",
        color: "#2f3542",
        standardDose: "12.5mg",
        pharma: { onset: 30, peak: 120, duration: 420, halfLife: 168, strength: 75, rebound: 15 }
    },
    eszopiclone: {
        name: "Eszopiclone",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Z-drug with longer half-life than Ambien, better for sleep maintenance.",
        color: "#2f3542",
        standardDose: "2mg",
        pharma: { onset: 30, peak: 60, duration: 360, halfLife: 360, strength: 80, rebound: 15 }
    },
    zaleplon: {
        name: "Zaleplon",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Extremely short-acting Z-drug, used for sleep onset or middle-of-night waking.",
        color: "#2f3542",
        standardDose: "10mg",
        pharma: { onset: 15, peak: 45, duration: 180, halfLife: 60, strength: 75, rebound: 5 }
    },
    alprazolam: {
        name: "Alprazolam",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Short-acting potent triazolobenzodiazepine. High rebound anxiety.",
        color: "#2f3542",
        standardDose: "0.5mg",
        pharma: { onset: 15, peak: 60, duration: 240, halfLife: 660, strength: 90, rebound: 25 }
    },
    clonazepam: {
        name: "Clonazepam",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Long-acting benzodiazepine providing smooth sustained anxiolysis.",
        color: "#2f3542",
        standardDose: "0.5mg",
        pharma: { onset: 45, peak: 120, duration: 480, halfLife: 2000, strength: 80, rebound: 15 }
    },
    diazepam: {
        name: "Diazepam",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Very fast onset via lipophilicity; extremely long half-life active metabolites.",
        color: "#2f3542",
        standardDose: "5mg",
        pharma: { onset: 15, peak: 60, duration: 360, halfLife: 2880, strength: 75, rebound: 10 }
    },
    lorazepam: {
        name: "Lorazepam",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Intermediate-acting benzodiazepine. Does not rely on hepatic oxidation.",
        color: "#2f3542",
        standardDose: "1mg",
        pharma: { onset: 30, peak: 120, duration: 480, halfLife: 840, strength: 80, rebound: 15 }
    },
    phenibut: {
        name: "Phenibut",
        class: "Depressant/Sleep",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "GABA-B agonist. Very delayed onset and massive offset duration with severe rebound.",
        color: "#2f3542",
        standardDose: "1000mg",
        pharma: { onset: 120, peak: 300, duration: 720, halfLife: 320, strength: 70, rebound: 25 }
    },
    baclofen: {
        name: "Baclofen",
        class: "Depressant/Sleep",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "Specific GABA-B agonist muscle relaxant.",
        color: "#2f3542",
        standardDose: "10mg",
        pharma: { onset: 60, peak: 120, duration: 360, halfLife: 210, strength: 60, rebound: 10 }
    },
    gabapentin: {
        name: "Gabapentin",
        class: "Depressant/Sleep",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "Voltage-gated calcium channel blocker. Inverse absorption with escalating dose.",
        color: "#2f3542",
        standardDose: "300mg",
        pharma: { onset: 90, peak: 180, duration: 360, halfLife: 420, strength: 65, rebound: 10 }
    },
    pregabalin: {
        name: "Pregabalin",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Linear absorption alternative to gabapentin. Faster, more predictable onset.",
        color: "#2f3542",
        standardDose: "75mg",
        pharma: { onset: 45, peak: 90, duration: 480, halfLife: 390, strength: 75, rebound: 15 }
    },
    ethanol: {
        name: "Ethanol",
        class: "Depressant/Sleep",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "Zero-order elimination kinetics mathematically approximated for 2 standard drinks.",
        color: "#2f3542",
        standardDose: "2 Drinks",
        pharma: { onset: 15, peak: 45, duration: 180, halfLife: 240, strength: 70, rebound: 25 }
    },
    kava: {
        name: "Kava",
        class: "Depressant/Sleep",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Kavalactones acting on GABA-A receptors and sodium channels.",
        color: "#2f3542",
        standardDose: "500mg",
        pharma: { onset: 30, peak: 60, duration: 180, halfLife: 540, strength: 55, rebound: 5 }
    },
    valerianRoot: {
        name: "Valerian Root",
        class: "Depressant/Sleep",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Herbal GABA modulator via valerenic acid. Smooth onset.",
        color: "#2f3542",
        standardDose: "500mg",
        pharma: { onset: 45, peak: 120, duration: 240, halfLife: 240, strength: 30, rebound: 5 }
    },
    suvorexant: {
        name: "Suvorexant",
        class: "Depressant/Sleep",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "DORA (Dual Orexin Receptor Antagonist) blocking wakefulness rather than promoting GABA.",
        color: "#2f3542",
        standardDose: "10mg",
        pharma: { onset: 30, peak: 120, duration: 420, halfLife: 720, strength: 60, rebound: 10 }
    },
    alphaGPC: {
        name: "Alpha-GPC",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Highly bioavailable choline donor causing acute serum choline spike.",
        color: "#1e90ff",
        standardDose: "300mg",
        pharma: { onset: 30, peak: 60, duration: 240, halfLife: 180, strength: 40, rebound: 0 }
    },
    citicoline: {
        name: "Citicoline",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Splits into choline and uridine. Protracted half-life due to cellular integration.",
        color: "#1e90ff",
        standardDose: "250mg",
        pharma: { onset: 45, peak: 120, duration: 360, halfLife: 4200, strength: 35, rebound: 0 }
    },
    piracetam: {
        name: "Piracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Original racetam, modulates AMPA/NMDA receptor density.",
        color: "#1e90ff",
        standardDose: "1600mg",
        pharma: { onset: 45, peak: 90, duration: 300, halfLife: 300, strength: 30, rebound: 0 }
    },
    aniracetam: {
        name: "Aniracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Fat-soluble racetam with rapid AMPA modulation and very fast clearance.",
        color: "#1e90ff",
        standardDose: "750mg",
        pharma: { onset: 30, peak: 60, duration: 120, halfLife: 120, strength: 40, rebound: 5 }
    },
    oxiracetam: {
        name: "Oxiracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Stimulatory water-soluble racetam affecting cholinergic pathways.",
        color: "#1e90ff",
        standardDose: "750mg",
        pharma: { onset: 45, peak: 120, duration: 360, halfLife: 480, strength: 45, rebound: 0 }
    },
    pramiracetam: {
        name: "Pramiracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Highly lipophilic racetam, potent High-Affinity Choline Uptake (HACU) enhancer.",
        color: "#1e90ff",
        standardDose: "300mg",
        pharma: { onset: 60, peak: 120, duration: 360, halfLife: 360, strength: 55, rebound: 5 }
    },
    phenylpiracetam: {
        name: "Phenylpiracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Phenylated piracetam acting as a mild DAT inhibitor/stimulant.",
        color: "#1e90ff",
        standardDose: "100mg",
        pharma: { onset: 30, peak: 90, duration: 300, halfLife: 180, strength: 65, rebound: 10 }
    },
    fasoracetam: {
        name: "Fasoracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "mGluR agonist and GABA-B upregulator.",
        color: "#1e90ff",
        standardDose: "20mg",
        pharma: { onset: 30, peak: 60, duration: 240, halfLife: 240, strength: 40, rebound: 0 }
    },
    noopept: {
        name: "Noopept",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Cycloprolylglycine prodrug. Massive acute NGF/BDNF spike but fast hepatic clearance.",
        color: "#1e90ff",
        standardDose: "10mg",
        pharma: { onset: 15, peak: 30, duration: 120, halfLife: 60, strength: 50, rebound: 5 }
    },
    centrophenoxine: {
        name: "Centrophenoxine",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Cholinergic and lipofuscin clearer. Rapidly hydrolyzes into DMAE.",
        color: "#1e90ff",
        standardDose: "250mg",
        pharma: { onset: 45, peak: 90, duration: 240, halfLife: 150, strength: 40, rebound: 0 }
    },
    huperzineA: {
        name: "Huperzine A",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Potent reversible acetylcholinesterase inhibitor (AChEI). Very long half-life.",
        color: "#1e90ff",
        standardDose: "200mcg",
        pharma: { onset: 60, peak: 120, duration: 480, halfLife: 840, strength: 50, rebound: 5 }
    },
    vinpocetine: {
        name: "Vinpocetine",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Cerebral vasodilator improving acute cerebral blood flow.",
        color: "#1e90ff",
        standardDose: "10mg",
        pharma: { onset: 30, peak: 90, duration: 180, halfLife: 90, strength: 35, rebound: 0 }
    },
    bacopaMonnieri: {
        name: "Bacopa Monnieri",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Mostly chronic effects via bacosides, but mild acute serotonergic onset.",
        color: "#1e90ff",
        standardDose: "300mg",
        pharma: { onset: 90, peak: 240, duration: 480, halfLife: 900, strength: 25, rebound: 0 }
    },
    ginkgoBiloba: {
        name: "Ginkgo Biloba",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Enhances cerebral blood flow; mild acute cognitive/sensory lift.",
        color: "#1e90ff",
        standardDose: "120mg",
        pharma: { onset: 60, peak: 120, duration: 240, halfLife: 270, strength: 20, rebound: 0 }
    },
    uridineMonophosphate: {
        name: "Uridine Monophosphate",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Dopamine modulator and cell membrane synthesis component.",
        color: "#1e90ff",
        standardDose: "250mg",
        pharma: { onset: 45, peak: 120, duration: 360, halfLife: 300, strength: 30, rebound: 0 }
    },
    prl853: {
        name: "PRL-8-53",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Experimental memory enhancer. Educated guess based on anecdotal timeline.",
        color: "#1e90ff",
        standardDose: "5mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 300, strength: 45, rebound: 5 }
    },
    coluracetam: {
        name: "Coluracetam",
        class: "Nootropic",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Potent HACU enhancer known for sensory and optic enhancement.",
        color: "#1e90ff",
        standardDose: "10mg",
        pharma: { onset: 30, peak: 60, duration: 180, halfLife: 180, strength: 40, rebound: 0 }
    },
    ashwagandhaKsm66: {
        name: "Ashwagandha (KSM-66)",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Root extract. Cortisol modulator; PK based on withanolide acute effects.",
        color: "#2ed573",
        standardDose: "300mg",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 240, strength: 30, rebound: 0 }
    },
    ashwagandhaSensoril: {
        name: "Ashwagandha (Sensoril)",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Root/leaf extract. Higher withanolide percentage, more acutely sedating.",
        color: "#2ed573",
        standardDose: "250mg",
        pharma: { onset: 60, peak: 180, duration: 480, halfLife: 240, strength: 35, rebound: 0 }
    },
    rhodiolaRosea: {
        name: "Rhodiola Rosea",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "3% Rosavins. MAO inhibitor properties yield acute stimulatory adaptogenesis.",
        color: "#2ed573",
        standardDose: "300mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 240, strength: 40, rebound: 0 }
    },
    rhodiolaSalidroside: {
        name: "Rhodiola (Salidroside)",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Isolated salidroside provides sharper, faster acute stimulation.",
        color: "#2ed573",
        standardDose: "200mg",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 180, strength: 45, rebound: 0 }
    },
    panaxGinseng: {
        name: "Panax Ginseng",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Ginsenoside pharmacodynamics. Modulates NO and provides steady CNS boost.",
        color: "#2ed573",
        standardDose: "200mg",
        pharma: { onset: 60, peak: 120, duration: 360, halfLife: 840, strength: 35, rebound: 0 }
    },
    eleuthero: {
        name: "Eleuthero",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Siberian Ginseng. Eleutherosides prevent stress-induced catecholamine depletion.",
        color: "#2ed573",
        standardDose: "500mg",
        pharma: { onset: 60, peak: 120, duration: 360, halfLife: 300, strength: 30, rebound: 0 }
    },
    schisandra: {
        name: "Schisandra",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Lignans. Mild CNS stimulant and hepatic phase 1/2 enzyme modulator.",
        color: "#2ed573",
        standardDose: "500mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 240, strength: 25, rebound: 0 }
    },
    cordyceps: {
        name: "Cordyceps",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Cordycepin enhances cellular ATP production and oxygen utilization.",
        color: "#2ed573",
        standardDose: "1g",
        pharma: { onset: 60, peak: 120, duration: 300, halfLife: 240, strength: 35, rebound: 0 }
    },
    lionsMane: {
        name: "Lion's Mane",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Hericenones acute NGF modulation timeline. Subjective mild clarity.",
        color: "#2ed573",
        standardDose: "1g",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 360, strength: 20, rebound: 0 }
    },
    maca: {
        name: "Maca Root",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Peruvian adaptogen. Mechanism debated; subjective stimulatory and libido duration.",
        color: "#2ed573",
        standardDose: "5g",
        pharma: { onset: 45, peak: 120, duration: 240, halfLife: 180, strength: 25, rebound: 0 }
    },
    shilajit: {
        name: "Shilajit",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Fulvic acid complex. Enhances mitochondrial transport. Slow absorption.",
        color: "#2ed573",
        standardDose: "250mg",
        pharma: { onset: 60, peak: 180, duration: 480, halfLife: 720, strength: 20, rebound: 0 }
    },
    holyBasil: {
        name: "Holy Basil",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Tulsi (Ursolic acid). Limits cortisol spikes yielding acute calming effect.",
        color: "#2ed573",
        standardDose: "500mg",
        pharma: { onset: 45, peak: 120, duration: 240, halfLife: 180, strength: 25, rebound: 0 }
    },
    tongkatAli: {
        name: "Tongkat Ali",
        class: "Adaptogen",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Eurycomanone frees bound testosterone; acts as long-lasting vitality baseline shift.",
        color: "#2ed573",
        standardDose: "200mg",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 1440, strength: 30, rebound: 0 }
    },
    psilocybinMicro: {
        name: "Psilocybin (Microdose)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Psilocin PK based on sub-perceptual clinical trials. 5-HT2A partial agonism.",
        color: "#9b59b6",
        standardDose: "100mg",
        pharma: { onset: 45, peak: 90, duration: 240, halfLife: 180, strength: 35, rebound: 0 }
    },
    lsdMicro: {
        name: "LSD (Microdose)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Lysergic acid diethylamide sub-perceptual receptor binding. Dopaminergic trapping.",
        color: "#9b59b6",
        standardDose: "10mcg",
        pharma: { onset: 60, peak: 180, duration: 600, halfLife: 300, strength: 40, rebound: 0 }
    },
    ketamineTroche: {
        name: "Ketamine (Troche)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Sublingual/Oral absorption, heavy first-pass metabolism to norketamine.",
        color: "#9b59b6",
        standardDose: "50mg",
        pharma: { onset: 20, peak: 60, duration: 120, halfLife: 180, strength: 65, rebound: 10 }
    },
    esketamineNasal: {
        name: "Esketamine (Nasal)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "S-enantiomer nasal spray PK (Spravato). Extremely fast NMDA blockade.",
        color: "#9b59b6",
        standardDose: "56mg",
        pharma: { onset: 10, peak: 30, duration: 60, halfLife: 180, strength: 80, rebound: 10 }
    },
    mdma: {
        name: "MDMA",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "MAPS protocol PK for PTSD treatment. Massive serotonin/oxytocin efflux.",
        color: "#9b59b6",
        standardDose: "120mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 480, strength: 90, rebound: 30 }
    },
    thcInhaled: {
        name: "Cannabis (Inhaled THC)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Pulmonary absorption of delta-9-THC bypasses the liver completely.",
        color: "#9b59b6",
        standardDose: "10mg",
        pharma: { onset: 5, peak: 15, duration: 120, halfLife: 1800, strength: 65, rebound: 10 }
    },
    thcEdible: {
        name: "Cannabis (Edible THC)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Controlled",
        dataConfidence: "High",
        dataNote: "Hepatic first-pass metabolism converts THC to highly potent 11-OH-THC.",
        color: "#9b59b6",
        standardDose: "10mg",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 1800, strength: 75, rebound: 15 }
    },
    cbdOral: {
        name: "CBD (Oral)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Cannabidiol liquid/capsule PK. Modulates FAAH and CB1 allosterically.",
        color: "#9b59b6",
        standardDose: "25mg",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 1080, strength: 25, rebound: 0 }
    },
    kratomRed: {
        name: "Kratom (Red Vein)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Atypical opioid agonist. Mitragynine with higher 7-OH ratio (more sedating).",
        color: "#9b59b6",
        standardDose: "4g",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 1440, strength: 60, rebound: 15 }
    },
    kratomWhite: {
        name: "Kratom (White Vein)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Mitragynine dominant profile causing adrenergic stimulation over sedation.",
        color: "#9b59b6",
        standardDose: "2.5g",
        pharma: { onset: 20, peak: 60, duration: 210, halfLife: 1440, strength: 65, rebound: 10 }
    },
    kratomGreen: {
        name: "Kratom (Green Vein)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Balanced alkaloid profile providing both mood lift and mild analgesia.",
        color: "#9b59b6",
        standardDose: "3g",
        pharma: { onset: 25, peak: 75, duration: 240, halfLife: 1440, strength: 60, rebound: 10 }
    },
    dxmLow: {
        name: "DXM (Low Dose)",
        class: "Psychedelic/Atypical",
        regulatoryStatus: "OTC",
        dataConfidence: "High",
        dataNote: "First plateau dose dextromethorphan. Functions as SNRI and mild NMDA antagonist.",
        color: "#9b59b6",
        standardDose: "90mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 240, strength: 50, rebound: 5 }
    },
    magnesiumThreonate: {
        name: "Magnesium Threonate",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "Medium",
        dataNote: "Chelate explicitly designed to cross blood-brain barrier for NMDA modulation.",
        color: "#ffa502",
        standardDose: "144mg",
        pharma: { onset: 60, peak: 180, duration: 360, halfLife: 1200, strength: 25, rebound: 0 }
    },
    magnesiumGlycinate: {
        name: "Magnesium Glycinate",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Highly bioavailable systemic Mg chelated with inhibitory amino acid glycine.",
        color: "#ffa502",
        standardDose: "200mg",
        pharma: { onset: 45, peak: 120, duration: 300, halfLife: 1200, strength: 30, rebound: 0 }
    },
    zincPicolinate: {
        name: "Zinc Picolinate",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Trace mineral critical for hormone synthesis. Very slow clearance.",
        color: "#ffa502",
        standardDose: "22mg",
        pharma: { onset: 60, peak: 180, duration: 480, halfLife: 2400, strength: 15, rebound: 0 }
    },
    sodiumChloride: {
        name: "Sodium Chloride",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Acute plasma volume expansion, stabilizing sympathetic tone.",
        color: "#ffa502",
        standardDose: "1000mg",
        pharma: { onset: 15, peak: 45, duration: 180, halfLife: 300, strength: 25, rebound: 0 }
    },
    potassiumChloride: {
        name: "Potassium Chloride",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Cellular repolarization agent essential for nerve function.",
        color: "#ffa502",
        standardDose: "500mg",
        pharma: { onset: 30, peak: 60, duration: 240, halfLife: 300, strength: 20, rebound: 0 }
    },
    lithiumOrotate: {
        name: "Lithium Orotate",
        class: "Mineral/Electrolyte",
        regulatoryStatus: "Supplement",
        dataConfidence: "Estimated",
        dataNote: "Microdosed trace mineral action on GSK-3B. Different PK than Rx carbonate.",
        color: "#ffa502",
        standardDose: "5mg",
        pharma: { onset: 60, peak: 240, duration: 720, halfLife: 1440, strength: 20, rebound: 0 }
    },
    lTheanine: {
        name: "L-Theanine",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Amino acid promoting alpha brain waves and dampening glutamatergic storms.",
        color: "#eccc68",
        standardDose: "200mg",
        pharma: { onset: 30, peak: 60, duration: 240, halfLife: 240, strength: 35, rebound: 0 }
    },
    lTyrosine: {
        name: "L-Tyrosine",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Dopamine precursor amino acid. Competes at BBB.",
        color: "#eccc68",
        standardDose: "1000mg",
        pharma: { onset: 30, peak: 60, duration: 180, halfLife: 150, strength: 30, rebound: 0 }
    },
    nAcetylCysteine: {
        name: "N-Acetyl Cysteine",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Glutathione precursor and extracellular glutamate modulator.",
        color: "#eccc68",
        standardDose: "1000mg",
        pharma: { onset: 45, peak: 120, duration: 360, halfLife: 336, strength: 25, rebound: 0 }
    },
    alcar: {
        name: "ALCAR",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Cross-BBB mitochondrial transport agent donating acetyl groups.",
        color: "#eccc68",
        standardDose: "500mg",
        pharma: { onset: 45, peak: 180, duration: 360, halfLife: 240, strength: 35, rebound: 0 }
    },
    lTryptophan: {
        name: "L-Tryptophan",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Rate-limited Serotonin/Melatonin precursor amino acid.",
        color: "#eccc68",
        standardDose: "1000mg",
        pharma: { onset: 60, peak: 120, duration: 300, halfLife: 150, strength: 25, rebound: 0 }
    },
    fiveHtp: {
        name: "5-HTP",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Direct serotonin precursor (bypasses rate limiting tryptophan hydroxylase).",
        color: "#eccc68",
        standardDose: "100mg",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 240, strength: 40, rebound: 5 }
    },
    taurine: {
        name: "Taurine",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Organic osmolyte and GABA-A partial agonist preventing neuronal excitotoxicity.",
        color: "#eccc68",
        standardDose: "1000mg",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 600, strength: 25, rebound: 0 }
    },
    creatineMonohydrate: {
        name: "Creatine Monohydrate",
        class: "Vitamin/Amino",
        regulatoryStatus: "Supplement",
        dataConfidence: "High",
        dataNote: "Cellular ATP buffer. Mostly chronic saturation, but minor acute cognitive effect.",
        color: "#eccc68",
        standardDose: "5g",
        pharma: { onset: 60, peak: 120, duration: 240, halfLife: 180, strength: 15, rebound: 0 }
    },
    escitalopram: {
        name: "Escitalopram",
        class: "Psychiatric/Other",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "Highly selective SSRI. Math curve represents acute blood plasma, not long-term shift.",
        color: "#747d8c",
        standardDose: "10mg",
        pharma: { onset: 120, peak: 300, duration: 1440, halfLife: 1800, strength: 40, rebound: 0 }
    },
    fluoxetine: {
        name: "Fluoxetine",
        class: "Psychiatric/Other",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "Activating SSRI with an extremely long-lived active metabolite (norfluoxetine).",
        color: "#747d8c",
        standardDose: "20mg",
        pharma: { onset: 240, peak: 480, duration: 2880, halfLife: 5760, strength: 35, rebound: 0 }
    },
    bupropionXL: {
        name: "Bupropion (XL)",
        class: "Psychiatric/Other",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "NDRI anti-depressant, 24-hour extended matrix to prevent seizure risk peaks.",
        color: "#747d8c",
        standardDose: "150mg",
        pharma: { onset: 120, peak: 300, duration: 1440, halfLife: 1260, strength: 50, rebound: 5 }
    },
    propranolol: {
        name: "Propranolol",
        class: "Psychiatric/Other",
        regulatoryStatus: "Rx",
        dataConfidence: "High",
        dataNote: "Lipophilic non-selective beta blocker, eliminates physical performance anxiety.",
        color: "#747d8c",
        standardDose: "10mg",
        pharma: { onset: 30, peak: 90, duration: 240, halfLife: 240, strength: 50, rebound: 5 }
    },
};

// ============================================
// DYNAMIC SUBSTANCE RESOLUTION
// ============================================

export function getActiveSubstances() {
    const active: any = {};
    for (const [key, s] of Object.entries(SUBSTANCE_DB)) {
        const status = (s.regulatoryStatus || '').toLowerCase();
        // Supplement and OTC are always allowed
        if (status === 'supplement' || status === 'otc') {
            active[key] = s;
        } else if (status === 'rx' && AppState.includeRx) {
            active[key] = s;
        } else if (status === 'controlled' && AppState.includeControlled) {
            active[key] = s;
        }
    }
    return active;
}

export function resolveSubstance(key: any, item: any) {
    const active = getActiveSubstances();
    if (active[key]) return active[key];
    // Also check the full DB (substance may exist but be filtered out by toggles)
    if (SUBSTANCE_DB[key]) return SUBSTANCE_DB[key];

    // Dynamic entry for substances the LLM returns that aren't in our database
    const cls = item.class || 'unknown';
    const clsColor = CLASS_COLORS[cls] || CLASS_COLORS.unknown;
    const dynamicEntry = {
        name: item.name || key.charAt(0).toUpperCase() + key.slice(1),
        class: cls,
        regulatoryStatus: item.regulatoryStatus || 'Supplement',
        color: item.color || clsColor.fill,
        standardDose: item.standardDose || item.dose || '',
        dataConfidence: 'Estimated',
        dataNote: 'Dynamically registered substance — not in database.',
        pharma: item.pharma || { onset: 30, peak: 60, duration: 240, halfLife: 120, strength: 40, rebound: 0 },
    };
    // Cache it so tooltips and labels work
    SUBSTANCE_DB[key] = dynamicEntry;
    return dynamicEntry;
}

export function guessDose(substance: any) {
    // Prefer the standardDose from the new database
    if (substance.standardDose) return substance.standardDose;
    const doses: any = {
        caffeine: '200mg', theanine: '400mg', rhodiola: '500mg', ashwagandha: '600mg',
        tyrosine: '1000mg', citicoline: '500mg', alphaGPC: '600mg', lionsMane: '1000mg',
        magnesium: '400mg', creatine: '5g', nac: '600mg', glycine: '3g',
        melatonin: '3mg', gaba: '750mg', apigenin: '50mg', taurine: '2g',
    };
    return doses[substance.name?.toLowerCase()] || doses[Object.keys(doses).find((k: any) =>
        substance.name?.toLowerCase().includes(k))] || '500mg';
}
