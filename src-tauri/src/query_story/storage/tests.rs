use super::*;

#[test]
fn test_calculate_query_hash() {
    let q1 = "SELECT * FROM users";
    let q2 = "  select * from USERS  ";
    assert_eq!(QueryStoryStore::calculate_query_hash(q1), QueryStoryStore::calculate_query_hash(q2));
}

#[test]
fn test_generate_diff_summary() {
    let old = "line1
line2";
    let new = "line1
line2
line3";
    assert_eq!(QueryStoryStore::generate_diff_summary(old, new), "Added 1 lines");
    
    let newer = "line1";
    assert_eq!(QueryStoryStore::generate_diff_summary(old, newer), "Removed 1 lines");
    
    assert_eq!(QueryStoryStore::generate_diff_summary(old, old), "No changes");
}

#[test]
fn test_compute_diff() {
    let old = "SELECT 1";
    let new = "SELECT 2";
    let diff = QueryStoryStore::compute_diff(old, new);
    
    assert_eq!(diff.len(), 2);
    assert_eq!(diff[0].change_type, ChangeType::Removed);
    assert_eq!(diff[1].change_type, ChangeType::Added);
}

#[tokio::test]
async fn test_query_story_crud() {
    let pool = Pool::connect("sqlite::memory:").await.unwrap();
    let store = QueryStoryStore::new(pool).await.unwrap();
    
    let request = CreateQueryStoryRequest {
        query_text: "SELECT 1".to_string(),
        author: "alice".to_string(),
        context: QueryContext::default(),
        tags: vec!["test".to_string()],
    };
    
    let story = store.create_story(request).await.unwrap();
    assert_eq!(story.author, "alice");
    assert_eq!(story.versions.len(), 1);
    
    // Add version
    let v_req = AddVersionRequest {
        query_hash: story.query_hash.clone(),
        new_query_text: "SELECT 2".to_string(),
        author: "bob".to_string(),
        change_reason: "update".to_string(),
        performance_before: None,
        performance_after: None,
    };
    
    store.add_version(v_req).await.unwrap();
    let story2 = store.get_story(&story.query_hash).await.unwrap().unwrap();
    assert_eq!(story2.versions.len(), 2);
    assert_eq!(story2.query_text, "SELECT 2");
    
    // Favorite
    assert!(!story2.is_favorite);
    store.toggle_favorite(&story.query_hash).await.unwrap();
    let story3 = store.get_story(&story.query_hash).await.unwrap().unwrap();
    assert!(story3.is_favorite);
}
