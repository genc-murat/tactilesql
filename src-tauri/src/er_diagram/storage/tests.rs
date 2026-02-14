use super::*;

#[tokio::test]
async fn test_er_diagram_store_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = ErDiagramStore::new(pool).await.unwrap();
    
    let layout = serde_json::json!({
        "tables": [
            {"id": "t1", "x": 100, "y": 100}
        ],
        "edges": []
    });
    
    let record = store.save_layout("conn1", "db1", "main_diagram", &layout).await.unwrap();
    assert_eq!(record.diagram_name, "main_diagram");
    
    let fetched = store.get_layout("conn1", "db1", "main_diagram").await.unwrap().unwrap();
    assert_eq!(fetched.id, record.id);
    assert_eq!(fetched.payload, layout);
    
    let list = store.list_layouts("conn1", "db1").await.unwrap();
    assert_eq!(list.len(), 1);
    
    let deleted = store.delete_layout("conn1", "db1", "main_diagram").await.unwrap();
    assert!(deleted);
    
    let empty = store.get_layout("conn1", "db1", "main_diagram").await.unwrap();
    assert!(empty.is_none());
}
