#!/usr/bin/env python3
"""
HTML报告生成器
反汇编可执行文件并生成交互式性能分析报告
"""

import sys
import pandas as pd
import json
import subprocess
import re
import os
from datetime import datetime
from pathlib import Path

# 导入自定义指令解析模块
try:
    from customInst import decode_r_type_instruction, get_instruction_info, get_register_name, format_buckyball_instruction
except ImportError:
    # 如果在scripts目录外运行，尝试添加scripts目录到路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.append(script_dir)
    from customInst import decode_r_type_instruction, get_instruction_info, get_register_name, format_buckyball_instruction

def parse_custom_instruction(addr, machine_code, instruction):
    """解析自定义指令"""
    try:
        # 检查是否是 .insn 格式的自定义指令
        if '.insn' in instruction and '0x' in instruction:
            # 提取机器码
            insn_match = re.search(r'\.insn\s+\d+,\s*0x([0-9a-fA-F]+)', instruction)
            if insn_match:
                opcode_hex = insn_match.group(1)
                
                # 使用 customInst.py 解析
                decoded = decode_r_type_instruction(opcode_hex)
                instr_name, instr_type = get_instruction_info(decoded['funct7'], decoded['funct3'], decoded['opcode'])
                
                # 如果是自定义指令，格式化显示
                if instr_name.startswith('bb_'):
                    formatted = format_buckyball_instruction(instr_name, decoded['rs1'], decoded['rs2'], decoded['rd'])
                    return formatted.strip()
        
        # 也检查是否已经是未知的机器码格式
        if len(machine_code.replace(' ', '')) == 8:  # 32位指令
            try:
                opcode_hex = machine_code.replace(' ', '')
                decoded = decode_r_type_instruction(opcode_hex)
                instr_name, instr_type = get_instruction_info(decoded['funct7'], decoded['funct3'], decoded['opcode'])
                
                # 如果是自定义指令，格式化显示
                if instr_name.startswith('bb_'):
                    formatted = format_buckyball_instruction(instr_name, decoded['rs1'], decoded['rs2'], decoded['rd'])
                    return formatted.strip()
            except:
                pass
                
    except Exception as e:
        # 如果解析失败，返回原指令
        pass
    
    return instruction

def disassemble_binary(binary_file):
    """反汇编二进制文件"""
    try:
        print(f"🔍 反汇编文件: {binary_file}")
        
        # 使用RISC-V objdump反汇编
        result = subprocess.run(
            ['riscv64-unknown-elf-objdump', '-d', '-M', 'no-aliases', binary_file],
            capture_output=True,
            text=True,
            check=True
        )
        
        disasm_data = {}
        current_function = None
        
        for line in result.stdout.split('\n'):
            line = line.strip()
            if not line:
                continue
                
            # 检测函数开始
            if re.match(r'^[0-9a-fA-F]+ <.*>:$', line):
                current_function = line
                continue
                
            # 解析指令行 (支持压缩指令和标准指令)
            match = re.match(r'^\s*([0-9a-fA-F]+):\s+([0-9a-fA-F\s]+)\s+(.+)$', line)
            if match:
                addr = match.group(1).lower()  # 统一转为小写
                machine_code = match.group(2).strip()
                instruction = match.group(3).strip()
                
                # 尝试解析自定义指令
                parsed_instruction = parse_custom_instruction(addr, machine_code, instruction)
                
                disasm_data[addr] = {
                    'addr': addr,
                    'machine_code': machine_code,
                    'instruction': parsed_instruction,
                    'function': current_function
                }
        
        print(f"📝 解析了 {len(disasm_data)} 条指令")
        return disasm_data
        
    except subprocess.CalledProcessError as e:
        print(f"❌ 反汇编失败: {e}")
        return {}
    except FileNotFoundError:
        print("❌ 未找到objdump工具，请安装binutils")
        return {}

