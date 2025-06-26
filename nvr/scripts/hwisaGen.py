#!/usr/bin/env python3
"""
硬件ISA代码生成器 - 为buckyball.cc生成C++结构体定义
"""

import json
import os
import sys

def evaluate_expression(expr, config):
    """计算包含配置变量的表达式"""
    hw_config = config.get('hardware_config', {})
    for var_name, var_value in hw_config.items():
        expr = expr.replace(var_name, str(var_value))
    try:
        return eval(expr)
    except:
        return expr

def parse_bit_range(bit_range, config):
    """解析位范围字符串，返回(高位, 低位)"""
    if ':' in bit_range:
        high_expr, low_expr = bit_range.split(':')
        high = evaluate_expression(high_expr, config)
        low = evaluate_expression(low_expr, config)
        return int(high), int(low)
    else:
        bit = evaluate_expression(bit_range, config)
        return int(bit), int(bit)

def generate_field_accessor(field_name, bit_range, config):
    """生成字段访问器代码"""
    high, low = parse_bit_range(bit_range, config)
    if high == low:
        return f"  uint32_t {field_name}() const {{ return (value >> {low}) & 0x1; }}"
    else:
        width = high - low + 1
        mask = (1 << width) - 1
        return f"  uint32_t {field_name}() const {{ return (value >> {low}) & 0x{mask:X}; }}"

def generate_struct_definition(reg_name, reg_format, config):
    """生成单个寄存器格式的结构体定义"""
    struct_name = f"{reg_name}_t"
    
    code = []
    code.append(f"struct {struct_name} {{")
    code.append(f"  uint64_t value;")
    code.append(f"  explicit {struct_name}(uint64_t val) : value(val) {{}}")
    code.append("")
    
    for field_name, field_info in reg_format.get('fields', {}).items():
        bit_range = field_info.get('bits')
        accessor = generate_field_accessor(field_name, bit_range, config)
        code.append(accessor)
    
    code.append("};")
    code.append("")
    
    return '\n'.join(code)

def generate_header_file(config, output_file):
    """生成完整的头文件"""
    code = []
    code.append("#ifndef BUCKYBALL_HWPARAM_H")
    code.append("#define BUCKYBALL_HWPARAM_H")
    code.append("")
    code.append("#include <cstdint>")
    code.append("")
    
    # 硬件配置常量
    hw_config = config.get('hardware_config', {})
    if hw_config:
        for var_name, var_value in hw_config.items():
            code.append(f"#define {var_name} {var_value}")
        code.append("")
    
    # 结构体定义
    register_formats = config.get('register_formats', {})
    for reg_name, reg_format in register_formats.items():
        code.append(generate_struct_definition(reg_name, reg_format, config))
    
    # 指令功能码宏
    instructions = config.get('instructions', {})
    if instructions:
        for instr_name, instr_info in instructions.items():
            funct7 = instr_info.get('funct7')
            if funct7 is not None:
                macro_name = f"{instr_name.upper()}_FUNCT"
                code.append(f"#define {macro_name} {funct7}")
                if instr_name.startswith('bb_'):
                    legacy_name = instr_name[3:].upper() + '_funct'
                    code.append(f"#define {legacy_name} {funct7}")
        code.append("")
    
    code.append("#endif // BUCKYBALL_HWPARAM_H")
    
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w') as f:
        f.write('\n'.join(code))
    
    print(f"Generated: {output_file}")

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_paths = [
        os.path.join(script_dir, '..', 'buckyballConfig.json'),  # nvr/buckyballConfig.json
        os.path.join(script_dir, '..', 'buckyball', 'buckyballConfig.json'),  # nvr/buckyball/buckyballConfig.json
        os.path.join(script_dir, 'buckyballConfig.json'),  # scripts/buckyballConfig.json
        'buckyballConfig.json'  # 当前目录
    ]
    
    config_path = None
    for path in config_paths:
        if os.path.exists(path):
            config_path = path
            break
    
    if config_path is None:
        print("Error: Configuration file buckyballConfig.json not found")
        sys.exit(1)
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    
    output_file = os.path.join(script_dir, '..', 'buckyball', 'buckyball_hwparam.h')
    generate_header_file(config, output_file)

if __name__ == "__main__":
    main() 