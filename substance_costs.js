/**
 * Substance Cost Database
 * Estimated market prices per standard dose in USD (2025).
 * 
 * Sources:
 * - Pharmaceutical prices based on generic cash prices (GoodRx average).
 * - Supplement prices based on bulk powder/capsule averages from major retailers.
 * - Controlled substance prices based on street/darknet market averages or clinic costs where applicable.
 */

const SUBSTANCE_COSTS = {
    // Stimulants
    caffeineIR: { cost: 0.05, currency: "USD" },
    caffeineXR: { cost: 0.15, currency: "USD" },
    adderallIR: { cost: 5.00, currency: "USD" },
    adderallXR: { cost: 6.00, currency: "USD" },
    vyvanse: { cost: 8.00, currency: "USD" },
    ritalinIR: { cost: 1.00, currency: "USD" },
    concerta: { cost: 4.00, currency: "USD" },
    focalinIR: { cost: 1.50, currency: "USD" },
    focalinXR: { cost: 4.00, currency: "USD" },
    dexedrineIR: { cost: 2.00, currency: "USD" },
    dexedrineSpansule: { cost: 4.00, currency: "USD" },
    modafinil: { cost: 1.50, currency: "USD" },
    armodafinil: { cost: 2.00, currency: "USD" },
    ephedrine: { cost: 0.40, currency: "USD" },
    pseudoephedrine: { cost: 0.50, currency: "USD" },
    nicotineGum: { cost: 0.30, currency: "USD" },
    nicotinePatch: { cost: 2.00, currency: "USD" },
    yohimbine: { cost: 0.20, currency: "USD" },
    theacrine: { cost: 0.60, currency: "USD" },
    methylliberine: { cost: 0.70, currency: "USD" },

    // Depressants / Sleep
    melatoninIR: { cost: 0.10, currency: "USD" },
    melatoninXR: { cost: 0.20, currency: "USD" },
    diphenhydramine: { cost: 0.10, currency: "USD" },
    doxylamine: { cost: 0.15, currency: "USD" },
    zolpidemIR: { cost: 1.00, currency: "USD" },
    zolpidemCR: { cost: 3.00, currency: "USD" },
    eszopiclone: { cost: 2.50, currency: "USD" },
    zaleplon: { cost: 1.50, currency: "USD" },
    alprazolam: { cost: 1.00, currency: "USD" },
    clonazepam: { cost: 0.80, currency: "USD" },
    diazepam: { cost: 0.50, currency: "USD" },
    lorazepam: { cost: 0.80, currency: "USD" },
    phenibut: { cost: 0.50, currency: "USD" },
    baclofen: { cost: 0.60, currency: "USD" },
    gabapentin: { cost: 0.80, currency: "USD" },
    pregabalin: { cost: 1.50, currency: "USD" },
    ethanol: { cost: 2.50, currency: "USD" },
    kava: { cost: 1.00, currency: "USD" },
    valerianRoot: { cost: 0.30, currency: "USD" },
    suvorexant: { cost: 6.00, currency: "USD" },

    // Nootropics
    alphaGPC: { cost: 0.50, currency: "USD" },
    citicoline: { cost: 0.60, currency: "USD" },
    piracetam: { cost: 0.40, currency: "USD" },
    aniracetam: { cost: 0.50, currency: "USD" },
    oxiracetam: { cost: 0.60, currency: "USD" },
    pramiracetam: { cost: 0.80, currency: "USD" },
    phenylpiracetam: { cost: 1.00, currency: "USD" },
    fasoracetam: { cost: 1.20, currency: "USD" },
    noopept: { cost: 0.20, currency: "USD" },
    centrophenoxine: { cost: 0.50, currency: "USD" },
    huperzineA: { cost: 0.30, currency: "USD" },
    vinpocetine: { cost: 0.20, currency: "USD" },
    bacopaMonnieri: { cost: 0.30, currency: "USD" },
    ginkgoBiloba: { cost: 0.20, currency: "USD" },
    uridineMonophosphate: { cost: 0.40, currency: "USD" },
    prl853: { cost: 1.50, currency: "USD" },
    coluracetam: { cost: 1.00, currency: "USD" },

    // Adaptogens
    ashwagandhaKsm66: { cost: 0.30, currency: "USD" },
    ashwagandhaSensoril: { cost: 0.35, currency: "USD" },
    rhodiolaRosea: { cost: 0.40, currency: "USD" },
    rhodiolaSalidroside: { cost: 0.50, currency: "USD" },
    panaxGinseng: { cost: 0.40, currency: "USD" },
    eleuthero: { cost: 0.30, currency: "USD" },
    schisandra: { cost: 0.35, currency: "USD" },
    cordyceps: { cost: 0.50, currency: "USD" },
    lionsMane: { cost: 0.60, currency: "USD" },
    maca: { cost: 0.25, currency: "USD" },
    shilajit: { cost: 0.70, currency: "USD" },
    holyBasil: { cost: 0.30, currency: "USD" },
    tongkatAli: { cost: 0.60, currency: "USD" },

    // Psychedelics / Atypical
    psilocybinMicro: { cost: 2.00, currency: "USD" },
    lsdMicro: { cost: 1.50, currency: "USD" },
    ketamineTroche: { cost: 5.00, currency: "USD" },
    esketamineNasal: { cost: 45.00, currency: "USD" },
    mdma: { cost: 15.00, currency: "USD" },
    thcInhaled: { cost: 2.00, currency: "USD" },
    thcEdible: { cost: 3.00, currency: "USD" },
    cbdOral: { cost: 1.00, currency: "USD" },
    kratomRed: { cost: 0.50, currency: "USD" },
    kratomWhite: { cost: 0.50, currency: "USD" },
    kratomGreen: { cost: 0.50, currency: "USD" },
    dxmLow: { cost: 0.50, currency: "USD" },

    // Minerals / Electrolytes
    magnesiumThreonate: { cost: 0.60, currency: "USD" },
    magnesiumGlycinate: { cost: 0.20, currency: "USD" },
    zincPicolinate: { cost: 0.15, currency: "USD" },
    sodiumChloride: { cost: 0.05, currency: "USD" },
    potassiumChloride: { cost: 0.05, currency: "USD" },
    lithiumOrotate: { cost: 0.20, currency: "USD" },

    // Vitamins / Aminos
    lTheanine: { cost: 0.15, currency: "USD" },
    lTyrosine: { cost: 0.20, currency: "USD" },
    nAcetylCysteine: { cost: 0.25, currency: "USD" },
    alcar: { cost: 0.30, currency: "USD" },
    lTryptophan: { cost: 0.25, currency: "USD" },
    fiveHtp: { cost: 0.30, currency: "USD" },
    taurine: { cost: 0.15, currency: "USD" },
    creatineMonohydrate: { cost: 0.20, currency: "USD" },

    // Psychiatric / Other
    escitalopram: { cost: 0.50, currency: "USD" },
    fluoxetine: { cost: 0.40, currency: "USD" },
    bupropionXL: { cost: 0.60, currency: "USD" },
    propranolol: { cost: 0.30, currency: "USD" }
};
