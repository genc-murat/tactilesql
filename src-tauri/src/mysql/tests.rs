use super::*;

#[test]
fn parse_mysql_query_cost_reads_nested_json() {
    let payload = serde_json::json!({
        "query_block": {
            "cost_info": {
                "query_cost": "42.75"
            }
        }
    });
    let cost = parse_mysql_query_cost(&payload);
    assert_eq!(cost, Some(42.75));
}

#[test]
fn index_usage_signal_detects_index_name() {
    let payload = serde_json::json!({
        "query_block": {
            "table": {
                "key": "idx_orders_created_at"
            }
        }
    });
    assert!(has_index_usage_signal(&payload, "idx_orders_created_at"));
    assert!(!has_index_usage_signal(&payload, "idx_other"));
}

#[test]
fn parse_version_standard() {
    assert_eq!(parse_version_string("8.0.35"), (8, 0, 35));
}

#[test]
fn parse_version_with_suffix() {
    assert_eq!(parse_version_string("5.7.44-log"), (5, 7, 44));
}

#[test]
fn parse_version_mariadb() {
    assert_eq!(parse_version_string("10.6.12-MariaDB"), (10, 6, 12));
}

#[test]
fn version_feature_flags_mysql8() {
    let (major, minor, patch) = (8u8, 0u8, 35u8);
    let has_data_locks = major >= 8;
    let has_account_locked = major > 5 || (major == 5 && minor > 7) || (major == 5 && minor == 7 && patch >= 6);
    assert!(has_data_locks);
    assert!(has_account_locked);
}

#[test]
fn version_feature_flags_mysql57() {
    let (major, minor, patch) = (5u8, 7u8, 44u8);
    let has_data_locks = major >= 8;
    let has_account_locked = major > 5 || (major == 5 && minor > 7) || (major == 5 && minor == 7 && patch >= 6);
    assert!(!has_data_locks);
    assert!(has_account_locked);
}

#[test]
fn version_feature_flags_mysql56() {
    let (major, minor, patch) = (5u8, 6u8, 51u8);
    let has_data_locks = major >= 8;
    let has_account_locked = major > 5 || (major == 5 && minor > 7) || (major == 5 && minor == 7 && patch >= 6);
    assert!(!has_data_locks);
    assert!(!has_account_locked);
}
