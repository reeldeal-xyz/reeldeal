/** Frontend display props. The reviewed #59 domain contract supplies these later. */
export type ResourceCardState = 'ready' | 'loading' | 'empty' | 'unavailable';

interface ResourceCardPresentation {
  name: string;
  nameJa?: string;
  state: ResourceCardState;
  explanation: string;
}

export interface FarmCardProps extends ResourceCardPresentation {
  locationLabel: string;
  speciesLabels: readonly string[];
  equipmentLabels: readonly string[];
  mappingLabel: string;
}

export interface SpeciesCardProps extends ResourceCardPresentation {
  categoryLabel: string;
  riskLabels: readonly string[];
  thresholdLabel: string;
}

export interface EquipmentCardProps extends ResourceCardPresentation {
  typeLabel: string;
  description: string;
  farmLabels: readonly string[];
}
