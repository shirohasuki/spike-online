#ifndef BUCKYBALL_HWPARAM_H
#define BUCKYBALL_HWPARAM_H

#include <cstdint>

#define DIM 16
#define SPAD_ADDR_LEN 14
#define MEM_ADDR_LEN 32
#define BANK_NUM 4
#define BANK_ROWS 4096
#define RF_BANKS 2
#define BANK_ADDR_LEN 12
#define BANK_SEL_LEN 2
#define RF_ADDR_LEN 4
#define XCUSTOM_ACC 3

struct mvin_rs1_t {
  uint64_t value;
  explicit mvin_rs1_t(uint64_t val) : value(val) {}

  uint32_t base_dram_addr() const { return (value >> 0) & 0xFFFFFFFF; }
};

struct mvin_rs2_t {
  uint64_t value;
  explicit mvin_rs2_t(uint64_t val) : value(val) {}

  uint32_t base_sp_addr() const { return (value >> 0) & 0x3FFF; }
  uint32_t rows() const { return (value >> 14) & 0x3FF; }
};

struct mvout_rs1_t {
  uint64_t value;
  explicit mvout_rs1_t(uint64_t val) : value(val) {}

  uint32_t base_dram_addr() const { return (value >> 0) & 0xFFFFFFFF; }
};

struct mvout_rs2_t {
  uint64_t value;
  explicit mvout_rs2_t(uint64_t val) : value(val) {}

  uint32_t base_sp_addr() const { return (value >> 0) & 0x3FFF; }
  uint32_t rows() const { return (value >> 14) & 0x3FF; }
};

struct mul_warp16_rs1_t {
  uint64_t value;
  explicit mul_warp16_rs1_t(uint64_t val) : value(val) {}

  uint32_t op1_addr() const { return (value >> 0) & 0x3FFF; }
  uint32_t op2_addr() const { return (value >> 14) & 0x3FFF; }
};

struct mul_warp16_rs2_t {
  uint64_t value;
  explicit mul_warp16_rs2_t(uint64_t val) : value(val) {}

  uint32_t wr_addr() const { return (value >> 0) & 0x3FFF; }
  uint32_t iter() const { return (value >> 14) & 0x3FF; }
};

struct scatter_mvin_rs1_t {
  uint64_t value;
  explicit scatter_mvin_rs1_t(uint64_t val) : value(val) {}

  uint32_t base_dram_addr() const { return (value >> 0) & 0xFFFFFFFF; }
};

struct scatter_mvin_rs2_t {
  uint64_t value;
  explicit scatter_mvin_rs2_t(uint64_t val) : value(val) {}

  uint32_t rf_bank() const { return (value >> 0) & 0x1; }
  uint32_t count() const { return (value >> 1) & 0x7FFFFFFF; }
};

struct sparse_mul_rs1_t {
  uint64_t value;
  explicit sparse_mul_rs1_t(uint64_t val) : value(val) {}

  uint32_t A_addr() const { return (value >> 0) & 0x3FFF; }
  uint32_t B_addr() const { return (value >> 14) & 0x3FFF; }
};

struct sparse_mul_rs2_t {
  uint64_t value;
  explicit sparse_mul_rs2_t(uint64_t val) : value(val) {}

  uint32_t row_rf_bank() const { return (value >> 0) & 0x1; }
  uint32_t col_rf_bank() const { return (value >> 1) & 0x1; }
  uint32_t C_addr() const { return (value >> 2) & 0x3FFF; }
  uint32_t nnz() const { return (value >> 16) & 0xFFF; }
};

#define BB_MVIN_FUNCT 24
#define MVIN_funct 24
#define BB_MVOUT_FUNCT 25
#define MVOUT_funct 25
#define BB_MUL_WARP16_FUNCT 32
#define MUL_WARP16_funct 32
#define BB_SCATTER_MVIN_FUNCT 34
#define SCATTER_MVIN_funct 34
#define BB_SPARSE_MUL_ADDR_FUNCT 33
#define SPARSE_MUL_ADDR_funct 33
#define BB_FLUSH_FUNCT 7
#define FLUSH_funct 7

#endif // BUCKYBALL_HWPARAM_H