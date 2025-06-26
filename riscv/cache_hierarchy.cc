#include "cache_model.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

// Simple YAML parser for cache configuration
// Note: This is a simplified parser, not a full YAML implementation
static int parse_yaml_int(const char* line, const char* key) {
  // Look for exact key match at start of line (after whitespace)
  const char* trimmed = line;
  while (*trimmed && (*trimmed == ' ' || *trimmed == '\t')) trimmed++;
  
  if (strncmp(trimmed, key, strlen(key)) != 0) return -1;
  
  const char* pos = trimmed + strlen(key);
  if (*pos != ':') return -1;  // Must be followed by colon
  
  pos++;
  while (*pos && (*pos == ':' || *pos == ' ' || *pos == '\t')) pos++;
  
  return atoi(pos);
}

static const char* parse_yaml_string(const char* line, const char* key, char* buffer, size_t buffer_size) {
  const char* pos = strstr(line, key);
  if (!pos) return NULL;
  
  pos += strlen(key);
  while (*pos && (*pos == ':' || *pos == ' ' || *pos == '"')) pos++;
  
  const char* end = pos;
  while (*end && *end != '"' && *end != '\n' && *end != ' ') end++;
  
  size_t len = end - pos;
  if (len >= buffer_size) len = buffer_size - 1;
  
  strncpy(buffer, pos, len);
  buffer[len] = '\0';
  
  return buffer;
}

// Create cache hierarchy from configuration file
cache_hierarchy_t* cache_hierarchy_create_from_config(const char* config_file) {
  FILE* file = fopen(config_file, "r");
  if (!file) {
    printf("Warning: Cannot open cache config file %s\n", config_file);
    exit(1);    
  }
  
  // Parse configuration file
  char line[256];
  
  // Default values
  int l1i_size = 16384, l1i_ways = 4, l1i_line_size = 64;
  int l1d_size = 16384, l1d_ways = 4, l1d_line_size = 64;
  int l2_size = 262144, l2_ways = 8, l2_line_size = 64;
  int l1_hit_lat = 1, l2_hit_lat = 8, mem_lat = 100;
  
  char current_section[64] = "";
  
  while (fgets(line, sizeof(line), file)) {
    // Skip comments and empty lines
    if (line[0] == '#' || line[0] == '\n') continue;
    
    // Check for section headers
    if (strstr(line, "l1_icache:")) {
      strcpy(current_section, "l1_icache");
      continue;
    } else if (strstr(line, "l1_dcache:")) {
      strcpy(current_section, "l1_dcache");
      continue;
    } else if (strstr(line, "l2_cache:")) {
      strcpy(current_section, "l2_cache");
      continue;
    } else if (strstr(line, "latencies:")) {
      strcpy(current_section, "latencies");
      continue;
    }
    
    // Parse values based on current section
    if (strcmp(current_section, "l1_icache") == 0) {
      int val;
      if ((val = parse_yaml_int(line, "size")) != -1) l1i_size = val;
      if ((val = parse_yaml_int(line, "ways")) != -1) l1i_ways = val;
      if ((val = parse_yaml_int(line, "line_size")) != -1) l1i_line_size = val;
    } else if (strcmp(current_section, "l1_dcache") == 0) {
      int val;
      if ((val = parse_yaml_int(line, "size")) != -1) l1d_size = val;
      if ((val = parse_yaml_int(line, "ways")) != -1) l1d_ways = val;
      if ((val = parse_yaml_int(line, "line_size")) != -1) l1d_line_size = val;
    } else if (strcmp(current_section, "l2_cache") == 0) {
      int val;
      if ((val = parse_yaml_int(line, "size")) != -1) l2_size = val;
      if ((val = parse_yaml_int(line, "ways")) != -1) l2_ways = val;
      if ((val = parse_yaml_int(line, "line_size")) != -1) l2_line_size = val;
    } else if (strcmp(current_section, "latencies") == 0) {
      int val;
      if ((val = parse_yaml_int(line, "l1_hit")) != -1) l1_hit_lat = val;
      if ((val = parse_yaml_int(line, "l2_hit")) != -1) l2_hit_lat = val;
      if ((val = parse_yaml_int(line, "memory")) != -1) mem_lat = val;
    }
  }
  
  fclose(file);
  
  // Create hierarchy
  cache_hierarchy_t* hierarchy = (cache_hierarchy_t*)malloc(sizeof(cache_hierarchy_t));
  if (!hierarchy) return NULL;
  
  hierarchy->l1_icache = cache_create("L1-I$", l1i_size, l1i_ways, l1i_line_size, CACHE_LRU, CACHE_WRITE_THROUGH);
  hierarchy->l1_dcache = cache_create("L1-D$", l1d_size, l1d_ways, l1d_line_size, CACHE_LRU, CACHE_WRITE_BACK);
  hierarchy->l2_cache = cache_create("L2$", l2_size, l2_ways, l2_line_size, CACHE_LRU, CACHE_WRITE_BACK);
  
  hierarchy->l1_hit_latency = l1_hit_lat;
  hierarchy->l2_hit_latency = l2_hit_lat;
  hierarchy->memory_latency = mem_lat;
  
  hierarchy->total_cycles = 0;
  hierarchy->memory_accesses = 0;
  
  if (!hierarchy->l1_icache || !hierarchy->l1_dcache || !hierarchy->l2_cache) {
    printf("Failed to create one or more caches\n");
    cache_hierarchy_destroy(hierarchy);
    return NULL;
  }
  
  printf("Cache hierarchy configured:\n");
  printf("  L1-I$: %dKB, %d-way, %dB line\n", l1i_size/1024, l1i_ways, l1i_line_size);
  printf("  L1-D$: %dKB, %d-way, %dB line\n", l1d_size/1024, l1d_ways, l1d_line_size);
  printf("  L2$: %dKB, %d-way, %dB line\n", l2_size/1024, l2_ways, l2_line_size);
  
  return hierarchy;
}

