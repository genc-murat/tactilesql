use sqlx::{Pool, Sqlite};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use crate::dependency_engine::graph::DependencyGraphData;

const GRAPH_CACHE_TTL: Duration = Duration::from_secs(45);
const GRAPH_CACHE_MAX_ENTRIES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GraphCacheKey {
    pub db_type: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub table_name: Option<String>,
    pub hop_depth: Option<u8>,
}

#[derive(Debug, Clone)]
struct CachedGraph {
    data: DependencyGraphData,
    expires_at: Instant,
    last_accessed: Instant,
}

#[derive(Debug, Clone)]
pub struct DependencyEngineStore {
#[allow(dead_code)]
    pool: Pool<Sqlite>,
    graph_cache: Arc<Mutex<HashMap<GraphCacheKey, CachedGraph>>>,
}

impl DependencyEngineStore {
    pub async fn new(pool: Pool<Sqlite>) -> Result<Self, String> {
        // Initialize any tables if needed (e.g. cached graphs)
        // For now, no persistence required as we build on-the-fly or we might cache later.
        Ok(Self {
            pool,
            graph_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn get_cached_graph(&self, key: &GraphCacheKey) -> Option<DependencyGraphData> {
        let mut cache = self.graph_cache.lock().ok()?;
        let now = Instant::now();
        cache.retain(|_, entry| entry.expires_at > now);

        let entry = cache.get_mut(key)?;
        entry.last_accessed = now;
        Some(entry.data.clone())
    }

    pub fn put_cached_graph(&self, key: GraphCacheKey, data: DependencyGraphData) {
        let mut cache = match self.graph_cache.lock() {
            Ok(cache) => cache,
            Err(_) => return,
        };

        let now = Instant::now();
        cache.retain(|_, entry| entry.expires_at > now);

        if cache.len() >= GRAPH_CACHE_MAX_ENTRIES {
            if let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.last_accessed)
                .map(|(cache_key, _)| cache_key.clone())
            {
                cache.remove(&oldest_key);
            }
        }

        cache.insert(
            key,
            CachedGraph {
                data,
                expires_at: now + GRAPH_CACHE_TTL,
                last_accessed: now,
            },
        );
    }

    pub fn invalidate_connection_cache(&self, connection_id: &str) {
        let mut cache = match self.graph_cache.lock() {
            Ok(cache) => cache,
            Err(_) => return,
        };

        cache.retain(|key, _| key.connection_id != connection_id);
    }

    pub fn clear_cache(&self) {
        let mut cache = match self.graph_cache.lock() {
            Ok(cache) => cache,
            Err(_) => return,
        };
        cache.clear();
    }
}
