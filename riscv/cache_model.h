#ifndef _CACHE_MODEL_H
#define _CACHE_MODEL_H

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// Cache line state
typedef enum {
  CACHE_INVALID = 0,
  CACHE_VALID = 1,
  CACHE_DIRTY = 2
} cache_state_t;

// Cache replacement policy
typedef enum {
  CACHE_LRU = 0,
  CACHE_RANDOM = 1
} cache_replacement_t;

// Cache write policy
typedef enum {
  CACHE_WRITE_THROUGH = 0,
  CACHE_WRITE_BACK = 1
} cache_write_policy_t;

// Cache access type
typedef enum {
  CACHE_READ = 0,
  CACHE_WRITE = 1
} cache_access_t;

// Cache access result
typedef struct {
  bool hit;
  uint32_t latency;
  bool writeback_needed;
  uint64_t writeback_addr;
  bool l1_miss;
  bool l2_miss;
} cache_result_t;

// Cache line structure
typedef struct {
  uint64_t tag;
  cache_state_t state;
  uint32_t lru_counter;
  uint64_t data_addr;  // For writeback tracking
} cache_line_t;

// Cache set structure
typedef struct {
  cache_line_t *lines;
  uint32_t next_lru;
} cache_set_t;

// Cache structure
typedef struct {
  // Configuration
  uint32_t size;
  uint32_t ways;
  uint32_t line_size;
  uint32_t sets;
  cache_replacement_t replacement;
  cache_write_policy_t write_policy;
  
  // Derived values
  uint32_t index_bits;
  uint32_t offset_bits;
  uint64_t index_mask;
  uint64_t tag_mask;
  
  // Cache data
  cache_set_t *cache_sets;
  
  // Statistics
  uint64_t accesses;
  uint64_t hits;
  uint64_t misses;
  uint64_t writebacks;
  uint64_t reads;
  uint64_t writes;
  
  // Name for debugging
  char name[32];
} cache_t;

// Cache hierarchy structure
struct cache_hierarchy_t {
    cache_t *l1_icache;
    cache_t *l1_dcache;
    cache_t *l2_cache;
    
    // Latencies
    uint32_t l1_hit_latency;
    uint32_t l2_hit_latency;
    uint32_t memory_latency;
    
    // Statistics
    uint64_t total_cycles;
    uint64_t memory_accesses;
};

// Function declarations
cache_t* cache_create(const char* name, uint32_t size, uint32_t ways, 
            uint32_t line_size, cache_replacement_t replacement,
            cache_write_policy_t write_policy);

void cache_destroy(cache_t* cache);

cache_result_t cache_access(cache_t* cache, uint64_t addr, cache_access_t access_type);

void cache_print_stats(const cache_t* cache);

void cache_reset_stats(cache_t* cache);

// Cache hierarchy functions
cache_hierarchy_t* cache_hierarchy_create_from_config(const char* config_file);

void cache_hierarchy_destroy(cache_hierarchy_t* hierarchy);

cache_result_t cache_hierarchy_access(cache_hierarchy_t* hierarchy, 
                    uint64_t addr, cache_access_t access_type,
                    bool is_instruction);

void cache_hierarchy_print_stats(const cache_hierarchy_t* hierarchy);

void cache_hierarchy_reset_stats(cache_hierarchy_t* hierarchy);

#endif // _CACHE_MODEL_H 