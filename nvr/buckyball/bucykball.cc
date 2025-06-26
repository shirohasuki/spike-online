#include "buckyball.h"
#include <cstdio>
#include <riscv/mmu.h>
#include <riscv/trap.h>
#include <iostream>

using namespace std;

REGISTER_EXTENSION(buckyballFunc, []() { return new buckyballFunc_t; })

#define dprintf(...) { if (p->get_log_commits_enabled()) printf(__VA_ARGS__); }

void buckyball_state_t::reset() {
  enable = true;
  
  spad.clear();
  spad.resize(sp_matrices*DIM, std::vector<elem_t>(DIM, 0));
  
  // Initialize register files (2 banks, each with BANK_ROWS entries)
  rf.clear();
  rf.resize(2, std::vector<int32_t>(BANK_ROWS, 0));
  
  resetted = true;
  
  // printf("buckyball extension configured with:\n");
  // printf("    dim = %u\n", DIM);
}

void buckyballFunc_t::reset() {
  buckyball_state.reset();
}

template <class T>
T buckyballFunc_t::read_from_dram(reg_t addr) {
  T value = 0;
  for (size_t byte_idx = 0; byte_idx < sizeof(T); ++byte_idx) {
    value |= p->get_mmu()->load<uint8_t>(addr + byte_idx) << (byte_idx*8);
  }
  return value;
}

template <class T>
void buckyballFunc_t::write_to_dram(reg_t addr, T data) {
  for (size_t byte_idx = 0; byte_idx < sizeof(T); ++byte_idx) {
    p->get_mmu()->store<uint8_t>(addr + byte_idx, (data >> (byte_idx*8)) & 0xFF);
  }
}

// Move data from DRAM to scratchpad
// rs1: mem_addr, rs2: sp_addr[spAddrLen-1:0] | rows[spAddrLen+9:spAddrLen]
// 每次都搬运完整的行(DIM个元素)
void buckyballFunc_t::mvin(reg_t rs1, reg_t rs2) {
  mvin_rs1_t rs1_fields(rs1);
  mvin_rs2_t rs2_fields(rs2);
  
  auto const base_dram_addr = rs1_fields.base_dram_addr();
  auto const base_sp_addr = rs2_fields.base_sp_addr();
  auto const rows = rs2_fields.rows();
  
  dprintf("BUCKYBALL: mvin - rs1=%lx, rs2=%lx\n", rs1, rs2);
  dprintf("BUCKYBALL: mvin - 0x%02x rows from mem 0x%08x to spad 0x%08x\n", 
          rows, base_dram_addr, base_sp_addr);
  
  for (size_t i = 0; i < rows; ++i) {
    auto const dram_row_addr = base_dram_addr + i*DIM*sizeof(elem_t);
    const size_t spad_row = base_sp_addr + i;

    for (size_t j = 0; j < DIM; ++j) {
      auto const dram_byte_addr = dram_row_addr + j*sizeof(elem_t);
      elem_t value = read_from_dram<elem_t>(dram_byte_addr);
      buckyball_state.spad.at(spad_row).at(j) = value;
      // dprintf("%d ", value);
    }
    // dprintf("\n");
  }
}

// Move data from scratchpad to DRAM  
// rs1: mem_addr, rs2: sp_addr[spAddrLen-1:0] | rows[spAddrLen+9:spAddrLen]
// 每次都搬运完整的行(DIM个元素)
void buckyballFunc_t::mvout(reg_t rs1, reg_t rs2) {
  mvout_rs1_t rs1_fields(rs1);
  mvout_rs2_t rs2_fields(rs2);
  
  auto const base_dram_addr = rs1_fields.base_dram_addr();
  auto const base_sp_addr = rs2_fields.base_sp_addr();
  auto const rows = rs2_fields.rows();

  dprintf("BUCKYBALL: mvout - rs1=%lx, rs2=%lx\n", rs1, rs2);
  dprintf("BUCKYBALL: mvout - 0x%02x rows from spad 0x%08x to mem 0x%08x\n", 
          rows, base_sp_addr, base_dram_addr);

  for (size_t i = 0; i < rows; ++i) {
    auto const dram_row_addr = base_dram_addr + i*DIM*sizeof(elem_t);
    const size_t spad_row = base_sp_addr + i;

    for (size_t j = 0; j < DIM; ++j) {
      auto const dram_byte_addr = dram_row_addr + j*sizeof(elem_t);
      elem_t value = buckyball_state.spad.at(spad_row).at(j);
      write_to_dram<elem_t>(dram_byte_addr, value);
      // dprintf("%d ", value);
    }
    // dprintf("\n");
  }
}

