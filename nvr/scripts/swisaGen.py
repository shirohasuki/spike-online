#!/usr/bin/env python3
"""
软件ISA代码生成器 - 为workload生成用户空间指令宏和内联汇编
"""

import json
import os
import sys

def evaluate_expression(expr, config):
    """计算包含配置变量的表达式"""
    hw_config = config.get('hardware_config', {})
    
    # 替换配置变量
    for var_name, var_value in hw_config.items():
        expr = expr.replace(var_name, str(var_value))
    
    # 安全计算表达式
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

def get_register_fields(reg_format_name, config):
    """获取寄存器格式的所有字段信息"""
    register_formats = config.get('register_formats', {})
    reg_format = register_formats.get(reg_format_name, {})
    return reg_format.get('fields', {})

def generate_encoding_functions(instr_name, instr_info, config):
    """为指令生成编码辅助函数，避免汇编器处理复杂宏的问题"""
    register_formats = instr_info.get('register_formats', [])
    if len(register_formats) < 2:
        return ""
    
    # 获取rs1和rs2的字段信息
    rs1_fields = get_register_fields(register_formats[0], config) if len(register_formats) >= 1 else {}
    rs2_fields = get_register_fields(register_formats[1], config) if len(register_formats) >= 2 else {}
    
    # 生成函数名前缀
    func_prefix = instr_name.lower()
    if func_prefix.startswith('bb_'):
        func_prefix = func_prefix[3:]
    
    code = []
    
    # 为rs1生成编码函数（如果有多个字段）
    if len(rs1_fields) > 1:
        field_names = list(rs1_fields.keys())
        param_decls = [f"uint32_t {name}" for name in field_names]
        params = ', '.join(param_decls)
        
        # 构建位操作表达式
        expressions = []
        for field_name, field_info in rs1_fields.items():
            bit_range = field_info.get('bits')
            high, low = parse_bit_range(bit_range, config)
            if high > low:
                width = high - low + 1
                mask = f"((1UL << {width}) - 1)"
                if low > 0:
                    expr = f"(({field_name}) & {mask}) << {low}"
                else:
                    expr = f"({field_name}) & {mask}"
            else:
                expr = f"(({field_name}) & 0x1) << {low}"
            expressions.append(expr)
        
        encoding_expr = ' | '.join(expressions)
        code.append(f"static inline uint32_t encode_{func_prefix}_rs1({params}) {{")
        code.append(f"    return {encoding_expr};")
        code.append("}")
    
    # 为rs2生成编码函数（如果有多个字段）
    if len(rs2_fields) > 1:
        field_names = list(rs2_fields.keys())
        param_decls = [f"uint32_t {name}" for name in field_names]
        params = ', '.join(param_decls)
        
        # 构建位操作表达式
        expressions = []
        for field_name, field_info in rs2_fields.items():
            bit_range = field_info.get('bits')
            high, low = parse_bit_range(bit_range, config)
            if high > low:
                width = high - low + 1
                mask = f"((1UL << {width}) - 1)"
                if low > 0:
                    expr = f"(({field_name}) & {mask}) << {low}"
                else:
                    expr = f"({field_name}) & {mask}"
            else:
                expr = f"(({field_name}) & 0x1) << {low}"
            expressions.append(expr)
        
        encoding_expr = ' | '.join(expressions)
        code.append(f"static inline uint32_t encode_{func_prefix}_rs2({params}) {{")
        code.append(f"    return {encoding_expr};")
        code.append("}")
    
    if code:
        code.append("")
    return '\n'.join(code)

def generate_instruction_macro(instr_name, instr_info, config):
    """生成指令的内联汇编宏，使用.insn指令格式"""
    funct7 = instr_info.get('funct7')
    operands = instr_info.get('operands', [])
    
    # 生成宏名（去掉bb_前缀，转大写）
    macro_name = instr_name.upper()
    if macro_name.startswith('BB_'):
        macro_name = macro_name[3:]
    
    code = []
    opcode = config.get("opcode", "0x7B")
    
    if len(operands) == 0:
        # 无操作数指令
        code.append(f"#define {macro_name}() \\")
        code.append(f'    asm volatile(".insn r {opcode}, 0x3, {funct7}, x0, x0, x0" ::: "memory")')
    elif len(operands) == 2:
        # 双操作数指令
        code.append(f"#define {macro_name}(rs1, rs2) \\")
        code.append(f'    asm volatile(".insn r {opcode}, 0x3, {funct7}, x0, %0, %1" :: "r"(rs1), "r"(rs2) : "memory")')
    
    code.append("")
    return '\n'.join(code)

