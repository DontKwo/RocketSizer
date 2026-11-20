export type ProvenanceStatus =
  | "primary_source"
  | "derived"
  | "estimated"
  | "nominal_placeholder";

export interface Citation {
  document_title: string;
  author?: string;
  publisher?: string;
  publication_year?: number;
  page_number?: number;
  table_or_figure?: string;
  direct_url?: string;
  document_id?: string;
  excerpt?: string;
}

export interface Derivation {
  governing_equation: string;
  input_parameters: Record<string, string | number>;
  assumptions: string[];
  solver_method: string;
  confidence_rating: "high" | "medium" | "low" | string;
}

export interface ProvenanceValue<T> {
  value: T;
  canonical_unit: string;
  status: ProvenanceStatus;
  citation?: Citation | null;
  derivation?: Derivation | null;
  notes?: string | null;
}

export interface InspectorTarget {
  entityName: string;
  fieldLabel: string;
  fieldKey: string;
  provenance: ProvenanceValue<unknown>;
}
