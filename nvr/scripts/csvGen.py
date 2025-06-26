#!/usr/bin/env python3
"""
指令执行统计分析工具
支持JSON格式的指令执行统计文件分析
集成自定义BuckyBall指令解析
"""

import sys
import os
import subprocess
import json
import csv
import re

# 导入自定义指令解析模块
try:
    from customInst import decode_r_type_instruction, get_instruction_info, get_register_name, load_instruction_config
except ImportError:
    # 如果在scripts目录外运行，尝试添加scripts目录到路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(script_dir)
    from customInst import decode_r_type_instruction, get_instruction_info, get_register_name, load_instruction_config

def classify_instruction_type(instruction):
    """分类指令类型：运算 或 访存"""
    if not instruction or instruction == "unknown":
        return "未知"
    
    instr_lower = instruction.lower()
    
    # 访存指令
    memory_instrs = [
        'lb', 'lh', 'lw', 'ld', 'lbu', 'lhu', 'lwu',  # 加载指令
        'sb', 'sh', 'sw', 'sd',  # 存储指令
        'flw', 'fld', 'fsw', 'fsd',  # 浮点访存
        'bb_mvin', 'bb_mvout'  # 自定义访存指令
    ]
    
    # 检查是否是访存指令
    for mem_instr in memory_instrs:
        if instr_lower.startswith(mem_instr):
            return "访存"
    
    # 其他都归类为运算指令
    return "运算"

def calculate_instruction_cycles(instruction, executions, l1_misses=0, l2_misses=0):
    """计算指令执行周期数"""
    if not instruction or instruction == "unknown" or executions == 0:
        return 0
    
    instr_type = classify_instruction_type(instruction)
    base_cycles = 0
    
    if instr_type == "访存":
        # 访存指令基础周期：1 cycle
        base_cycles = 1 * executions
        # L1缺失增加10个周期，L2缺失增加100个周期
        cache_penalty = l1_misses * 10 + l2_misses * 100
        return base_cycles + cache_penalty
    else:
        # 运算指令基础周期：1 cycle
        return 1 * executions

def format_instruction(disasm_str):
    """统一格式化指令显示"""
    if not disasm_str or disasm_str == "unknown":
        return disasm_str
    
    # 处理自定义指令
    if disasm_str.startswith('bb_'):
        parts = disasm_str.split(' ', 1)
        if len(parts) == 2:
            instr_name = parts[0]
            operands = parts[1]
            return f"{instr_name:<16} {operands}"
        else:
            return f"{disasm_str:<16}"
    
    # 处理标准RISC-V指令
    # 移除多余的空格和制表符
    disasm_str = re.sub(r'\s+', ' ', disasm_str.strip())
    
    # 分离指令名和操作数
    parts = disasm_str.split(' ', 1)
    if len(parts) == 2:
        instr_name, operands = parts
        # 统一指令名长度为16字符
        return f"{instr_name:<16} {operands}"
    else:
        # 只有指令名，没有操作数
        return f"{parts[0]:<16}"

def decode_custom_instruction(pc_addr, binary_path=None):
    """尝试解析自定义指令"""
    if not binary_path or not os.path.exists(binary_path):
        return None
    
    try:
        # 使用objdump获取机器码
        cmd = f"riscv64-unknown-elf-objdump -d -M no-aliases --start-address=0x{pc_addr:x} --stop-address=0x{pc_addr+4:x} {binary_path}"
        result = subprocess.run(cmd.split(), capture_output=True, text=True)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            for line in lines:
                if ':' in line and not line.strip().startswith('Disassembly'):
                    parts = line.split('\t')
                    if len(parts) >= 2:
                        # 提取机器码 (hex)
                        machine_code_str = parts[1].strip()
                        if len(machine_code_str) == 8:  # 32位指令
                            machine_code = int(machine_code_str, 16)
                            decoded = decode_r_type_instruction(f"{machine_code:08x}")
                            
                            # 使用customInst模块的功能
                            instr_name, instr_type = get_instruction_info(decoded['funct7'], decoded['funct3'], decoded['opcode'])
                            
                            # 检查是否是自定义指令，只返回指令名
                            if instr_name.startswith('bb_'):
                                return instr_name
        
        return None
    except Exception as e:
        print(f"Debug: decode_custom_instruction error: {e}")
        return None

