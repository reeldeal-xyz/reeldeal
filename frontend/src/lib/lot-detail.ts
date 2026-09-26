export type Detail = {
  listing?: { id: string; status: string; price_jpy: number } | null;
  lot: { id: string; species_label: string | null; weight_g: number | null; price_jpy: number; status: string; gate_reason: string | null };
  effective_facts: { species_label: string | null; species_confirmed_by: string | null; length_mm: number | null; weight_g: number | null; human_corrected: boolean };
  observation: { length_mm: number | null; captured_at: string; image_ref: string };
  typed_decision: {
    kind: 'choice' | 'score' | 'noul'; choice: string | null; score: number | null;
    noul_value: boolean | null; confidence: number; confidence_source: string;
    model: { id: string; version: string; sha256?: string | null };
  };
  corrections: Array<{ field: string; model_value: unknown; human_value: unknown; actor_id: string }>;
  audit: Array<{ entity_type: string; actor_kind: string; actor_id: string; from_status: string | null; to_status: string | null; at: string; payload?: unknown }>;
  gate: { route: string; reason: string };
};
