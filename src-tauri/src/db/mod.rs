// =====================================================
// DATABASE DISPATCHER MODULE
// Routes database operations to MySQL or PostgreSQL modules
// =====================================================

mod crypto;
pub mod data_compare;
pub mod data_transfer;
mod helpers;
pub mod lock_analysis;
pub mod mock_jobs;
pub mod sql_utils;

// Re-export submodule functions

pub use crypto::initialize_key;
pub use crate::db_types::*;
pub use data_compare::*;
pub use data_transfer::*;
pub use mock_jobs::*;

pub mod connections;
pub use connections::*;

pub mod diagnostics;
pub use diagnostics::*;

pub mod query_execution;
pub use query_execution::*;










// =====================================================


// =====================================================
// TAURI COMMANDS - QUERY EXECUTION
// =====================================================



// =====================================================
// TAURI COMMANDS - DATABASE/TABLE OPERATIONS
// =====================================================


pub mod metadata;
pub use metadata::*;

pub mod objects;
pub use objects::*;

pub mod users;
pub use users::*;

pub mod schema_compare;
pub use schema_compare::*;

