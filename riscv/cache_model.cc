#include "cache_model.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

// Helper function to calculate log2
static uint32_t log2_uint32(uint32_t value) {
  uint32_t result = 0;
  while (value >>= 1) result++;
  return result;
}

// Create a cache
cache_t* cache_create(const char* name, uint32_t size, uint32_t ways, 
            uint32_t line_size, cache_replacement_t replacement,
            cache_write_policy_t write_policy) {
  cache_t* cache = (cache_t*)malloc(sizeof(cache_t));
  if (!cache) return NULL;
  
  // Configuration
  cache->size = size;
  cache->ways = ways;
  cache->line_size = line_size;
  cache->sets = size / (ways * line_size);
  
  // Validate configuration
  if (cache->sets == 0 || ways == 0 || line_size == 0) {
    printf("Invalid cache configuration: size=%d, ways=%d, line_size=%d, sets=%d\n", 
         size, ways, line_size, cache->sets);
    free(cache);
    return NULL;
  }
  cache->replacement = replacement;
  cache->write_policy = write_policy;
  
  // Derived values
  cache->offset_bits = log2_uint32(line_size);
  cache->index_bits = log2_uint32(cache->sets);
  cache->index_mask = (1ULL << cache->index_bits) - 1;
  cache->tag_mask = ~((1ULL << (cache->offset_bits + cache->index_bits)) - 1);
  
  // Initialize cache sets
  cache->cache_sets = (cache_set_t*)calloc(cache->sets, sizeof(cache_set_t));
  if (!cache->cache_sets) {
    free(cache);
    return NULL;
  }
  
  for (uint32_t i = 0; i < cache->sets; i++) {
    cache->cache_sets[i].lines = (cache_line_t*)calloc(ways, sizeof(cache_line_t));
    if (!cache->cache_sets[i].lines) {
      // Cleanup on failure
      for (uint32_t j = 0; j < i; j++) {
        free(cache->cache_sets[j].lines);
      }
      free(cache->cache_sets);
      free(cache);
      return NULL;
    }
    cache->cache_sets[i].next_lru = 0;
  }
  
  // Statistics
  cache->accesses = 0;
  cache->hits = 0;
  cache->misses = 0;
  cache->writebacks = 0;
  cache->reads = 0;
  cache->writes = 0;
  
  // Name
  strncpy(cache->name, name, sizeof(cache->name) - 1);
  cache->name[sizeof(cache->name) - 1] = '\0';
  
  return cache;
}

// Destroy a cache
void cache_destroy(cache_t* cache) {
  if (!cache) return;
  
  if (cache->cache_sets) {
    for (uint32_t i = 0; i < cache->sets; i++) {
      free(cache->cache_sets[i].lines);
    }
    free(cache->cache_sets);
  }
  free(cache);
}

// Find LRU way in a set
static uint32_t find_lru_way(cache_set_t* set, uint32_t ways) {
  uint32_t lru_way = 0;
  uint32_t min_lru = set->lines[0].lru_counter;
  
  for (uint32_t i = 1; i < ways; i++) {
    if (set->lines[i].lru_counter < min_lru) {
      min_lru = set->lines[i].lru_counter;
      lru_way = i;
    }
  }
  
  return lru_way;
}

// Update LRU counters
static void update_lru(cache_set_t* set, uint32_t ways, uint32_t accessed_way) {
  uint32_t old_lru = set->lines[accessed_way].lru_counter;
  
  // Increment LRU counter for the accessed line
  set->lines[accessed_way].lru_counter = set->next_lru++;
  
  // Prevent overflow by resetting counters periodically
  if (set->next_lru > 1000000) {
    // Reset all counters while maintaining relative order
    uint32_t min_lru = set->lines[0].lru_counter;
    for (uint32_t i = 1; i < ways; i++) {
      if (set->lines[i].lru_counter < min_lru) {
        min_lru = set->lines[i].lru_counter;
      }
    }
    
    for (uint32_t i = 0; i < ways; i++) {
      set->lines[i].lru_counter -= min_lru;
    }
    set->next_lru -= min_lru;
  }
}

