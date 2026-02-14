use super::*;
use serde_json::json;

#[test]
fn test_extract_single_placeholder() {
    assert_eq!(extract_single_placeholder("{{steps.s1.id}}"), Some("steps.s1.id"));
    assert_eq!(extract_single_placeholder("{{  steps.s1.id  }}"), Some("steps.s1.id"));
    assert_eq!(extract_single_placeholder("not a placeholder"), None);
}

#[test]
fn test_resolve_step_output_path() {
    let mut outputs = HashMap::new();
    outputs.insert("s1".to_string(), json!({
        "status": "success",
        "execution": {
            "id": 123,
            "data": ["a", "b"]
        }
    }));
    
    assert_eq!(resolve_step_output_path("steps.s1.status", &outputs).unwrap(), json!("success"));
    assert_eq!(resolve_step_output_path("steps.s1.execution.id", &outputs).unwrap(), json!(123));
    assert_eq!(resolve_step_output_path("steps.s1.execution.data.0", &outputs).unwrap(), json!("a"));
    
    assert!(resolve_step_output_path("steps.unknown.id", &outputs).is_err());
}

#[test]
fn test_resolve_template_value() {
    let mut outputs = HashMap::new();
    outputs.insert("s1".to_string(), json!({ "id": 123 }));
    
    let t1 = "ID is {{steps.s1.id}}";
    assert_eq!(resolve_template_value(t1, &outputs).unwrap(), json!("ID is 123"));
    
    // Recursive resolve
    let payload = json!({
        "query": "SELECT * FROM t WHERE id = {{steps.s1.id}}"
    });
    let resolved = resolve_composite_step_payload(&payload, &outputs).unwrap();
    assert_eq!(resolved["query"], "SELECT * FROM t WHERE id = 123");
}
