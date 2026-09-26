import type {
  EquipmentCardProps,
  FarmCardProps,
  SpeciesCardProps,
} from '../components/molecules/relief/resource-props';

// Local display fixtures only. #59 remains open; these are not shared entities,
// registered farms, approved risk rules, or a Farm/Plot/ENS mapping.
export const resourcePreviewNotice = 'Synthetic preview · example farm, species and equipment records.';

const farm: FarmCardProps = {
  name: 'Example scallop farm',
  nameJa: 'ホタテ養殖場（サンプル）',
  state: 'ready',
  locationLabel: 'Example coastal site · Japan',
  speciesLabels: ['Scallop · ホタテ'],
  equipmentLabels: ['Suspended culture lines'],
  mappingLabel: 'Example plot reference · unverified',
  explanation: 'This example does not identify a registered farm or beneficiary.',
};

export const farmPreviews = {
  ready: farm,
  unmapped: {
    ...farm,
    mappingLabel: 'No plot mapping available',
    explanation: 'The farm remains in the list. Its boundary and payout mapping have not been supplied.',
  },
  missingDetails: {
    ...farm,
    speciesLabels: [],
    equipmentLabels: [],
    explanation: 'Species and equipment have not been listed for this example farm.',
  },
  loading: {
    ...farm,
    name: 'Loading farms',
    nameJa: '養殖場',
    state: 'loading',
    explanation: 'Loading the farm list and its linked species and equipment.',
  },
  empty: {
    ...farm,
    name: 'Farm list',
    nameJa: '養殖場',
    state: 'empty',
    explanation: 'No farms have been added to this example account.',
  },
  unavailable: {
    ...farm,
    name: 'Farm list',
    nameJa: '養殖場',
    state: 'unavailable',
    explanation: 'Farm details could not be loaded. Try again when the service is available.',
  },
} satisfies Record<string, FarmCardProps>;

const species: SpeciesCardProps = {
  name: 'Scallop',
  nameJa: 'ホタテ',
  state: 'ready',
  categoryLabel: 'Shellfish',
  riskLabels: ['Heat stress', 'Harmful algal blooms'],
  thresholdLabel: 'No reviewed thresholds available',
  explanation: 'Example monitoring context only. No threshold or relief decision is configured in this preview.',
};

export const speciesPreviews = {
  ready: species,
  missingDetails: {
    ...species,
    riskLabels: [],
    explanation: 'Risk information has not been supplied. Missing rules do not imply that this species has no risk.',
  },
  loading: {
    ...species,
    name: 'Loading species',
    nameJa: '養殖種',
    state: 'loading',
    explanation: 'Loading species and monitoring information.',
  },
  empty: {
    ...species,
    name: 'Species list',
    nameJa: '養殖種',
    state: 'empty',
    explanation: 'No species have been listed for this example farm.',
  },
  unavailable: {
    ...species,
    name: 'Species list',
    nameJa: '養殖種',
    state: 'unavailable',
    explanation: 'Species information could not be loaded. No thresholds can be shown.',
  },
} satisfies Record<string, SpeciesCardProps>;

const equipment: EquipmentCardProps = {
  name: 'Suspended culture lines',
  nameJa: '垂下式養殖設備',
  state: 'ready',
  typeLabel: 'Longline equipment',
  description: 'Lines supporting suspended shellfish culture.',
  farmLabels: ['Example scallop farm'],
  explanation: 'Example equipment description. No storm tolerance or payout rule is implied.',
};

export const equipmentPreviews = {
  ready: equipment,
  missingFarm: {
    ...equipment,
    farmLabels: [],
    explanation: 'This example equipment has no farm association yet.',
  },
  loading: {
    ...equipment,
    name: 'Loading equipment',
    nameJa: '養殖設備',
    state: 'loading',
    explanation: 'Loading equipment descriptions and farm associations.',
  },
  empty: {
    ...equipment,
    name: 'Equipment list',
    nameJa: '養殖設備',
    state: 'empty',
    explanation: 'No equipment has been listed for this example farm.',
  },
  unavailable: {
    ...equipment,
    name: 'Equipment list',
    nameJa: '養殖設備',
    state: 'unavailable',
    explanation: 'Equipment information could not be loaded. Its farm associations are unavailable.',
  },
} satisfies Record<string, EquipmentCardProps>;