def disassemble_instruction(pc_addr, binary_path=None):
    """反汇编指定地址的指令，优先识别自定义指令"""
    # 首先尝试解析自定义指令
    custom_inst = decode_custom_instruction(pc_addr, binary_path)
    if custom_inst:
        return format_instruction(custom_inst)
    
    # 否则使用标准objdump
    if binary_path and os.path.exists(binary_path):
        try:
            cmd = f"riscv64-unknown-elf-objdump -d -M no-aliases --start-address=0x{pc_addr:x} --stop-address=0x{pc_addr+4:x} {binary_path}"
            result = subprocess.run(cmd.split(), capture_output=True, text=True)
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    if ':' in line and not line.strip().startswith('Disassembly'):
                        parts = line.split('\t')
                        if len(parts) >= 3:
                            return format_instruction(parts[2].strip())
                        elif len(parts) >= 2:
                            asm_part = parts[1].split()
                            if len(asm_part) >= 2:
                                return format_instruction(' '.join(asm_part[1:]))
            return "unknown"
        except Exception:
            return "unknown"
    else:
        return "unknown"

def analyze_json_profile(profile_file, binary_path=None):
    """分析JSON格式的指令执行统计文件"""
    try:
        with open(profile_file, 'r') as f:
            data = json.load(f)
        
        instructions = data.get('instructions', [])
        performance_counters = data.get('performance_counters', {})
        total_instructions = data.get('total_instructions', 0)
        
        print(f"📊 分析文件: {profile_file}")
        if binary_path:
            print(f"🔧 二进制文件: {binary_path}")
        
        # 显示性能计数器
        print(f"\n🎯 性能计数器:")
        print(f"  总指令数: {total_instructions:,}")
        print(f"  唯一PC数: {data.get('unique_pcs', 0):,}")
        print(f"  L1缺失数: {performance_counters.get('l1_dcache_misses', 0):,}")
        print(f"  L2缺失数: {performance_counters.get('l2_dcache_misses', 0):,}")
        print(f"  平均IPC: {performance_counters.get('ipc', 0):.3f}")
        
        # 添加反汇编信息、指令类型和执行周期
        for inst in instructions:
            pc_str = inst['pc']
            pc_addr = int(pc_str, 16) if pc_str.startswith('0x') else int(pc_str)
            inst['disasm'] = disassemble_instruction(pc_addr, binary_path)
            executions = inst.get('executions', inst.get('count', 0))
            l1_misses = inst.get('l1_cache_misses', inst.get('cache_misses', 0))
            l2_misses = inst.get('l2_cache_misses', 0)
            
            # 计算cache miss率
            l1_miss_rate = (l1_misses / executions * 100) if executions > 0 else 0.0
            l2_miss_rate = (l2_misses / executions * 100) if executions > 0 else 0.0
            
            inst['l1_miss_rate'] = l1_miss_rate
            inst['l2_miss_rate'] = l2_miss_rate
            inst['instruction_type'] = classify_instruction_type(inst['disasm'])
            inst['exec_cycles'] = calculate_instruction_cycles(inst['disasm'], executions, l1_misses, l2_misses)
        
        # 按执行次数排序并显示所有指令
        instructions.sort(key=lambda x: x.get('executions', x.get('count', 0)), reverse=True)
        
        
        
        # 生成CSV文件
        csv_file = str(profile_file).replace('.json', '_analyzed.csv')
        with open(csv_file, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['PC地址', '执行次数', 'L1缺失次数', 'L2缺失次数', 'L1缺失率', 'L2缺失率', '指令', '执行周期', '指令类型'])
            for inst in instructions:
                executions = inst.get('executions', inst.get('count', 0))
                l1_misses = inst.get('l1_cache_misses', inst.get('cache_misses', 0))
                l2_misses = inst.get('l2_cache_misses', 0)
                writer.writerow([
                    inst['pc'], 
                    executions,
                    l1_misses,
                    l2_misses,
                    f"{inst['l1_miss_rate']:.2f}%",
                    f"{inst['l2_miss_rate']:.2f}%",
                    inst['disasm'],
                    inst['exec_cycles'],
                    inst['instruction_type']
                ])
        
        print(f"\n✅ CSV分析结果已保存到: {csv_file}")
        return instructions
        
    except Exception as e:
        print(f"❌ 分析JSON文件错误: {e}")
        return []

def main():
    if len(sys.argv) < 2:
        print("用法: python3 csvGen.py <profile_file> [binary_file]")
        print("示例: python3 csvGen.py instruction_profile_core0.json hello-baremetal")
        sys.exit(1)
    
    profile_file = sys.argv[1]
    binary_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not os.path.exists(profile_file):
        print(f"❌ 找不到文件 {profile_file}")
        sys.exit(1)
    
    if profile_file.endswith('.json'):
        analyze_json_profile(profile_file, binary_path)
    else:
        print("❌ 只支持JSON格式文件")

if __name__ == "__main__":
    main() 