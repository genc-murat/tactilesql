use crate::data_transfer::models::DataTransferPlanRequest;
use crate::data_transfer::sink::DataTransferSinkType;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferPlanStep {
    pub step_key: String,
    pub source_table: String,
    pub target_table: String,
    pub mode: String,
    #[serde(default)]
    pub key_columns: Vec<String>,
    #[serde(default)]
    pub sink_type: DataTransferSinkType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sink_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTransferExecutionPlan {
    pub steps: Vec<DataTransferPlanStep>,
}

pub fn build_execution_plan(request: &DataTransferPlanRequest) -> Result<DataTransferExecutionPlan, String> {
    request.validate()?;

    let steps = request
        .objects
        .iter()
        .enumerate()
        .map(|(index, object)| DataTransferPlanStep {
            step_key: format!("step_{}", index + 1),
            source_table: object.normalized_source_table(),
            target_table: object.normalized_target_table(),
            mode: format!("{:?}", object.mode).to_ascii_lowercase(),
            key_columns: object.normalized_key_columns(),
            sink_type: object.sink_type.clone(),
            sink_path: object.normalized_sink_path(),
        })
        .collect::<Vec<_>>();

    Ok(DataTransferExecutionPlan { steps })
}