def merge_performance_data(disasm_data, csv_file=None):
    """合并性能数据和已解析的指令（如果提供CSV文件）"""
    if not csv_file or not Path(csv_file).exists():
        return disasm_data
        
    try:
        df = pd.read_csv(csv_file, encoding='utf-8')
        print(f"📊 读取性能数据: {csv_file}")
        print(f"📋 CSV包含 {len(df)} 条热点指令数据")
        
        # CSV格式: PC地址, 执行次数, L1缺失次数, L2缺失次数, L1缺失率, L2缺失率, 指令, 执行周期, 指令类型
        for _, row in df.iterrows():
            pc_str = str(row.iloc[0]).lower()
            # 去掉0x前缀如果存在
            if pc_str.startswith('0x'):
                pc_str = pc_str[2:]
            count = int(row.iloc[1])
            l1_miss = int(row.iloc[2])
            l2_miss = int(row.iloc[3])
            l1_miss_rate = str(row.iloc[4])  # 缺失率（字符串格式，如"5.23%"）
            l2_miss_rate = str(row.iloc[5])  # 缺失率（字符串格式，如"1.45%"）
            csv_instruction = str(row.iloc[6])  # csvGen.py已解析的指令（包含自定义指令）
            
            # 尝试获取执行时间（第8列）
            exec_time = 0
            if len(row) > 7:
                try:
                    exec_time = int(row.iloc[7])
                except:
                    exec_time = 0
            
            # 查找对应的反汇编数据
            if pc_str in disasm_data:
                # 更新性能数据，优先使用CSV中已正确解析的指令
                update_data = {
                    'count': count,
                    'l1_miss': l1_miss,
                    'l2_miss': l2_miss,
                    'exec_time': exec_time,
                    'has_perf_data': True
                }
                
                # 如果CSV中的指令解析更好（包含自定义指令名），则使用CSV的解析结果
                if csv_instruction and not csv_instruction.startswith('unknown'):
                    update_data['instruction'] = csv_instruction
                
                disasm_data[pc_str].update(update_data)
        
        print(f"✅ 合并了性能数据和已解析的指令")
        return disasm_data
        
    except Exception as e:
        print(f"⚠️ 读取性能数据失败: {e}")
        return disasm_data

