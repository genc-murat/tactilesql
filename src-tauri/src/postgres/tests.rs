use super::*;

#[test]
fn extract_pg_total_cost_from_explain_payload() {
    let payload = serde_json::json!([
        {
            "Plan": {
                "Node Type": "Seq Scan",
                "Total Cost": 128.56
            }
        }
    ]);
    let cost = extract_pg_total_cost(&payload);
    assert_eq!(cost, Some(128.56));
}