// Destroy cache hierarchy
void cache_hierarchy_destroy(cache_hierarchy_t* hierarchy) {
  if (!hierarchy) return;
  
  cache_destroy(hierarchy->l1_icache);
  cache_destroy(hierarchy->l1_dcache);
  cache_destroy(hierarchy->l2_cache);
  free(hierarchy);
}

// Access cache hierarchy
cache_result_t cache_hierarchy_access(cache_hierarchy_t* hierarchy, 
                    uint64_t addr, cache_access_t access_type,
                    bool is_instruction) {
  cache_result_t result = {0};
  uint32_t total_latency = 0;
  
  hierarchy->memory_accesses++;
  
  // Access L1 cache
  cache_t* l1_cache = is_instruction ? hierarchy->l1_icache : hierarchy->l1_dcache;
  cache_result_t l1_result = cache_access(l1_cache, addr, access_type);
  
  total_latency += l1_result.latency;
  
  if (l1_result.hit) {
    // L1 hit
    result.hit = true;
    result.latency = hierarchy->l1_hit_latency;
    result.l1_miss = false;
    result.l2_miss = false;
    hierarchy->total_cycles += result.latency;
    return result;
  }
  
  // L1 miss - access L2
  result.l1_miss = true;
  cache_result_t l2_result = cache_access(hierarchy->l2_cache, addr, access_type);
  total_latency += l2_result.latency;
  
  if (l2_result.hit) {
    // L2 hit (but L1 miss)
    result.hit = true;  // Overall hit because we found data in L2
    result.latency = hierarchy->l1_hit_latency + hierarchy->l2_hit_latency;
    result.l2_miss = false;
  } else {
    // L2 miss - access memory
    result.hit = false;
    result.latency = hierarchy->l1_hit_latency + hierarchy->l2_hit_latency + hierarchy->memory_latency;
    result.l2_miss = true;
  }
  
  // Handle L2 writeback if needed
  if (l2_result.writeback_needed) {
    hierarchy->total_cycles += hierarchy->memory_latency; // Additional cycles for writeback
  }
  
  // Handle L1 writeback if needed (to L2)
  if (l1_result.writeback_needed) {
    cache_access(hierarchy->l2_cache, l1_result.writeback_addr, CACHE_WRITE);
  }
  
  hierarchy->total_cycles += result.latency;
  return result;
}

// Print cache hierarchy statistics
void cache_hierarchy_print_stats(const cache_hierarchy_t* hierarchy) {
  if (!hierarchy) return;
  
  printf("\n=== Cache Hierarchy Statistics ===\n");
  
  cache_print_stats(hierarchy->l1_icache);
  cache_print_stats(hierarchy->l1_dcache);
  cache_print_stats(hierarchy->l2_cache);
  
  printf("\n=== Overall Statistics ===\n");
  printf("Total Memory Accesses: %lu\n", hierarchy->memory_accesses);
  printf("Total Cycles: %lu\n", hierarchy->total_cycles);
  
  if (hierarchy->memory_accesses > 0) {
    double avg_latency = (double)hierarchy->total_cycles / hierarchy->memory_accesses;
    printf("Average Memory Latency: %.2f cycles\n", avg_latency);
  }
}

// Reset cache hierarchy statistics
void cache_hierarchy_reset_stats(cache_hierarchy_t* hierarchy) {
  if (!hierarchy) return;
  
  cache_reset_stats(hierarchy->l1_icache);
  cache_reset_stats(hierarchy->l1_dcache);
  cache_reset_stats(hierarchy->l2_cache);
  
  hierarchy->total_cycles = 0;
  hierarchy->memory_accesses = 0;
} 