def generate_high_level_function(instr_name, instr_info, config):
    """为指令生成高级封装函数"""
    register_formats = instr_info.get('register_formats', [])
    
    # 生成函数名
    func_name = f"bb_{instr_name[3:]}" if instr_name.startswith('bb_') else f"bb_{instr_name}"
    macro_name = instr_name.upper()
    if macro_name.startswith('BB_'):
        macro_name = macro_name[3:]
    
    # 收集所有参数
    all_params = []
    rs1_encoding = "rs1"
    rs2_encoding = "rs2"
    
    if len(register_formats) >= 1:
        rs1_fields = get_register_fields(register_formats[0], config)
        if len(rs1_fields) == 1:
            # 单个字段，直接使用
            field_name = list(rs1_fields.keys())[0]
            all_params.append(f"uint32_t {field_name}")
            rs1_encoding = field_name
        elif len(rs1_fields) > 1:
            # 多个字段，需要编码
            for field_name in rs1_fields.keys():
                all_params.append(f"uint32_t {field_name}")
            field_names = ', '.join(rs1_fields.keys())
            rs1_encoding = f"ENCODE_{macro_name}_RS1({field_names})"
    
    if len(register_formats) >= 2:
        rs2_fields = get_register_fields(register_formats[1], config)
        if len(rs2_fields) == 1:
            # 单个字段，直接使用
            field_name = list(rs2_fields.keys())[0]
            all_params.append(f"uint32_t {field_name}")
            rs2_encoding = field_name
        elif len(rs2_fields) > 1:
            # 多个字段，需要编码
            for field_name in rs2_fields.keys():
                all_params.append(f"uint32_t {field_name}")
            field_names = ', '.join(rs2_fields.keys())
            rs2_encoding = f"ENCODE_{macro_name}_RS2({field_names})"
    
    if not all_params:
        # 无参数指令
        return f"#define {func_name}() \\\n    {macro_name}()\n\n"
    
    # 有参数指令，生成 do-while(0) 宏
    params_str = ', '.join([name for param in all_params for name in [param.split()[-1]]])  # 只取参数名
    code_lines = []
    code_lines.append(f"#define {func_name}({params_str}) \\")
    code_lines.append("    do { \\")
    
    # 如果需要编码，在宏中计算编码值
    if len(register_formats) >= 1 and len(get_register_fields(register_formats[0], config)) > 1:
        rs1_fields = get_register_fields(register_formats[0], config)
        expressions = []
        for field_name, field_info in rs1_fields.items():
            bit_range = field_info.get('bits')
            high, low = parse_bit_range(bit_range, config)
            if high > low:
                width = high - low + 1
                mask = f"((1UL << {width}) - 1)"
                if low > 0:
                    expr = f"(({field_name}) & {mask}) << {low}"
                else:
                    expr = f"({field_name}) & {mask}"
            else:
                expr = f"(({field_name}) & 0x1) << {low}"
            expressions.append(expr)
        encoding_expr = ' | '.join(expressions)
        code_lines.append(f"        uint32_t encoded_rs1 = {encoding_expr}; \\")
        rs1_var = "encoded_rs1"
    else:
        rs1_var = rs1_encoding
    
    if len(register_formats) >= 2 and len(get_register_fields(register_formats[1], config)) > 1:
        rs2_fields = get_register_fields(register_formats[1], config)
        expressions = []
        for field_name, field_info in rs2_fields.items():
            bit_range = field_info.get('bits')
            high, low = parse_bit_range(bit_range, config)
            if high > low:
                width = high - low + 1
                mask = f"((1UL << {width}) - 1)"
                if low > 0:
                    expr = f"(({field_name}) & {mask}) << {low}"
                else:
                    expr = f"({field_name}) & {mask}"
            else:
                expr = f"(({field_name}) & 0x1) << {low}"
            expressions.append(expr)
        encoding_expr = ' | '.join(expressions)
        code_lines.append(f"        uint32_t encoded_rs2 = {encoding_expr}; \\")
        rs2_var = "encoded_rs2"
    else:
        rs2_var = rs2_encoding
    
    # 生成调用语句
    if len(register_formats) == 2:
        call_str = f"        {macro_name}({rs1_var}, {rs2_var}); \\"
    elif len(register_formats) == 1:
        call_str = f"        {macro_name}({rs1_var}, 0); \\"
    else:
        call_str = f"        {macro_name}(); \\"
    
    code_lines.append(call_str)
    code_lines.append("    } while(0)")
    
    return '\n'.join(code_lines) + "\n\n"

def generate_header_file(config, output_file):
    """生成完整的用户空间头文件"""
    code = []
    code.append("#ifndef BUCKYBALL_SWPARAM_H")
    code.append("#define BUCKYBALL_SWPARAM_H")
    code.append("")
    code.append("#include <stdint.h>")
    code.append("")
    
    # 硬件配置常量
    hw_config = config.get('hardware_config', {})
    for var_name, var_value in hw_config.items():
        code.append(f"#define {var_name} {var_value}")
    code.append("")
    
    # 不再需要单独的编码函数，直接在用户函数内部编码
    
    # 指令宏
    instructions = config.get('instructions', {})
    for instr_name, instr_info in instructions.items():
        code.append(generate_instruction_macro(instr_name, instr_info, config))
    
    # 高级函数
    for instr_name, instr_info in instructions.items():
        code.append(generate_high_level_function(instr_name, instr_info, config))
    
    code.append("#endif // BUCKYBALL_SWPARAM_H")
    
    # 写入文件
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    with open(output_file, 'w') as f:
        f.write('\n'.join(code))
    
    print(f"Generated: {output_file}")

def main():
    # 查找配置文件
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
    
    # 加载配置
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception as e:
        print(f"Error: Cannot load configuration file: {e}")
        sys.exit(1)
    
    # 生成头文件
    output_file = os.path.join(script_dir, '..', 'workload', 'buckyball_swparam.h')
    generate_header_file(config, output_file)
    
    print("Software ISA code generation completed!")

if __name__ == "__main__":
    main() 