// Scatter move in for indices (load indices to register file)
// rs1: mem_addr, rs2: count[31:1] | rf_bank[0:0]
void buckyballFunc_t::scatter_mvin(reg_t rs1, reg_t rs2) {
  scatter_mvin_rs1_t rs1_fields(rs1);
  scatter_mvin_rs2_t rs2_fields(rs2);
  
  auto const base_dram_addr = rs1_fields.base_dram_addr();
  auto const rf_bank = rs2_fields.rf_bank();
  auto const count = rs2_fields.count();
  
  dprintf("BUCKYBALL: scatter_mvin - rs1=%lx, rs2=%lx\n", rs1, rs2);
  dprintf("BUCKYBALL: scatter_mvin - %d indices from mem 0x%08x to RF bank %d\n", 
          count, base_dram_addr, rf_bank);
  
  for (size_t i = 0; i < count; ++i) {
    auto const dram_byte_addr = base_dram_addr + i * sizeof(int32_t);
    int32_t value = read_from_dram<int32_t>(dram_byte_addr);
    buckyball_state.rf.at(rf_bank).at(i) = value;
    // dprintf("RF[%d][%ld] = %d\n", rf_bank, i, value);
  }
}

// Matrix multiplication using warp16 pattern
void buckyballFunc_t::mul_warp16(reg_t rs1, reg_t rs2) {
  mul_warp16_rs1_t rs1_fields(rs1);
  mul_warp16_rs2_t rs2_fields(rs2);
  
  auto const op1_spaddr = rs1_fields.op1_addr();
  auto const op2_spaddr = rs1_fields.op2_addr();
  auto const wr_spaddr = rs2_fields.wr_addr();
  auto const iter = rs2_fields.iter();

  // TODO:加个assert，op1_spaddr和op2_spaddr不能属于同一个bank

  dprintf("BUCKYBALL: mul_warp16 - rs1=0x%08lx, rs2=0x%08lx\n", rs1, rs2);
  dprintf("BUCKYBALL: mul_warp16 - op1_spaddr=0x%08lx, op2_spaddr=0x%08lx, wr_spaddr=0x%08lx, iter=0x%02lx\n", 
          op1_spaddr, op2_spaddr, wr_spaddr, iter);

  // Perform matrix multiplication for specified iterations
  for (size_t i = 0; i < iter; ++i) {
    // For each iteration, compute one row of result matrix
    const size_t result_row = wr_spaddr + i;
    const size_t op1_row = op1_spaddr + i;
    
    // Initialize result row to zero
    for (size_t col = 0; col < DIM; ++col) {
      buckyball_state.spad.at(result_row).at(col) = 0;
    }
    
    // Compute dot product for each column of result
    for (size_t col = 0; col < DIM; ++col) {
      elem_t sum = 0;
      for (size_t k = 0; k < DIM; ++k) {
        // op1[i][k] * op2[k][col]
        elem_t a = buckyball_state.spad.at(op1_row).at(k);
        elem_t b = buckyball_state.spad.at(op2_spaddr + k).at(col);
        sum += a * b;
      }
      buckyball_state.spad.at(result_row).at(col) = sum;
    }
  }
}

// Sparse matrix multiplication
// rs1: A_addr[spAddrLen-1:0] | B_addr[2*spAddrLen-1:spAddrLen]
// rs2: row_rf_bank[0] | col_rf_bank[1] | C_addr[spAddrLen+1:2] | nnz[27:16]
void buckyballFunc_t::sparse_mul(reg_t rs1, reg_t rs2) {
  sparse_mul_rs1_t rs1_fields(rs1);
  sparse_mul_rs2_t rs2_fields(rs2);
  
  auto const A_addr = rs1_fields.A_addr();
  auto const B_addr = rs1_fields.B_addr();
  auto const row_rf_bank = rs2_fields.row_rf_bank();
  auto const col_rf_bank = rs2_fields.col_rf_bank();
  auto const C_addr = rs2_fields.C_addr();
  auto const nnz = rs2_fields.nnz();
  
  dprintf("BUCKYBALL: sparse_mul - rs1=0x%08lx, rs2=0x%08lx\n", rs1, rs2);
  dprintf("BUCKYBALL: sparse_mul - A_addr=0x%08x, B_addr=0x%08x, C_addr=0x%08x, row_rf=%d, col_rf=%d, nnz=%d\n", 
          A_addr, B_addr, C_addr, row_rf_bank, col_rf_bank, nnz);
  
  // Note: Do NOT initialize C to zero here - this function performs C += A * B
  // The caller is responsible for clearing C if needed
  
  // Get register file data
  auto& row_indices = buckyball_state.rf.at(row_rf_bank);
  auto& col_ptrs = buckyball_state.rf.at(col_rf_bank);
  
  // Process CSC sparse matrix multiplication: C = A_sparse * B
  // CSC format: values are stored row by row, column pointers indicate start of each column
  for (size_t col = 0; col < DIM; col++) {
    int col_start = col_ptrs.at(col);
    int col_end = col_ptrs.at(col + 1);
    
    for (int nz_idx = col_start; nz_idx < col_end && nz_idx < nnz; nz_idx++) {
      int row = row_indices.at(nz_idx);
      
      if (row >= 0 && row < DIM && col >= 0 && col < DIM) {
        // Access sparse A value from scratchpad
        // Values are stored linearly in scratchpad, packed by rows
        // nz_idx corresponds to the position in the values array
        size_t val_row = A_addr + (nz_idx / DIM);
        size_t val_col = nz_idx % DIM;
        elem_t a_val = buckyball_state.spad.at(val_row).at(val_col);
        
        // Perform: C[row, :] += a_val * B[col, :]
        for (size_t j = 0; j < DIM; j++) {
          buckyball_state.spad.at(C_addr + row).at(j) += 
            a_val * buckyball_state.spad.at(B_addr + col).at(j);
        }
      }
    }
  }
}

