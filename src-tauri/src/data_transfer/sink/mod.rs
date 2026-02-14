use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DataTransferSinkType {
    #[default]
    Database,
    Csv,
    Jsonl,
    Sql,
}

impl DataTransferSinkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DataTransferSinkType::Database => "database",
            DataTransferSinkType::Csv => "csv",
            DataTransferSinkType::Jsonl => "jsonl",
            DataTransferSinkType::Sql => "sql",
        }
    }
}

pub fn is_sink_supported(sink_type: &DataTransferSinkType) -> bool {
    matches!(
        sink_type,
        DataTransferSinkType::Database
            | DataTransferSinkType::Csv
            | DataTransferSinkType::Jsonl
            | DataTransferSinkType::Sql
    )
}
