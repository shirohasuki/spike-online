set(RISCV_GNU_TOOLCHAIN ${CYDIR}/.conda-env/riscv-tools)
set(ELF_CC "riscv64-unknown-elf-gcc")
set(LINUX_CC "riscv64-unknown-linux-gnu-g++")

set(BUCKYBALL_WORKLOAD_DIR /home/mio/Code/Frontend/spike-online/nvr/workload)
set(BUCKYBALL_CTEST_DIR ${BUCKYBALL_WORKLOAD_DIR})
set(BINARY_OUTPUT_DIR ${BUCKYBALL_WORKLOAD_DIR}/../binary)

# 确保binary目录存在
file(MAKE_DIRECTORY ${BINARY_OUTPUT_DIR})

#-------------------------------------------------------------------------------
# build linux version workload (current not supported)
#-------------------------------------------------------------------------------
# set(LINK_FLAGS "-static -Wl,--no-dynamic-linker")
# set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${LINK_FLAGS}")
# # add_compile_options(-O2 -static)

# add_executable(ctest_mvin_mvout-linux ${BUCKYBALL_CTEST_DIR}/mvin_mvout.c)

# add_custom_target(buckyball-CTest-linux ALL DEPENDS
#   ctest_mvin_mvout-linux
#   COMMENT "Building linux workloads for Buckyball"
#   VERBATIM)

#-------------------------------------------------------------------------------
# build baremetal version workload
#-------------------------------------------------------------------------------

set(C_FLAGS -std=gnu11 -g -DCHECK=1 -fno-common -O2 -static 
  -fno-builtin-printf -specs=htif_nano.specs -I${BUCKYBALL_CTEST_DIR})

set(ELF_CC "riscv64-unknown-elf-gcc")

add_custom_target(buckyball-workload-baremetal ALL
  COMMAND ${ELF_CC} ${C_FLAGS} -o ${BINARY_OUTPUT_DIR}/ctest_sparse-baremetal
      ${BUCKYBALL_CTEST_DIR}/sparse/sparse.c ${BUCKYBALL_CTEST_DIR}/sparse/matrix_generator.c
  COMMAND ${ELF_CC} ${C_FLAGS} -o ${BINARY_OUTPUT_DIR}/ctest_mvin_mvout-baremetal
      ${BUCKYBALL_CTEST_DIR}/mvin_mvout.c
  DEPENDS ${BUCKYBALL_CTEST_DIR}/sparse/sparse.c ${BUCKYBALL_CTEST_DIR}/sparse/matrix_generator.c ${BUCKYBALL_CTEST_DIR}/mvin_mvout.c
  COMMENT "Building baremetal workloads for Buckyball to ${BINARY_OUTPUT_DIR}"
  VERBATIM)


add_custom_target(buckyball-workload ALL DEPENDS
  buckyball-workload-baremetal
  )