reg_t buckyballFunc_t::CUSTOMFN(XCUSTOM_ACC)(rocc_insn_t insn, reg_t xs1, reg_t xs2) {
  if (!buckyball_state.resetted) {
    reset();
  }

  if (insn.funct == mvin_funct) {
    mvin(xs1, xs2);
  } else if (insn.funct == mvout_funct) {
    mvout(xs1, xs2);
  } else if (insn.funct == mul_funct) {
    mul_warp16(xs1, xs2);
  } else if (insn.funct == scatter_mvin_funct) {
    scatter_mvin(xs1, xs2);
  } else if (insn.funct == sparse_mul_funct) {
    sparse_mul(xs1, xs2);
  } else if (insn.funct == flush_funct) {
    dprintf("BUCKYBALL: flush\n");
  } else {
    dprintf("BUCKYBALL: encountered unknown instruction with funct: %d\n", insn.funct);
    illegal_instruction();
  }
  
  return 0;
}

static reg_t buckyball_custom(processor_t* p, insn_t insn, reg_t pc) {
  buckyballFunc_t* buckyball = static_cast<buckyballFunc_t*>(p->get_extension("buckyballFunc"));
  rocc_insn_union_t u;
  state_t* state = p->get_state();
  buckyball->set_processor(p);
  u.i = insn;
  reg_t xs1 = u.r.xs1 ? state->XPR[insn.rs1()] : -1;
  reg_t xs2 = u.r.xs2 ? state->XPR[insn.rs2()] : -1;
  reg_t xd = buckyball->CUSTOMFN(XCUSTOM_ACC)(u.r, xs1, xs2);
  if (u.r.xd) {
    state->log_reg_write[insn.rd() << 4] = {xd, 0};
    state->XPR.write(insn.rd(), xd);
  }
  return pc+4;
}

std::vector<insn_desc_t> buckyballFunc_t::get_instructions() {
  std::vector<insn_desc_t> insns;
  push_custom_insn(insns, ROCC_OPCODE3, ROCC_OPCODE_MASK, ILLEGAL_INSN_FUNC, buckyball_custom);
  return insns;
}

std::vector<disasm_insn_t*> buckyballFunc_t::get_disasms() {
  std::vector<disasm_insn_t*> insns;
  
  // Define argument types for buckyball instructions
  struct : public arg_t {
    std::string to_string(insn_t insn) const {
      return "x" + std::to_string(insn.rs1());
    }
  } static buckyball_rs1;
  
  struct : public arg_t {
    std::string to_string(insn_t insn) const {
      return "x" + std::to_string(insn.rs2());
    }
  } static buckyball_rs2;
  
  // Custom-3 opcode is ROCC_OPCODE3 (0111 1011)
  // MVIN instruction (funct = 24)
  insns.push_back(new disasm_insn_t("bb_mvin", 
    ROCC_OPCODE3 | (24 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {&buckyball_rs1, &buckyball_rs2}));
  
  // MVOUT instruction (funct = 25)
  insns.push_back(new disasm_insn_t("bb_mvout", 
    ROCC_OPCODE3 | (25 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {&buckyball_rs1, &buckyball_rs2}));
  
  // MATMUL instruction (funct = 32)
  insns.push_back(new disasm_insn_t("bb_mul_warp16", 
    ROCC_OPCODE3 | (32 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {&buckyball_rs1, &buckyball_rs2}));
  
  // SCATTER_MVIN instruction (funct = 34)
  insns.push_back(new disasm_insn_t("bb_scatter_mvin", 
    ROCC_OPCODE3 | (34 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {&buckyball_rs1, &buckyball_rs2}));
  
  // SPARSE_MUL instruction (funct = 33)
  insns.push_back(new disasm_insn_t("bb_sparse_mul", 
    ROCC_OPCODE3 | (33 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {&buckyball_rs1, &buckyball_rs2}));
  
  // FLUSH instruction (funct = 7) - no operands needed
  insns.push_back(new disasm_insn_t("bb_flush", 
    ROCC_OPCODE3 | (7 << 25), 
    ROCC_OPCODE_MASK | (0x7F << 25), 
    {}));
  
  return insns;
}