// Access cache
cache_result_t cache_access(cache_t* cache, uint64_t addr, cache_access_t access_type) {
  cache_result_t result = {0};
  
  // Update statistics
  cache->accesses++;
  if (access_type == CACHE_READ) {
    cache->reads++;
  } else {
    cache->writes++;
  }
  
  // Extract address components
  uint64_t offset = addr & ((1ULL << cache->offset_bits) - 1);
  uint64_t index = (addr >> cache->offset_bits) & cache->index_mask;
  uint64_t tag = addr >> (cache->offset_bits + cache->index_bits);
  
  cache_set_t* set = &cache->cache_sets[index];
  
  // Check for hit
  for (uint32_t way = 0; way < cache->ways; way++) {
    cache_line_t* line = &set->lines[way];
    
    if (line->state != CACHE_INVALID && line->tag == tag) {
      // Hit!
      cache->hits++;
      result.hit = true;
      result.latency = 1; // Base latency for cache hit
      
      // Update LRU
      update_lru(set, cache->ways, way);
      
      // Handle write
      if (access_type == CACHE_WRITE) {
        if (cache->write_policy == CACHE_WRITE_BACK) {
          line->state = CACHE_DIRTY;
        } else {
          // Write-through: no additional action needed here
          // (would write to next level in real implementation)
        }
      }
      
      return result;
    }
  }
  
  // Miss - find victim
  cache->misses++;
  result.hit = false;
  result.latency = 10; // Higher latency for miss
  
  uint32_t victim_way;
  
  // First check for invalid line
  bool found_invalid = false;
  for (uint32_t way = 0; way < cache->ways; way++) {
    if (set->lines[way].state == CACHE_INVALID) {
      victim_way = way;
      found_invalid = true;
      break;
    }
  }
  
  if (!found_invalid) {
    // Use replacement policy
    if (cache->replacement == CACHE_LRU) {
      victim_way = find_lru_way(set, cache->ways);
    } else {
      // Random replacement
      victim_way = rand() % cache->ways;
    }
    
    // Check if victim needs writeback
    cache_line_t* victim = &set->lines[victim_way];
    if (victim->state == CACHE_DIRTY) {
      result.writeback_needed = true;
      result.writeback_addr = (victim->tag << (cache->offset_bits + cache->index_bits)) | 
                   (index << cache->offset_bits);
      cache->writebacks++;
    }
  }
  
  // Install new line
  cache_line_t* new_line = &set->lines[victim_way];
  new_line->tag = tag;
  new_line->state = (access_type == CACHE_WRITE && cache->write_policy == CACHE_WRITE_BACK) ? 
            CACHE_DIRTY : CACHE_VALID;
  new_line->data_addr = addr & ~((1ULL << cache->offset_bits) - 1);
  
  // Update LRU
  update_lru(set, cache->ways, victim_way);
  
  return result;
}

// Print cache statistics
void cache_print_stats(const cache_t* cache) {
  if (!cache) return;
  
  printf("\n=== %s Statistics ===\n", cache->name);
  printf("Configuration: %dKB, %d-way, %dB line, %d sets\n", 
       cache->size / 1024, cache->ways, cache->line_size, cache->sets);
  printf("Accesses: %lu\n", cache->accesses);
  printf("Hits: %lu\n", cache->hits);
  printf("Misses: %lu\n", cache->misses);
  printf("Reads: %lu\n", cache->reads);
  printf("Writes: %lu\n", cache->writes);
  printf("Writebacks: %lu\n", cache->writebacks);
  
  if (cache->accesses > 0) {
    double hit_rate = (double)cache->hits / cache->accesses * 100.0;
    double miss_rate = (double)cache->misses / cache->accesses * 100.0;
    printf("Hit Rate: %.2f%%\n", hit_rate);
    printf("Miss Rate: %.2f%%\n", miss_rate);
  }
}

// Reset cache statistics
void cache_reset_stats(cache_t* cache) {
  if (!cache) return;
  
  cache->accesses = 0;
  cache->hits = 0;
  cache->misses = 0;
  cache->writebacks = 0;
  cache->reads = 0;
  cache->writes = 0;
} 