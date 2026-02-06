use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMappingRule {
    pub source_column: String,
    pub target_column: String,
    pub cast_type: Option<String>,
}

pub fn validate_mapping_rules(rules: &[ColumnMappingRule]) -> Result<(), String> {
    for (index, rule) in rules.iter().enumerate() {
        if rule.source_column.trim().is_empty() {
            return Err(format!("Mapping rule {} has an empty sourceColumn", index + 1));
        }
        if rule.target_column.trim().is_empty() {
            return Err(format!("Mapping rule {} has an empty targetColumn", index + 1));
        }
    }
    Ok(())
}
