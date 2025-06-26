#ifndef BUCKYBALL_PARAMS_H
#define BUCKYBALL_PARAMS_H

#include <stdint.h>
#include <limits.h>

typedef int8_t elem_t;
static const elem_t elem_t_max = 127;
static const elem_t elem_t_min = -128;

#define row_align(blocks) __attribute__((aligned(blocks*DIM*sizeof(elem_t))))

#endif // BUCKYBALL_PARAMS_H