def generate_html_report(binary_file, csv_file=None):
    """生成HTML报告"""
    try:
        # 反汇编二进制文件
        disasm_data = disassemble_binary(binary_file)
        if not disasm_data:
            return False
            
        # 合并性能数据
        disasm_data = merge_performance_data(disasm_data, csv_file)
        
        # 生成HTML内容
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        binary_name = Path(binary_file).name
        
        # 转换数据为JSON格式
        table_data = []
        for addr, data in sorted(disasm_data.items()):
            table_data.append(data)
        
        html_content = f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title> 反汇编分析 - {binary_name}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            background-color: #1e1e1e;
            color: #d4d4d4;
            line-height: 1.4;
        }}
        
        .header {{
            background-color: #2d2d30;
            padding: 20px;
            border-bottom: 2px solid #007acc;
        }}
        
        .title {{
            font-size: 24px;
            color: #007acc;
            margin-bottom: 10px;
        }}
        
        .file-info {{
            background-color: #252526;
            padding: 10px;
            border-radius: 4px;
            font-size: 12px;
            color: #cccccc;
        }}
        
        .controls {{
            background-color: #2d2d30;
            padding: 15px 20px;
            border-bottom: 1px solid #3c3c3c;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }}
        
        .search-box {{
            background-color: #3c3c3c;
            border: 1px solid #464647;
            padding: 6px 10px;
            color: #cccccc;
            border-radius: 3px;
            font-family: inherit;
            min-width: 200px;
        }}
        
        .search-box:focus {{
            outline: none;
            border-color: #007acc;
        }}
        
        .btn {{
            background-color: #0e639c;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-family: inherit;
            font-size: 12px;
        }}
        
        .btn:hover {{
            background-color: #1177bb;
        }}
        
        .btn.mark-btn {{
            background-color: #e74c3c;
            font-size: 11px;
            padding: 4px 8px;
        }}
        
        .btn.mark-btn:hover {{
            background-color: #c0392b;
        }}
        
        .stats {{
            color: #cccccc;
            font-size: 12px;
            display: flex;
            gap: 20px;
            align-items: center;
        }}
        
        .stat-item {{
            background-color: #252526;
            padding: 8px 12px;
            border-radius: 3px;
            border-left: 3px solid #007acc;
        }}
        
        .stat-number {{
            font-weight: bold;
            color: #dcdcaa;
        }}
        
        .container {{
            display: flex;
            height: calc(100vh - 140px);
        }}
        
        .sidebar {{
            width: 300px;
            background-color: #252526;
            border-right: 1px solid #3c3c3c;
            overflow-y: auto;
        }}
        
        .function-list {{
            padding: 10px;
        }}
        
        .function-item {{
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 3px;
            margin-bottom: 2px;
            border-left: 3px solid transparent;
        }}
        
        .function-item:hover {{
            background-color: #2a2d2e;
        }}
        
        .function-item.active {{
            background-color: #094771;
            border-left-color: #007acc;
        }}
        
        .function-name {{
            font-weight: bold;
            font-size: 13px;
            color: #dcdcaa;
        }}
        
        .function-addr {{
            font-size: 11px;
            color: #888888;
            margin-top: 2px;
        }}
        
        .function-stats {{
            font-size: 10px;
            color: #608b4e;
            margin-top: 2px;
        }}
        
        .main-content {{
            flex: 1;
            overflow-y: auto;
            padding: 0;
        }}
        
        .function-block {{
            margin-bottom: 0;
            background-color: #252526;
            border-bottom: 1px solid #3c3c3c;
        }}
        
        .function-header {{
            background-color: #2d2d30;
            padding: 12px 16px;
            border-bottom: 1px solid #3c3c3c;
            position: sticky;
            top: 0;
            z-index: 10;
        }}
        
        .function-title {{
            font-size: 16px;
            font-weight: bold;
            color: #dcdcaa;
        }}
        
        .function-address {{
            font-size: 12px;
            color: #888888;
            margin-left: 10px;
        }}
        
        .instructions {{
            padding: 0;
        }}
        
        .instruction {{
            display: flex;
            padding: 6px 16px;
            border-bottom: 1px solid #2d2d30;
            font-size: 13px;
            line-height: 1.5;
            position: relative;
            cursor: pointer;
        }}
        
        .instruction:hover {{
            background-color: #2a2d2e;
        }}
        
        .instruction.highlight {{
            background-color: #264f78;
        }}
        
        
        
        .instruction.current-search-result {{
            background-color: #5a5a00 !important;
            border-left: 3px solid #ffcc00;
        }}
        
        .addr {{
            width: 100px;
            color: #888888;
            font-size: 11px;
            margin-right: 15px;
            flex-shrink: 0;
        }}
        
        .hex {{
            width: 120px;
            color: #b5cea8;
            font-size: 11px;
            margin-right: 15px;
            flex-shrink: 0;
        }}
        
        .mnemonic {{
            width: 300px;
            color: #569cd6;
            margin-right: 15px;
            flex-shrink: 0;
        }}
        
        .perf-count {{
            width: 100px;
            color: #ff6b6b;
            font-weight: bold;
            margin-right: 15px;
            flex-shrink: 0;
            text-align: right;
        }}
        
                 .perf-miss {{
             width: 80px;
             color: #ffa500;
             margin-right: 15px;
             flex-shrink: 0;
             text-align: right;
         }}
         
         .perf-time {{
             width: 100px;
             color: #9cdcfe;
             margin-right: 15px;
             flex-shrink: 0;
             text-align: right;
         }}
         
         .perf-l2miss {{
             width: 80px;
             color: #ff9900;
             margin-right: 15px;
             flex-shrink: 0;
             text-align: right;
         }}
        
        .actions {{
            flex-shrink: 0;
        }}
        
        .no-results {{
            text-align: center;
            color: #888888;
            padding: 40px;
            font-style: italic;
        }}
        
        /* 滚动条样式 */
        ::-webkit-scrollbar {{
            width: 8px;
            height: 8px;
        }}
        
        ::-webkit-scrollbar-track {{
            background: #2d2d30;
        }}
        
        ::-webkit-scrollbar-thumb {{
            background: #464647;
            border-radius: 4px;
        }}
        
        ::-webkit-scrollbar-thumb:hover {{
            background: #5a5a5a;
        }}
        
        /* 响应式设计 */
        @media (max-width: 768px) {{
            .container {{
                flex-direction: column;
                height: auto;
            }}
            
            .sidebar {{
                width: 100%;
                max-height: 200px;
            }}
            
            .main-content {{
                height: auto;
            }}
            
            .controls {{
                flex-direction: column;
                align-items: stretch;
            }}
            
            .search-box {{
                min-width: auto;
            }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🔍 RISC-V 反汇编分析</div>
        <div class="file-info">文件: {binary_name} | 生成时间: {current_time}</div>
    </div>
    
    <div class="controls">
        <input type="text" id="searchBox" class="search-box" placeholder="搜索函数、地址或指令...">
        <button id="prevSearch" class="btn" style="display:none">上一个</button>
                 <button id="nextSearch" class="btn" style="display:none">下一个</button>
         <button id="clearSearch" class="btn">清除</button>
         <button id="goToAddr" class="btn">跳转到地址</button>
         <button id="showGlobalStats" class="btn">全局统计</button>
        
                 <div class="stats">
             <div class="stat-item">
                 总指令: <span class="stat-number" id="total-instructions">-</span>
             </div>
             <div class="stat-item" id="perf-stats" style="display: none;">
                 总执行: <span class="stat-number" id="total-executions">-</span>
             </div>
             <div class="stat-item" id="time-stats" style="display: none;">
                 总时间: <span class="stat-number" id="total-time">-</span>
             </div>
             <div class="stat-item" id="l1-stats" style="display: none;">
                 L1缺失: <span class="stat-number" id="total-l1-miss">-</span>
             </div>
             <div class="stat-item" id="l2-stats" style="display: none;">
                 L2缺失: <span class="stat-number" id="total-l2-miss">-</span>
             </div>
         </div>
    </div>
    
    <div class="container">
        <div class="sidebar">
            <div class="function-list" id="function-list">
            </div>
        </div>
        
                 <div class="main-content" id="main-content">
         </div>
     </div>
     
     <!-- 全局统计弹窗 -->
     <div id="globalStatsModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000;">
         <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2d2d30; padding: 30px; border-radius: 8px; width: 80%; max-width: 1000px; max-height: 80%; overflow-y: auto;">
             <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                 <h2 style="color: #007acc; margin: 0;">全局性能统计</h2>
                 <button id="closeModal" class="btn">关闭</button>
             </div>
             <div id="globalStatsContent"></div>
         </div>
     </div>

    <script>
        const data = {json.dumps(table_data, ensure_ascii=False)};
        let hasPerformanceData = data.some(item => item.has_perf_data);
        let searchResults = [];
        let currentSearchIndex = -1;
        let lastSearchTerm = '';
        
        // 显示性能数据统计（如果有）
        if (hasPerformanceData) {{
            document.getElementById('perf-stats').style.display = 'block';
            document.getElementById('time-stats').style.display = 'block';
            document.getElementById('l1-stats').style.display = 'block';
            document.getElementById('l2-stats').style.display = 'block';
        }}
        
        // 提取纯函数名（去掉地址和符号）
        function extractFunctionName(fullName) {{
            if (!fullName || fullName === '<unknown>') return fullName;
            
            // 移除 < 和 > 符号
            let name = fullName.replace(/[<>]/g, '');
            
            // 如果包含地址模式（16进制地址 + 空格 + 函数名 + :），提取函数名部分
            const match = name.match(/^[0-9a-fA-F]+\\s+(.+?)(:.*)?$/);
            if (match) {{
                return match[1]; // 返回函数名部分
            }}
            
            // 如果只是函数名后面跟冒号，去掉冒号
            if (name.endsWith(':')) {{
                name = name.slice(0, -1);
            }}
            
            return name;
        }}
        
        // 解析数据按函数分组
        function organizeDataByFunction() {{
            const functions = new Map();
            data.forEach(item => {{
                const funcName = item.function || '<unknown>';
                if (!functions.has(funcName)) {{
                    functions.set(funcName, {{
                        name: funcName,
                        displayName: extractFunctionName(funcName),
                        instructions: [],
                        totalCount: 0,
                        totalTime: 0,
                        totalL1Miss: 0,
                        totalL2Miss: 0
                    }});
                }}
                const func = functions.get(funcName);
                func.instructions.push(item);
                func.totalCount += item.count || 0;
                func.totalTime += item.exec_time || 0;
                func.totalL1Miss += item.l1_miss || 0;
                func.totalL2Miss += item.l2_miss || 0;
            }});
            return functions;
        }}
        
        // 提取纯函数名（去掉地址和符号）
        function extractFunctionName(fullName) {{
            if (!fullName || fullName === '<unknown>') return fullName;
            
            // 移除 < 和 > 符号
            let name = fullName.replace(/[<>]/g, '');
            
            // 如果包含地址模式（16进制地址 + 空格 + 函数名 + :），提取函数名部分
            const match = name.match(/^[0-9a-fA-F]+\\s+(.+?)(:.*)?$/);
            if (match) {{
                return match[1]; // 返回函数名部分
            }}
            
            // 如果只是函数名后面跟冒号，去掉冒号
            if (name.endsWith(':')) {{
                name = name.slice(0, -1);
            }}
            
            return name;
        }}
        
        const functionsMap = organizeDataByFunction();
        
        // 计算统计数据
        let totalInstructions = data.length;
        let totalExecutions = hasPerformanceData ? data.reduce((sum, item) => sum + (item.count || 0), 0) : 0;
        let totalTime = hasPerformanceData ? data.reduce((sum, item) => sum + (item.exec_time || 0), 0) : 0;
        let totalL1Miss = hasPerformanceData ? data.reduce((sum, item) => sum + (item.l1_miss || 0), 0) : 0;
        let totalL2Miss = hasPerformanceData ? data.reduce((sum, item) => sum + (item.l2_miss || 0), 0) : 0;
        
        // 更新统计
        document.getElementById('total-instructions').textContent = totalInstructions.toLocaleString();
        if (hasPerformanceData) {{
            document.getElementById('total-executions').textContent = totalExecutions.toLocaleString();
            document.getElementById('total-time').textContent = totalTime.toLocaleString() + ' cycles';
            document.getElementById('total-l1-miss').textContent = totalL1Miss.toLocaleString();
            document.getElementById('total-l2-miss').textContent = totalL2Miss.toLocaleString();
        }}
        
        // 渲染函数列表
        function renderFunctionList() {{
            const functionList = document.getElementById('function-list');
            functionList.innerHTML = '';
            
            functionsMap.forEach((func, name) => {{
                const item = document.createElement('div');
                item.className = 'function-item';
                item.dataset.function = name;
                
                let statsHtml = '';
                if (hasPerformanceData && func.totalCount > 0) {{
                    statsHtml = `<div class="function-stats">执行: ${{func.totalCount.toLocaleString()}} | 时间: ${{func.totalTime.toLocaleString()}} | L1: ${{func.totalL1Miss.toLocaleString()}} | L2: ${{func.totalL2Miss.toLocaleString()}}</div>`;
                }}
                
                item.innerHTML = `
                    <div class="function-name">${{extractFunctionName(name)}}</div>
                    <div class="function-addr">${{func.instructions.length}} 条指令</div>
                    ${{statsHtml}}
                `;
                
                item.addEventListener('click', () => {{
                    // 移除其他active状态
                    document.querySelectorAll('.function-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    // 滚动到函数
                    scrollToFunction(name);
                }});
                
                functionList.appendChild(item);
            }});
        }}
        
        // 渲染主内容
        function renderMainContent() {{
            const mainContent = document.getElementById('main-content');
            mainContent.innerHTML = '';
            
            functionsMap.forEach((func, name) => {{
                const block = document.createElement('div');
                block.className = 'function-block';
                block.dataset.function = name;
                
                // 函数头
                const header = document.createElement('div');
                header.className = 'function-header';
                
                let statsText = '';
                if (hasPerformanceData && func.totalCount > 0) {{
                    statsText = ` (执行: ${{func.totalCount.toLocaleString()}}, 时间: ${{func.totalTime.toLocaleString()}}, L1: ${{func.totalL1Miss.toLocaleString()}}, L2: ${{func.totalL2Miss.toLocaleString()}})`;
                }}
                
                header.innerHTML = `
                    <span class="function-title">${{extractFunctionName(name)}}</span>
                    <span class="function-address">${{func.instructions.length}} 条指令${{statsText}}</span>
                `;
                
                // 指令列表
                const instructions = document.createElement('div');
                instructions.className = 'instructions';
                
                func.instructions.forEach(item => {{
                    const instrDiv = document.createElement('div');
                    instrDiv.className = 'instruction';
                    instrDiv.dataset.addr = item.addr;
                    
                    // 只有执行过的指令才显示性能数据
                    const count = item.count || 0;
                    const execTime = item.exec_time || 0;
                    const l1Miss = item.l1_miss || 0;
                    const l2Miss = item.l2_miss || 0;
                    
                    let perfHtml = '';
                    if (count > 0 || execTime > 0 || l1Miss > 0 || l2Miss > 0) {{
                        perfHtml = `
                            <div class="perf-count">${{count.toLocaleString()}}</div>
                            <div class="perf-time">${{execTime.toLocaleString()}}</div>
                            <div class="perf-miss">${{l1Miss.toLocaleString()}}</div>
                            <div class="perf-l2miss">${{l2Miss.toLocaleString()}}</div>
                        `;
                    }}
                    
                    instrDiv.innerHTML = `
                        <div class="addr">${{item.addr}}</div>
                        <div class="hex">${{item.machine_code}}</div>
                        <div class="mnemonic">${{item.instruction}}</div>
                        ${{perfHtml}}
                    `;
                    
                    instructions.appendChild(instrDiv);
                }});
                
                block.appendChild(header);
                block.appendChild(instructions);
                mainContent.appendChild(block);
            }});
        }}
        
        // 滚动到函数
        function scrollToFunction(functionName) {{
            const block = document.querySelector(`.main-content [data-function="${{functionName}}"]`);
            if (block) {{
                block.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
                // 高亮显示目标函数
                block.style.background = '#264f78';
                setTimeout(() => {{
                    block.style.background = '';
                }}, 1000);
            }} else {{
                console.log('未找到函数:', functionName);
            }}
        }}
        
        // 搜索功能
        function performSearch(term) {{
            if (!term || term === lastSearchTerm) return;
            
            lastSearchTerm = term;
            searchResults = [];
            currentSearchIndex = -1;
            
            // 清除之前的搜索高亮
            document.querySelectorAll('.instruction').forEach(el => {{
                el.classList.remove('current-search-result', 'highlight');
            }});
            
            const lowerTerm = term.toLowerCase();
            
            // 搜索匹配的指令
            data.forEach(item => {{
                if (item.addr.toLowerCase().includes(lowerTerm) ||
                    item.instruction.toLowerCase().includes(lowerTerm) ||
                    (item.function && item.function.toLowerCase().includes(lowerTerm))) {{
                    searchResults.push(item.addr);
                }}
            }});
            
            if (searchResults.length > 0) {{
                // 高亮所有匹配结果
                searchResults.forEach(addr => {{
                    const element = document.querySelector(`[data-addr="${{addr}}"]`);
                    if (element) {{
                        element.classList.add('highlight');
                    }}
                }});
                
                // 显示导航按钮
                document.getElementById('prevSearch').style.display = 'inline-block';
                document.getElementById('nextSearch').style.display = 'inline-block';
                
                // 跳转到第一个结果
                currentSearchIndex = 0;
                jumpToSearchResult();
            }} else {{
                document.getElementById('prevSearch').style.display = 'none';
                document.getElementById('nextSearch').style.display = 'none';
            }}
        }}
        
        // 跳转到搜索结果
        function jumpToSearchResult() {{
            if (searchResults.length === 0 || currentSearchIndex < 0) return;
            
            // 清除之前的当前结果标记
            document.querySelectorAll('.current-search-result').forEach(el => {{
                el.classList.remove('current-search-result');
            }});
            
            // 标记当前结果
            const addr = searchResults[currentSearchIndex];
            const element = document.querySelector(`[data-addr="${{addr}}"]`);
            if (element) {{
                element.classList.add('current-search-result');
                element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
            }}
        }}
        

        
        // 跳转到地址
        function goToAddress() {{
            const addr = prompt('请输入地址 (例如: 10400):');
            if (addr) {{
                const normalizedAddr = addr.toLowerCase().replace(/^0x/, '');
                const element = document.querySelector(`[data-addr="${{normalizedAddr}}"]`);
                if (element) {{
                    element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
                    element.classList.add('highlight');
                    setTimeout(() => element.classList.remove('highlight'), 2000);
                }} else {{
                    alert('未找到该地址');
                }}
            }}
        }}
        
        // 显示全局统计
        function showGlobalStats() {{
            if (!hasPerformanceData) {{
                alert('没有性能数据可显示');
                return;
            }}
            
            // 计算各项统计
            const totalInstr = data.length;
            const totalExecCount = data.reduce((sum, item) => sum + (item.count || 0), 0);
            const totalExecTime = data.reduce((sum, item) => sum + (item.exec_time || 0), 0);
            const totalL1Miss = data.reduce((sum, item) => sum + (item.l1_miss || 0), 0);
            const totalL2Miss = data.reduce((sum, item) => sum + (item.l2_miss || 0), 0);
            
            // 假设数据：计算运算与访存占比（需要根据实际指令类型分析）
            let computeTime = 0;
            let memoryTime = 0;
            let cacheMissTime = 0;
            
            data.forEach(item => {{
                const execTime = item.exec_time || 0;
                const l1Miss = item.l1_miss || 0;
                const l2Miss = item.l2_miss || 0;
                
                // 简单假设：L1缺失消耗10个周期，L2缺失消耗100个周期
                const missTime = l1Miss * 10 + l2Miss * 100;
                cacheMissTime += missTime;
                
                // 简单区分：包含load/store的指令算作访存，其他算作运算
                const instr = item.instruction.toLowerCase();
                if (instr.includes('load') || instr.includes('store') || instr.includes('ld') || instr.includes('st') || instr.includes('lw') || instr.includes('sw')) {{
                    memoryTime += execTime;
                }} else {{
                    computeTime += execTime;
                }}
            }});
            
            // 计算占比
            const computeRatio = totalExecTime > 0 ? (computeTime / totalExecTime * 100).toFixed(1) : 0;
            const memoryRatio = totalExecTime > 0 ? (memoryTime / totalExecTime * 100).toFixed(1) : 0;
            const cacheMissRatio = memoryTime > 0 ? (cacheMissTime / memoryTime * 100).toFixed(1) : 0;
            
            // 获取前10耗时最多的指令
            const topInstructions = data
                .filter(item => item.exec_time > 0)
                .sort((a, b) => (b.exec_time || 0) - (a.exec_time || 0))
                .slice(0, 10);
            
                         // 计算最大执行时间用于柱状图缩放
             const maxExecTime = topInstructions.length > 0 ? Math.max(...topInstructions.map(x => x.exec_time || 0)) : 1;
             
             // 生成统计内容
             const statsContent = `
                 <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
                     <div style="background: #252526; padding: 15px; border-radius: 5px; border-left: 3px solid #007acc;">
                         <h3 style="color: #dcdcaa; margin-top: 0;">总执行次数</h3>
                         <p style="color: #ff6b6b; font-size: 24px; font-weight: bold; margin: 5px 0;">${{totalExecCount.toLocaleString()}}</p>
                     </div>
                     <div style="background: #252526; padding: 15px; border-radius: 5px; border-left: 3px solid #007acc;">
                         <h3 style="color: #dcdcaa; margin-top: 0;">总执行时间</h3>
                         <p style="color: #9cdcfe; font-size: 24px; font-weight: bold; margin: 5px 0;">${{totalExecTime.toLocaleString()}} cycles</p>
                     </div>
                     <div style="background: #252526; padding: 15px; border-radius: 5px; border-left: 3px solid #007acc;">
                         <h3 style="color: #dcdcaa; margin-top: 0;">L1缓存缺失</h3>
                         <p style="color: #ffa500; font-size: 24px; font-weight: bold; margin: 5px 0;">${{totalL1Miss.toLocaleString()}}</p>
                     </div>
                     <div style="background: #252526; padding: 15px; border-radius: 5px; border-left: 3px solid #007acc;">
                         <h3 style="color: #dcdcaa; margin-top: 0;">L2缓存缺失</h3>
                         <p style="color: #ff9900; font-size: 24px; font-weight: bold; margin: 5px 0;">${{totalL2Miss.toLocaleString()}}</p>
                     </div>
                 </div>
                 
                 <div style="background: #252526; padding: 20px; border-radius: 5px; margin-bottom: 30px;">
                     <h3 style="color: #dcdcaa; margin-top: 0;">执行时间分析</h3>
                     <div style="margin-bottom: 15px;">
                         <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                             <span style="color: #cccccc;">运算: ${{computeRatio}}%</span>
                             <span style="color: #cccccc;">访存: ${{memoryRatio}}%</span>
                             <span style="color: #cccccc;">Cache Miss: ${{cacheMissRatio}}%</span>
                         </div>
                         <div style="display: flex; height: 40px; background: #1e1e1e; border-radius: 5px; overflow: hidden;">
                             <div style="background: #28a745; width: ${{computeRatio}}%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                                 ${{computeRatio > 10 ? computeRatio + '%' : ''}}
                             </div>
                             <div style="background: #dc3545; width: ${{memoryRatio}}%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                                 ${{memoryRatio > 10 ? memoryRatio + '%' : ''}}
                             </div>
                             <div style="background: #ffc107; width: ${{cacheMissRatio}}%; display: flex; align-items: center; justify-content: center; color: black; font-weight: bold;">
                                 ${{cacheMissRatio > 10 ? cacheMissRatio + '%' : ''}}
                             </div>
                         </div>
                         <div style="display: flex; justify-content: space-around; margin-top: 8px; font-size: 12px;">
                             <span style="color: #28a745;">■ 运算时间</span>
                             <span style="color: #dc3545;">■ 访存时间</span>
                             <span style="color: #ffc107;">■ Cache Miss时间</span>
                         </div>
                     </div>
                 </div>
                 
                 <div style="background: #252526; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                     <h3 style="color: #dcdcaa; margin-top: 0;">前10耗时指令</h3>
                     <div style="display: flex; flex-direction: column; gap: 8px;" id="top-instructions-container">
                     </div>
                 </div>
             `;
            
            // 生成前10耗时指令的HTML
            let topInstructionsHtml = '';
            topInstructions.forEach((item, index) => {{
                const barWidth = Math.max(5, (item.exec_time || 0) / maxExecTime * 300);
                const percentage = ((item.exec_time || 0) / totalExecTime * 100).toFixed(1);
                topInstructionsHtml += `
                    <div style="display: flex; align-items: center; gap: 15px; padding: 10px; background: #1e1e1e; border-radius: 3px;">
                        <span style="color: #888; width: 25px; text-align: center; font-weight: bold;">${{index + 1}}</span>
                        <span style="color: #569cd6; font-family: monospace; width: 80px; font-size: 12px;">${{item.addr}}</span>
                        <span style="color: #dcdcaa; font-family: monospace; flex: 1; min-width: 200px; font-size: 13px;">${{item.instruction}}</span>
                        <span style="color: #9cdcfe; width: 120px; text-align: right; font-weight: bold;">${{(item.exec_time || 0).toLocaleString()}} cycles</span>
                        <div style="width: 300px; background: #333; height: 24px; border-radius: 3px; overflow: hidden; position: relative;">
                            <div style="background: linear-gradient(90deg, #007acc, #0099ff); height: 100%; width: ${{barWidth}}px; border-radius: 3px; position: relative;">
                                <span style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); color: white; font-size: 11px; font-weight: bold;">
                                    ${{percentage}}%
                                </span>
                            </div>
                        </div>
                    </div>
                `;
            }});
            
            document.getElementById('globalStatsContent').innerHTML = statsContent;
            document.getElementById('top-instructions-container').innerHTML = topInstructionsHtml;
            document.getElementById('globalStatsModal').style.display = 'block';
        }}
        
        // 绑定事件
        document.getElementById('searchBox').addEventListener('input', (e) => {{
            const term = e.target.value.trim();
            if (term.length >= 2) {{
                performSearch(term);
            }} else {{
                // 清除搜索结果
                lastSearchTerm = '';
                searchResults = [];
                currentSearchIndex = -1;
                document.querySelectorAll('.instruction').forEach(el => {{
                    el.classList.remove('current-search-result', 'highlight');
                }});
                document.getElementById('prevSearch').style.display = 'none';
                document.getElementById('nextSearch').style.display = 'none';
            }}
        }});
        
        document.getElementById('prevSearch').addEventListener('click', () => {{
            if (searchResults.length > 0) {{
                currentSearchIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
                jumpToSearchResult();
            }}
        }});
        
        document.getElementById('nextSearch').addEventListener('click', () => {{
            if (searchResults.length > 0) {{
                currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
                jumpToSearchResult();
            }}
        }});
        
        document.getElementById('clearSearch').addEventListener('click', () => {{
            document.getElementById('searchBox').value = '';
            lastSearchTerm = '';
            searchResults = [];
            currentSearchIndex = -1;
            document.querySelectorAll('.instruction').forEach(el => {{
                el.classList.remove('current-search-result', 'highlight');
            }});
            document.getElementById('prevSearch').style.display = 'none';
            document.getElementById('nextSearch').style.display = 'none';
        }});
        
        document.getElementById('goToAddr').addEventListener('click', goToAddress);
        document.getElementById('showGlobalStats').addEventListener('click', showGlobalStats);
        document.getElementById('closeModal').addEventListener('click', () => {{
            document.getElementById('globalStatsModal').style.display = 'none';
        }});
        
        // 点击模态框背景关闭
        document.getElementById('globalStatsModal').addEventListener('click', (e) => {{
            if (e.target.id === 'globalStatsModal') {{
                document.getElementById('globalStatsModal').style.display = 'none';
            }}
        }});
        
        // 初始渲染
        renderFunctionList();
        renderMainContent();
    </script>
</body>
</html>"""
        
        # 保存HTML文件
        output_file = f"{Path(binary_file).stem}_disasm_report.html"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ HTML报告已生成: {output_file}")
        return True
        
    except Exception as e:
        print(f"❌ 生成HTML报告失败: {e}")
        return False

def main():
    if len(sys.argv) < 2:
        print("用法: python3 htmlGen.py <binary_file> [csv_file]")
        print("示例: python3 htmlGen.py program.elf")
        print("示例: python3 htmlGen.py program.elf instruction_profile_core0_analyzed.csv")
        sys.exit(1)
    
    binary_file = sys.argv[1]
    csv_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not Path(binary_file).exists():
        print(f"❌ 文件不存在: {binary_file}")
        sys.exit(1)
    
    if csv_file and not Path(csv_file).exists():
        print(f"❌ CSV文件不存在: {csv_file}")
        sys.exit(1)
    
    generate_html_report(binary_file, csv_file)

if __name__ == "__main__":
    main() 