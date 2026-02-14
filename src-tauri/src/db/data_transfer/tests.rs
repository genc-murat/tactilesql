use std::collections::HashMap;

#[test]
fn test_csv_header_mapping_logic() {
    let mut schema_lookup = HashMap::new();
    schema_lookup.insert("id".to_string(), "ID".to_string());
    schema_lookup.insert("name".to_string(), "Name".to_string());
    
    // Simulate manual mapping logic from import_csv
    let headers = vec![" ID ", "name", "Other"];
    let mut mapped = Vec::new();
    for (idx, header) in headers.iter().enumerate() {
        let normalized = header.trim().to_lowercase();
        if let Some(actual_col) = schema_lookup.get(&normalized) {
            mapped.push((idx, actual_col.clone()));
        }
    }
    
    assert_eq!(mapped.len(), 2);
    assert_eq!(mapped[0], (0, "ID".to_string()));
    assert_eq!(mapped[1], (1, "Name".to_string()));
}
