use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceStatus {
    PrimarySource,
    Derived,
    Estimated,
    NominalPlaceholder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub document_title: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub publication_year: Option<u16>,
    pub page_number: Option<u16>,
    pub table_or_figure: Option<String>,
    pub direct_url: Option<String>,
    pub document_id: Option<String>,
    pub excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Derivation {
    pub governing_equation: String,
    pub input_parameters: HashMap<String, String>,
    pub assumptions: Vec<String>,
    pub solver_method: String,
    pub confidence_rating: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceValue<T> {
    pub value: T,
    pub canonical_unit: String,
    pub status: ProvenanceStatus,
    pub citation: Option<Citation>,
    pub derivation: Option<Derivation>,
    pub notes: Option<String>,
}

impl<T> ProvenanceValue<T> {
    pub fn primary(value: T, unit: &str, citation: Citation, notes: Option<&str>) -> Self {
        Self {
            value,
            canonical_unit: unit.to_string(),
            status: ProvenanceStatus::PrimarySource,
            citation: Some(citation),
            derivation: None,
            notes: notes.map(ToString::to_string),
        }
    }

    pub fn derived(value: T, unit: &str, derivation: Derivation, notes: Option<&str>) -> Self {
        Self {
            value,
            canonical_unit: unit.to_string(),
            status: ProvenanceStatus::Derived,
            citation: None,
            derivation: Some(derivation),
            notes: notes.map(ToString::to_string),
        }
    }

    pub fn estimated(value: T, unit: &str, derivation: Derivation, notes: Option<&str>) -> Self {
        Self {
            value,
            canonical_unit: unit.to_string(),
            status: ProvenanceStatus::Estimated,
            citation: None,
            derivation: Some(derivation),
            notes: notes.map(ToString::to_string),
        }
    }
}
