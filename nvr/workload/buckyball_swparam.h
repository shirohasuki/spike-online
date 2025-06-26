#ifndef BUCKYBALL_SWPARAM_H
#define BUCKYBALL_SWPARAM_H

#include <stdint.h>

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

#define MVIN(rs1, rs2) \
    asm volatile(".insn r 0x7B, 0x3, 24, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")

#define MVOUT(rs1, rs2) \
    asm volatile(".insn r 0x7B, 0x3, 25, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")

#define MUL_WARP16(rs1, rs2) \
    asm volatile(".insn r 0x7B, 0x3, 32, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")

#define SCATTER_MVIN(rs1, rs2) \
    asm volatile(".insn r 0x7B, 0x3, 34, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")

#define SPARSE_MUL_ADDR(rs1, rs2) \
    asm volatile(".insn r 0x7B, 0x3, 33, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")

#define FLUSH() \
    asm volatile(".insn r 0x7B, 0x3, 7, x0, x0, x0" ::: "memory")

#define bb_mvin(base_dram_addr, base_sp_addr, rows) \
    do { \
        uint32_t encoded_rs2 = (base_sp_addr) & ((1UL << 14) - 1) | ((rows) & ((1UL << 10) - 1)) << 14; \
        MVIN(base_dram_addr, encoded_rs2); \
    } while(0)


#define bb_mvout(base_dram_addr, base_sp_addr, rows) \
    do { \
        uint32_t encoded_rs2 = (base_sp_addr) & ((1UL << 14) - 1) | ((rows) & ((1UL << 10) - 1)) << 14; \
        MVOUT(base_dram_addr, encoded_rs2); \
    } while(0)


#define bb_mul_warp16(op1_addr, op2_addr, wr_addr, iter) \
    do { \
        uint32_t encoded_rs1 = (op1_addr) & ((1UL << 14) - 1) | ((op2_addr) & ((1UL << 14) - 1)) << 14; \
        uint32_t encoded_rs2 = (wr_addr) & ((1UL << 14) - 1) | ((iter) & ((1UL << 10) - 1)) << 14; \
        MUL_WARP16(encoded_rs1, encoded_rs2); \
    } while(0)


#define bb_scatter_mvin(base_dram_addr, rf_bank, count) \
    do { \
        uint32_t encoded_rs2 = ((rf_bank) & 0x1) << 0 | ((count) & ((1UL << 31) - 1)) << 1; \
        SCATTER_MVIN(base_dram_addr, encoded_rs2); \
    } while(0)


#define bb_sparse_mul_addr(A_addr, B_addr, row_rf_bank, col_rf_bank, C_addr, nnz) \
    do { \
        uint32_t encoded_rs1 = (A_addr) & ((1UL << 14) - 1) | ((B_addr) & ((1UL << 14) - 1)) << 14; \
        uint32_t encoded_rs2 = ((row_rf_bank) & 0x1) << 0 | ((col_rf_bank) & 0x1) << 1 | ((C_addr) & ((1UL << 14) - 1)) << 2 | ((nnz) & ((1UL << 12) - 1)) << 16; \
        SPARSE_MUL_ADDR(encoded_rs1, encoded_rs2); \
    } while(0)


#define bb_flush() \
    FLUSH()


#endif // BUCKYBALL_SWPARAM_H